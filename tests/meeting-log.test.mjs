import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MeetingSession } from '../lib/session.js'

/**
 * 对齐 DSH 的设计：会话即日志，转写是一本只增不改的账。
 *
 *  1) 每来一句就**追加**到 transcript.jsonl，绝不重写整个文件
 *  2) 合并/升级也是"新行 + replaces 指向旧行"
 *  3) 进程被强杀也不丢已经落盘的句子
 *
 * 这里不再用正则猜源码，而是真的跑一遍再读回文件：
 * 落盘语义变了（比如改成同步写、可注入写函数）测试仍然有效。
 */

const cfg = () => ({
  asr: { provider: 'dashscope', chunkSeconds: 6 }, devices: {}, silenceRms: 0.004,
})

function withSession(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'sm-log-'))
  const s = new MeetingSession(cfg(), null, {})
  s.dir = dir
  try { return fn(s, dir) } finally { rmSync(dir, { recursive: true, force: true }) }
}

const readLines = (dir) => readFileSync(join(dir, 'transcript.jsonl'), 'utf8')
  .split('\n').filter(Boolean).map((l) => JSON.parse(l))

test('每句只追加：文件只变长，已写的行不会被重写', () => {
  withSession((s, dir) => {
    s._pushLine({ t: '2026-11-10T00:00:01.000Z', text: '第一句内容' })
    const afterFirst = readFileSync(join(dir, 'transcript.jsonl'), 'utf8')
    s._pushLine({ t: '2026-11-10T00:00:09.000Z', text: '完全不同的第二句' })
    const text = readFileSync(join(dir, 'transcript.jsonl'), 'utf8')
    assert.ok(text.startsWith(afterFirst), '新内容必须是追加，前面的字节不能被改写')
    assert.equal(readLines(dir).length, 2)
  })
})

test('碎片合并追加新行并用 replaces 指回旧行', () => {
  withSession((s, dir) => {
    const t0 = '2026-11-10T00:00:01.000Z'
    s._pushLine({ t: t0, text: '我们下周' })
    const how = s._pushLine({ t: '2026-11-10T00:00:02.000Z', text: '再对一版' })
    assert.equal(how, 'merged-fragment')
    const lines = readLines(dir)
    assert.equal(lines.length, 2)
    assert.equal(lines[1].replaces, t0)
    assert.ok(!lines[1].text.startsWith('我们下周') || lines[1].text.includes('再对一版'))
    // 内存里只有一行：合并结果，不是两行
    assert.equal(s.transcript.length, 1)
  })
})

test('完整版升级也追加带 replaces 的行', () => {
  withSession((s, dir) => {
    // 上一行有句末标点且两边都不是碎片 → 不会被合并，走"相似但更长"的升级分支。
    // 时间必须落在去重窗口内（8 秒），所以用当前时间而不是写死的过去时间。
    const t0 = new Date().toISOString()
    s._pushLine({ t: t0, text: '下周我们把发布计划再对一遍。' })
    const how = s._pushLine({ t: new Date(Date.now() + 1000).toISOString(), text: '下周我们把发布计划再对一遍吧。' })
    assert.equal(how, 'upgraded')
    const lines = readLines(dir)
    assert.equal(lines.length, 2)
    assert.equal(lines[1].replaces, t0)
    assert.equal(s.transcript.length, 1)
    assert.equal(s.transcript[0].text, '下周我们把发布计划再对一遍吧。')
  })
})

test('断点（gap）也写进同一本账，恢复时能看出这里断过', () => {
  withSession((s, dir) => {
    assert.equal(s._recordGap({ text: '（识别中断约 3 秒）', droppedMs: 3000 }), true)
    const lines = readLines(dir)
    assert.equal(lines.length, 1)
    assert.equal(lines[0].gap, true)
    assert.equal(lines[0].src, 'gap')
    assert.match(s.lastError, /中断约 3 秒/)
  })
})

test('落盘失败时不进内存、不通知界面，并把原因暴露出来', () => {
  withSession((s, dir) => {
    let published = 0
    s.onLine = () => { published += 1 }
    s.appendSync = () => { throw new Error('磁盘只读') }
    const how = s._pushLine({ t: '2026-11-10T00:00:01.000Z', text: '这句写不进去' })
    assert.equal(how, 'persist-failed')
    assert.equal(s.transcript.length, 0, '写盘失败不能抢先显示这句')
    assert.equal(published, 0)
    assert.match(s.lastError, /转写落盘失败/)
    assert.equal(s._recordGap({ text: 'x', droppedMs: 1000 }), false)
  })
})

test('没有会议目录时不落盘，也不会假装写成功', () => {
  const s = new MeetingSession(cfg(), null, {})
  s.dir = ''
  assert.equal(s._pushLine({ t: '2026-11-10T00:00:01.000Z', text: '无目录' }), 'persist-failed')
  assert.equal(s.transcript.length, 0)
})
