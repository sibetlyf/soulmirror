import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  createDshCompleter,
  resolveAttemptPlan,
  getSharedHttpPool,
  closeSharedHttpPool,
  pooledFetch,
} from '../lib/dsh-llm.js'
import {
  ensurePersona,
  writePersonaFile,
  loadProfile,
  splitPersonaBlock,
  composeCachedMessages,
} from '../lib/persona.js'
import {
  searchKnowledge,
  recallForContext,
  depositToKnowledge,
  writeDirectOrFallback,
} from '../lib/knowledge.js'
import {
  routeStylePack,
  loadStylePacks,
  saveStylePack,
  runStyledAssistant,
} from '../lib/style-packs.js'
import {
  analyzeEditDiff,
  createSelfEvolutionStore,
} from '../lib/self-evolution.js'
import { createResilientAsr } from '../lib/asr-stream.js'
import { REALTIME_ADVICE_RULE, automaticReason } from '../lib/advice-trigger.js'

test('dsh-llm: fast 模式默认关闭 thinking 并支持 onDelta 实时流式推送', async () => {
  const seenOpts = []
  const deltas = []
  const llm = {
    async *stream(opts) {
      seenOpts.push(opts)
      yield { type: 'text-delta', text: '第一段' }
      yield { type: 'text-delta', text: '第二段' }
      yield { type: 'finish', reason: { kind: 'stop' } }
    },
  }
  const complete = createDshCompleter({ llm, provider: 'ark', model: 'doubao-fast', mode: 'fast' })
  const out = await complete.stream(
    [{ role: 'system', content: 'sys' }, { role: 'user', content: 'hi' }],
    (delta) => deltas.push(delta),
    { cacheKey: 'sm-pc-1234567890abcdef' },
  )

  assert.equal(out, '第一段第二段')
  assert.deepEqual(deltas, ['第一段', '第二段'])
  assert.equal(seenOpts[0].reasoningEffort, 'minimal')
  assert.deepEqual(seenOpts[0].thinking, { type: 'disabled' })
  assert.equal(seenOpts[0].promptCacheKey, 'sm-pc-1234567890abcdef')
})

test('dsh-llm: fast 档位遇到不支持 thinking 参数时自动降级，deep 模式允许推理', () => {
  const fastPlan = resolveAttemptPlan({ mode: 'fast' })
  assert.equal(fastPlan[0].effort, 'minimal')
  assert.equal(fastPlan[0].thinking, false)
  assert.equal(fastPlan.at(-1).effort, '')

  const deepPlan = resolveAttemptPlan({ mode: 'deep' })
  assert.ok(deepPlan.some((p) => p.effort === 'medium'))
  assert.ok(deepPlan.some((p) => p.effort === 'high'))
})

test('dsh-llm: HTTP 连接池复用并仅对瞬态连接错误重试', async () => {
  closeSharedHttpPool()
  const p1 = getSharedHttpPool()
  const p2 = getSharedHttpPool()
  assert.strictEqual(p1, p2)

  let tries = 0
  const res = await pooledFetch('http://127.0.0.1:9999/ping', {}, {
    maxAttempts: 3,
    fetchImpl: async (_url, init) => {
      tries += 1
      assert.equal(init.headers.get('connection'), 'keep-alive')
      if (tries === 1) {
        const err = new Error('socket hang up')
        err.code = 'ECONNRESET'
        throw err
      }
      return { ok: true, status: 200, json: async () => ({ pong: true }) }
    },
  })
  assert.equal(tries, 2)
  assert.equal(res.status, 200)
  assert.ok(getSharedHttpPool().reusedRequests >= 1)
  closeSharedHttpPool()
})

test('persona: splitPersonaBlock 严格拆分静态前缀与动态后缀并生成稳定 cacheKey', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sm-persona-split-'))
  try {
    ensurePersona(dir)
    writePersonaFile(dir, 'state', '# STATE\n正在推进 Q4 语音输入融合')

    const s1 = splitPersonaBlock(dir, {
      stylePack: { id: 'chat-brief', name: '群聊极简', systemPrompt: '短句直给' },
      hotwords: ['Agno', 'OpenLess'],
      frontApp: 'WeChat',
      cursorContext: '上一句提到交付时间',
      knowledgeSnippets: [{ title: '发布规范', snippet: '每周四发版' }],
    })
    const s2 = splitPersonaBlock(dir, {
      stylePack: { id: 'chat-brief', name: '群聊极简', systemPrompt: '短句直给' },
      hotwords: ['Agno', 'OpenLess'],
      frontApp: 'Cursor',
      cursorContext: '完全不同的光标上下文',
      knowledgeSnippets: [{ title: '另一篇文档', snippet: '不同召回内容' }],
    })

    // 静态内容未变 → cacheKey 必须完全一致（命中云端 Prompt Cache）
    assert.equal(s1.cacheKey, s2.cacheKey)
    assert.match(s1.staticPrefix, /群聊极简/)
    assert.match(s1.staticPrefix, /Agno/)
    assert.doesNotMatch(s1.staticPrefix, /交付时间/)
    assert.match(s1.dynamicSuffix, /WeChat/)
    assert.match(s1.dynamicSuffix, /发布规范/)

    const msgs = composeCachedMessages({
      staticPrefix: s1.staticPrefix,
      dynamicSuffix: s1.dynamicSuffix,
      userText: '帮我回一句',
    })
    assert.equal(msgs[0].role, 'system')
    assert.equal(msgs[0].content, s1.staticPrefix)
    assert.equal(msgs[1].role, 'user')
    assert.match(msgs[1].content, /发布规范/)
    assert.match(msgs[1].content, /帮我回一句/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('knowledge: 直连 HTTP/FTS 召回与一键沉淀替代 runDshTask', async () => {
  const calls = []
  const mockFetch = async (url, init) => {
    calls.push({ url, method: init.method, body: init.body })
    if (url.includes('/search')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          items: [
            { id: 'doc-1', title: '部署规范', snippet: '服务统一监听 3080', tags: ['Docker', '运维'], score: 0.92 },
          ],
        }),
      }
    }
    if (url.includes('/entries')) {
      return {
        ok: true,
        status: 201,
        text: async () => JSON.stringify({ id: 'entry-99', title: '端口约定' }),
      }
    }
    return { ok: false, status: 404, text: async () => 'not found' }
  }

  const s = await searchKnowledge({ query: '端口', origin: 'http://127.0.0.1:3080', fetchImpl: mockFetch })
  assert.equal(s.ok, true)
  assert.equal(s.items.length, 1)
  assert.equal(s.items[0].title, '部署规范')

  const rc = await recallForContext({ query: '端口', origin: 'http://127.0.0.1:3080', fetchImpl: mockFetch })
  assert.equal(rc.ok, true)
  assert.match(rc.snippets[0], /3080/)
  assert.ok(rc.hotwords.includes('Docker'))

  const dep = await depositToKnowledge({
    title: '端口约定',
    content: '统一监听 3080',
    origin: 'http://127.0.0.1:3080',
    fetchImpl: mockFetch,
  })
  assert.equal(dep.ok, true)
  assert.equal(dep.committed, true)
  assert.equal(dep.id, 'entry-99')

  // writeDirectOrFallback 在有 origin 时直连 HTTP，不调用 runDshTask
  let taskCalled = false
  const direct = await writeDirectOrFallback({
    title: '周会纪要',
    markdown: '# 周会',
    origin: 'http://127.0.0.1:3080',
    fetchImpl: mockFetch,
    runDshTask: async () => { taskCalled = true; return { ok: true } },
  })
  assert.equal(direct.ok, true)
  assert.equal(direct.via, 'direct-http')
  assert.equal(taskCalled, false)
})

test('style-packs: 前台应用 + 情绪地形自动路由 + 人格底色与知识库融合执行', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sm-style-'))
  try {
    ensurePersona(dir)
    assert.equal(routeStylePack({ frontApp: 'Cursor' }).pack.id, 'ai-prompt')
    assert.equal(routeStylePack({ frontApp: 'WeChat' }).pack.id, 'chat-brief')
    assert.equal(routeStylePack({ frontApp: '腾讯会议', emotionTerrain: 'volcano' }).pack.id, 'diplomatic-reply')
    assert.equal(routeStylePack({ frontApp: '腾讯会议', emotionTerrain: 'valley' }).pack.id, 'meeting-bullet')

    saveStylePack(dir, { id: 'xhs', name: '小红书文案', systemPrompt: '多用短句与 emoji' })
    assert.ok(loadStylePacks(dir).some((p) => p.id === 'xhs'))

    const streamed = []
    const llm = {
      async *stream(opts) {
        assert.match(opts.system, /AI 提示词模式/)
        assert.match(opts.messages[0].content[0].text, /服务监听 3080/)
        yield { type: 'text-delta', text: '整理结果：' }
        yield { type: 'text-delta', text: '监听 3080' }
        yield { type: 'finish', reason: { kind: 'stop' } }
      },
    }
    const completer = createDshCompleter({ llm, provider: 'ark', model: 'fast-m', mode: 'fast' })
    const res = await runStyledAssistant({
      personaDir: dir,
      dataDir: dir,
      text: '帮我把部署端口写进提示词',
      action: 'polish',
      frontApp: 'Cursor',
      knowledge: {
        origin: 'http://127.0.0.1:3080',
        fetchImpl: async (url) => {
          if (url.includes('/search')) {
            return { ok: true, status: 200, json: async () => ({ items: [{ id: '1', title: '部署', snippet: '服务监听 3080' }] }) }
          }
          return { ok: true, status: 201, text: async () => JSON.stringify({ id: 'dep-1', title: '沉淀' }) }
        },
      },
      completer,
      onDelta: (d) => streamed.push(d),
    })

    assert.equal(res.pack.id, 'ai-prompt')
    assert.equal(res.text, '整理结果：监听 3080')
    assert.deepEqual(streamed, ['整理结果：', '监听 3080'])
    const dep = await res.deposit()
    assert.equal(dep.ok, true)
    assert.equal(dep.id, 'dep-1')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('self-evolution: 双轨自进化（轨道A 术语入词典与知识库；轨道B 风格修改累积生成提案并写入人格/风格包）', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sm-evo-'))
  try {
    ensurePersona(dir)
    const store = createSelfEvolutionStore(dir, { proposalThreshold: 2 })

    // 轨道 A：术语替换观察 → 待确认 → 确认后入词典 + 知识库
    const diffA = analyzeEditDiff('我们用阿哥诺框架来跑', '我们用Agno框架来跑')
    assert.equal(diffA.termCandidates.length, 1)
    assert.equal(diffA.termCandidates[0].correct, 'Agno')

    const obsA = store.observeEdit({ before: '我们用阿哥诺框架来跑', after: '我们用Agno框架来跑' })
    assert.equal(obsA.newTerms.length, 1)
    assert.equal(store.getTopHotwords().length, 0, '确认前绝不静默进词典')

    let kbDeposited = false
    const confirmRes = await store.confirmTerm(obsA.newTerms[0].id, {
      knowledge: {
        origin: 'http://127.0.0.1:3080',
        fetchImpl: async () => {
          kbDeposited = true
          return { ok: true, status: 201, text: async () => JSON.stringify({ id: 'term-kb-1' }) }
        },
      },
    })
    assert.equal(confirmRes.ok, true)
    assert.equal(kbDeposited, true)
    assert.deepEqual(store.getTopHotwords(), ['Agno'])

    // 轨道 B：连续 2 次删除客套话 → 自动生成风格进化提案 → 审批后写入 PROFILE.json 与 Style Pack
    const o1 = store.observeEdit({
      before: '非常感谢您的理解，我们明天上线。',
      after: '我们明天上线。',
      stylePackId: 'chat-brief',
    })
    assert.equal(o1.newProposals.length, 0)

    const o2 = store.observeEdit({
      before: '综上所述，希望能帮到您，方案已定。',
      after: '方案已定。',
      stylePackId: 'chat-brief',
    })
    assert.equal(o2.newProposals.length, 1)
    assert.equal(o2.newProposals[0].pattern, 'remove-politeness')

    const approved = store.approveProposal(o2.newProposals[0].id, { personaDir: dir })
    assert.equal(approved.ok, true)
    assert.ok(approved.appliedTo.includes('persona:PROFILE.json'))
    assert.ok(approved.appliedTo.includes('style-pack:chat-brief'))

    const profile = loadProfile(dir)
    assert.ok(profile.sections.style.some((x) => x.key === 'removepoliteness' || x.value.includes('客套')))
    const updatedPack = loadStylePacks(dir).find((p) => p.id === 'chat-brief')
    assert.match(updatedPack.systemPrompt, /避免客套/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('asr-stream: captureFirst 先开麦进缓冲、并行握手并在连上后按原序补发', async () => {
  const sent = []
  let resolveOpen = null
  const asr = createResilientAsr({
    apiKey: 'fake',
    model: 'fake',
    makeAsr: () => ({
      open: () => new Promise((r) => { resolveOpen = r }),
      send: (buf) => sent.push(Buffer.from(buf).toString('utf8')),
      finish: async () => {},
    }),
  })

  // captureFirst 立刻返回，不阻塞在 WebSocket 握手上
  await asr.start({ captureFirst: true })
  asr.feed(Buffer.from('chunk-1'))
  asr.feed(Buffer.from('chunk-2'))
  assert.equal(sent.length, 0, '未建连前暂存在环形缓冲')

  // 握手完成，瞬间按序补发
  resolveOpen()
  await new Promise((r) => setTimeout(r, 20))
  asr.feed(Buffer.from('chunk-3'))
  assert.deepEqual(sent, ['chunk-1', 'chunk-2', 'chunk-3'])
  await asr.stop()
})

test('advice-trigger: REALTIME_ADVICE_RULE 支持 100 字 / 20 秒实时触发', () => {
  const r1 = automaticReason(
    { running: false, throughLine: 0, lastAttemptAt: 0, lastSuccessAt: 0 },
    { latestLine: 2, newChars: 110, now: 30_000 },
    REALTIME_ADVICE_RULE,
  )
  assert.equal(r1, 'characters')

  const r2 = automaticReason(
    { running: false, throughLine: 0, lastAttemptAt: 0, lastSuccessAt: 10_000 },
    { latestLine: 1, newChars: 20, now: 35_000 },
    REALTIME_ADVICE_RULE,
  )
  assert.equal(r2, 'time')
})
