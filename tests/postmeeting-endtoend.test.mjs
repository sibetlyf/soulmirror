import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createJournal } from '../lib/journal.js'
import { createPostMeeting } from '../lib/postmeeting.js'

/**
 * 端到端（不起宿主）：用真实的 journal + 管线，把"点结束录音之后应该发生什么"
 * 跑一遍，并验证三种真实事故：
 *   ① 中途崩了，重启后从失败那一步接着跑，前面确认过的步骤不重复
 *   ② 非流式转写失败，管线停在那一步并保留原因，绝不拿实时草稿生成纪要
 *   ③ 知识库结果不确定时不再自动重发
 */

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'sm-e2e-'))
  const dir = join(root, '2026-11-10T09-00-00-auto')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'audio.wav'), Buffer.alloc(44 + 3200))
  writeFileSync(join(dir, 'transcript.jsonl'), JSON.stringify({ t: new Date().toISOString(), text: '会中实时草稿' }) + '\n')
  return { root, dir, journal: (() => { const j = createJournal({ root }); j.load(); return j })() }
}

/** 一套会记录调用次数的假步骤 */
function steps(overrides = {}) {
  const calls = { offline: 0, minutes: 0, knowledge: 0, persona: 0 }
  const base = {
    offline: async (ctx) => {
      calls.offline += 1
      if (overrides.offline) return overrides.offline(ctx, calls)
      writeFileSync(join(ctx.dir, 'transcript-offline.jsonl'), JSON.stringify({ speaker: '说话人1', text: '整理后的第一句' }) + '\n')
      return { status: 'done', result: '1 句 · 1 位', sentences: 1 }
    },
    minutes: async (ctx) => {
      calls.minutes += 1
      if (overrides.minutes) return overrides.minutes(ctx, calls)
      // 只允许读非流式结果
      const lines = readFileSync(join(ctx.dir, 'transcript-offline.jsonl'), 'utf8')
      assert.match(lines, /整理后的第一句/)
      writeFileSync(join(ctx.dir, 'minutes.md'), '# 纪要\n')
      return { status: 'done', result: '已保存', path: join(ctx.dir, 'minutes.md') }
    },
    knowledge: async (ctx) => {
      calls.knowledge += 1
      if (overrides.knowledge) return overrides.knowledge(ctx, calls)
      return { status: 'done', result: '已确认写入知识库' }
    },
    persona: async () => { calls.persona += 1; return { status: 'skip', reason: '测试不画像' } },
  }
  return { base, calls }
}

test('结束录音后四个步骤按顺序跑完，状态全部落盘可读', async () => {
  const { root, dir, journal } = setup()
  try {
    const { base, calls } = steps()
    const p = createPostMeeting({ journal, steps: base })
    const r = p.enqueue(dir, { reason: '结束录音' })
    assert.equal(r.ok, true)
    await p.idle()
    assert.deepEqual(calls, { offline: 1, minutes: 1, knowledge: 1, persona: 1 })

    const run = journal.projection().runs[dir]
    assert.equal(run.phase, 'done')
    assert.equal(run.steps.offline.state, 'done')
    assert.equal(run.steps.minutes.state, 'done')
    assert.equal(run.steps.knowledge.state, 'done')
    assert.equal(run.steps.persona.state, 'skipped')
    assert.equal(run.result.minutesPath, join(dir, 'minutes.md'))
    // 磁盘上的日志也能独立恢复出同一份状态
    const cold = createJournal({ root: mkdtempSync(join(tmpdir(), 'sm-e2e-cold-')) })
    cold.append('host.boot', { pid: 1 })
    assert.ok(existsSync(join(root, 'journal.jsonl')))
    assert.match(readFileSync(join(root, 'journal.jsonl'), 'utf8'), /pipeline\.done/)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('中途崩在纪要那一步：重启续跑时不会重做整段转写', async () => {
  const { root, dir, journal } = setup()
  try {
    let failMinutes = true
    const { base, calls } = steps({
      minutes: async (ctx) => {
        if (failMinutes) throw new Error('模型超时（模拟崩溃）')
        writeFileSync(join(ctx.dir, 'minutes.md'), '# 纪要\n')
        return { status: 'done', result: '已保存', path: join(ctx.dir, 'minutes.md') }
      },
    })
    const p = createPostMeeting({ journal, steps: base })
    p.enqueue(dir, { reason: '结束录音' })
    await p.idle()
    let run = journal.projection().runs[dir]
    assert.equal(run.phase, 'error')
    assert.equal(run.errorStep, 'minutes')
    assert.match(run.error, /模型超时/)
    assert.equal(calls.offline, 1)

    // 模拟"用户重启 DSH 后点重试"：同一份日志、新的管线实例
    failMinutes = false
    const j2 = createJournal({ root }); j2.load()
    const p2 = createPostMeeting({ journal: j2, steps: base })
    const r2 = p2.enqueue(dir, { reason: '重试' })
    assert.equal(r2.ok, true)
    await p2.idle()
    run = j2.projection().runs[dir]
    assert.equal(run.phase, 'done')
    assert.equal(calls.offline, 1, '已确认完成的整段转写不能再跑一次')
    assert.equal(calls.minutes, 2, '失败的步骤要重试')
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('非流式转写失败：停在第一步，不生成纪要，原因可见', async () => {
  const { root, dir, journal } = setup()
  try {
    const { base, calls } = steps({ offline: async () => { throw new Error('非流式文件识别失败：录音无有效人声') } })
    const p = createPostMeeting({ journal, steps: base })
    p.enqueue(dir, { reason: '结束录音' })
    await p.idle()
    const run = journal.projection().runs[dir]
    assert.equal(run.phase, 'error')
    assert.equal(run.errorStep, 'offline')
    assert.match(run.error, /非流式/)
    assert.equal(calls.minutes, 0, '第一步失败就不该继续生成纪要')
    assert.equal(existsSync(join(dir, 'minutes.md')), false, '不允许用实时草稿顶替纪要')
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('知识库结果不确定：停下等人工核对，不自动重发', async () => {
  const { root, dir, journal } = setup()
  try {
    const { base, calls } = steps({
      knowledge: async () => { throw new Error('上次知识库请求结果不确定，已停止自动重发；请在知识库核对') },
    })
    const p = createPostMeeting({ journal, steps: base })
    p.enqueue(dir, { reason: '结束录音' })
    await p.idle()
    const run = journal.projection().runs[dir]
    assert.equal(run.phase, 'error')
    assert.equal(run.errorStep, 'knowledge')
    assert.equal(calls.knowledge, 1)
    assert.equal(run.steps.minutes.state, 'done', '纪要本身是成功的，不该被回滚')

    // 再点一次重试：只重试知识库，不重跑前面
    const j2 = createJournal({ root }); j2.load()
    const p2 = createPostMeeting({ journal: j2, steps: base })
    p2.enqueue(dir, { reason: '重试' })
    await p2.idle()
    assert.equal(calls.offline, 1)
    assert.equal(calls.minutes, 1)
    assert.equal(calls.knowledge, 2)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('同一场会重复点"结束录音"只会整理一次', async () => {
  const { root, dir, journal } = setup()
  try {
    const { base, calls } = steps()
    const p = createPostMeeting({ journal, steps: base })
    p.enqueue(dir, { reason: '结束录音' })
    const second = p.enqueue(dir, { reason: '又点了结束录音' })
    assert.equal(second.ok, true)
    await p.idle()
    assert.equal(calls.offline, 1)
    assert.equal(calls.minutes, 1)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
