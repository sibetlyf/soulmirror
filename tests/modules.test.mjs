import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MeetingBrain, makeCorrector, createCompleter } from '../lib/brain.js'
import { promptSession, createSession, getController } from '../lib/dsh-session.js'
import { pickRecommended } from '../lib/auto-answer.js'
import { detectKnowledge, profileHasKnowledge, pickKnowledgeProfile, writeViaHostApi } from '../lib/knowledge.js'
import { detectEnv, formatEnv } from '../lib/setup.js'
import { installPlan, detectVirtualAudio } from '../lib/vcard.js'
import { resolveDshBin } from '../lib/twin.js'

test('大脑：点名/待办/问句 三种触发', () => {
  const b = new MeetingBrain({ names: ['李亚峰', '亚峰', 'DSH'], minGapMs: 0 })
  assert.equal(b.push({ text: '亚峰，你看下这个' }).kind, 'name')
  const b2 = new MeetingBrain({ names: ['DSH'], minGapMs: 0 })
  assert.equal(b2.push({ text: '帮我记一下明天十点开会' }).kind, 'todo')
  const b3 = new MeetingBrain({ names: ['DSH'], minGapMs: 0 })
  assert.equal(b3.push({ text: '这个方案可行吗？' }).kind, 'question')
  const b4 = new MeetingBrain({ names: ['DSH'], minGapMs: 0 })
  assert.equal(b4.push({ text: '今天天气不错' }), null)
})

test('大脑：大小写不敏感点名', () => {
  const b = new MeetingBrain({ names: ['DSH'], minGapMs: 0 })
  assert.equal(b.push({ text: 'dsh 你在吗' }).kind, 'name')
})

test('大脑：静默窗口内不重复触发', () => {
  const b = new MeetingBrain({ names: ['DSH'], minGapMs: 60000 })
  assert.ok(b.push({ text: 'DSH 一' }))
  b.markSpoken('回答')
  assert.equal(b.push({ text: 'DSH 二' }), null)
})

test('大脑：无 LLM 时用模板回复', async () => {
  const b = new MeetingBrain({ names: ['DSH'], minGapMs: 0 })
  const trig = b.push({ text: 'DSH 帮我记一下' })
  const d = await b.decide(trig, { profile: 'SoulMirror' })
  assert.equal(d.speak, true)
  assert.match(d.text, /我/)
})

test('大脑：有 LLM 时按 JSON 决策，带 task 字段', async () => {
  const b = new MeetingBrain({ names: ['DSH'], minGapMs: 0 })
  const trig = b.push({ text: 'DSH 帮我查下天气' })
  const complete = async () => '{"speak":true,"text":"我去查","task":"查天气","confidence":0.9,"reason":"被交代"}'
  const d = await b.decide(trig, { complete, profile: 'SoulMirror' })
  assert.equal(d.task, '查天气')
  assert.equal(d.speak, true)
})

test('大脑：LLM 返回坏 JSON 时不崩，返回不插话', async () => {
  const b = new MeetingBrain({ names: ['DSH'], minGapMs: 0 })
  const trig = b.push({ text: 'DSH 在吗' })
  const d = await b.decide(trig, { complete: async () => 'not json', profile: 'x' })
  assert.equal(d.speak, false)
  assert.match(d.reason, /LLM 失败/)
})

test('纠错器：无 completer 原样返回，有则清洗引号', async () => {
  const raw = await makeCorrector({})(('大风你好'))
  assert.equal(raw, '大风你好')
  const fixed = await makeCorrector({ names: ['李亚峰'], completer: async () => '"李亚峰你好"' })('大风你好')
  assert.equal(fixed, '李亚峰你好')
})

test('纠错器：返回过短时保留原文', async () => {
  const fix = makeCorrector({ completer: async () => '嗯' })
  assert.equal(await fix('这是一句比较长的话'), '这是一句比较长的话')
})

test('createCompleter：缺 baseUrl/model 返回 null', () => {
  assert.equal(createCompleter({}), null)
  assert.equal(typeof createCompleter({ baseUrl: 'http://x/v1', model: 'm' }), 'function')
})

test('会话驱动：mock controller 能收到 prompt 且拿到回复', async () => {
  const handlers = {}
  const ctx = {
    get: (k) => (k === 'sessionController' ? {
      create: async () => ({ sessionId: 's1' }),
      rename: async () => ({}),
      prompt: async () => {
        setTimeout(() => {
          handlers['session/event']?.({ id: 's1' }, { type: 'turn/start', data: { turn: 2 } })
          handlers['session/event']?.({ id: 's1' }, { type: 'assistant/message', data: { turn: 2, message: { content: [{ type: 'text', text: '好的' }] } } })
          handlers['session/event']?.({ id: 's1' }, { type: 'turn/end', data: { turn: 2, reason: { kind: 'completed' } } })
        }, 20)
        return { accepted: true }
      },
      cancel: () => {},
    } : undefined),
    on: (n, f) => { handlers[n] = f; return () => {} },
  }
  assert.equal(getController(ctx) !== null, true)
  assert.equal(await createSession(ctx, { cwd: '.', title: 't' }), 's1')
  const r = await promptSession(ctx, 's1', '你好', { timeoutMs: 3000 })
  assert.equal(r.ok, true)
  assert.equal(r.text, '好的')
})

test('会话驱动：无 controller 时抛错', async () => {
  const ctx = { get: () => undefined, on: () => () => {} }
  assert.equal(getController(ctx), null)
  await assert.rejects(() => createSession(ctx, {}), /sessionController/)
})

test('会话驱动：旧 turn 的 end 不会提前结算', async () => {
  const handlers = {}
  const ctx = {
    get: (k) => (k === 'sessionController' ? { create: async () => ({ sessionId: 's1' }), prompt: async () => ({}) } : undefined),
    on: (n, f) => { handlers[n] = f; return () => {} },
  }
  const p = promptSession(ctx, 's1', 'x', { timeoutMs: 3000 })
  setTimeout(() => handlers['session/event']?.({ id: 's1' }, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } }), 30)
  setTimeout(() => handlers['session/event']?.({ id: 's1' }, { type: 'turn/start', data: { turn: 2 } }), 60)
  setTimeout(() => handlers['session/event']?.({ id: 's1' }, { type: 'assistant/message', data: { turn: 2, message: { content: [{ type: 'text', text: '第二轮' }] } } }), 90)
  setTimeout(() => handlers['session/event']?.({ id: 's1' }, { type: 'turn/end', data: { turn: 2, reason: { kind: 'completed' } } }), 120)
  const r = await p
  assert.equal(r.text, '第二轮')
})

test('知识库：能识别 profile 能力并给出推荐项', () => {
  const d = detectKnowledge()
  assert.equal(typeof d.installed, 'boolean')
  assert.ok(Array.isArray(d.candidates))
  assert.equal(typeof pickKnowledgeProfile(''), 'string')
  assert.equal(profileHasKnowledge('__nope__'), false)
  assert.equal(typeof installPlan().steps.length, 'number')
})

test('知识库：writeViaHostApi 用 fetch 打本地 API', async () => {
  let seen = null
  const fakeFetch = async (url, init) => {
    seen = { url, init }
    return { ok: true, status: 201, text: async () => '{"id":"doc-1"}' }
  }
  const r = await writeViaHostApi({ port: 3080, title: 'T', markdown: 'M', fetchImpl: fakeFetch })
  assert.equal(r.ok, true)
  assert.equal(r.id, 'doc-1')
  assert.match(seen.url, /\/knowledge-local\/v1\/entries$/)
  assert.equal(seen.init.headers['x-dsh-knowledge-client'], 'management-web')
  const body = JSON.parse(seen.init.body)
  assert.equal(body.draft.title, 'T')
})

test('知识库：端口缺失时安全失败', async () => {
  const r = await writeViaHostApi({ title: 'T', markdown: 'M' })
  assert.equal(r.ok, false)
})

test('环境自检：返回结构化结果', () => {
  const env = detectEnv()
  assert.ok(['win32', 'darwin', 'linux'].includes(env.platform))
  assert.equal(typeof env.ready, 'boolean')
  assert.ok(Array.isArray(env.missing))
  assert.match(formatEnv(env), /平台/)
})

test('虚拟声卡：计划分平台，Linux 可自动', () => {
  assert.equal(installPlan('linux').auto, true)
  assert.equal(installPlan('win32').auto, false)
  assert.equal(installPlan('darwin').auto, false)
})

test('dsh 入口可解析', () => {
  const bin = resolveDshBin()
  assert.ok(bin === '' || bin.endsWith('bin.js'))
})

test('推荐项解析在审批场景下退化为 allowed-once', () => {
  assert.equal(pickRecommended({ toolName: 'pwsh' }).value, 'allowed-once')
})
