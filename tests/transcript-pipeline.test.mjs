import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MeetingSession } from '../lib/session.js'

/**
 * 行为测试（审查建议：不要只断言源码里出现过某个字符串）。
 *
 * 覆盖 P0-1：_pushLine 漏写 this. → 内存有字、落盘抛 ReferenceError、
 * 下游 onLine 不执行。这里真的跑一遍 _pushLine。
 */

function makeSession(dir) {
  const s = new MeetingSession({ asr: { provider: 'none' }, devices: {}, dataDir: dir }, null)
  s.transcript = []
  s.dir = dir
  s.logger = null
  s.merged = 0
  s.dupSkipped = 0
  s.onLineCalls = []
  s.onLine = function (item) { this.onLineCalls.push(item); return Promise.resolve() }
  return s
}

test('一条最终结果：日志追加一次、onLine 调一次、不抛异常', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sm-push-'))
  try {
    const s = makeSession(dir)
    const item = { t: new Date().toISOString(), text: '这是一句完整的会议发言，长度足够不被合并', speaker: '说话人1' }

    // 不该抛 ReferenceError（修复前这里会炸）
    const kind = s._pushLine(item)
    assert.equal(kind, 'added')
    assert.equal(s.transcript.length, 1)
    assert.equal(s.onLineCalls.length, 1, 'onLine 必须被调用')

    // 同步追加成功后才能展示，读取不需要等待。
    const p = join(dir, 'transcript.jsonl')
    assert.ok(statSync(p).size > 0, '账本必须真的落盘')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('碎片合并路径也落盘（replaces 标记）', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sm-push-'))
  try {
    const s = makeSession(dir)
    const t = new Date().toISOString()
    s._pushLine({ t, text: '我觉', speaker: '说话人1' })
    const kind = s._pushLine({ t: new Date().toISOString(), text: '得这个方案可以', speaker: '说话人1' })
    assert.equal(s.transcript.length, 1, '应合并成一行')
    assert.ok(['merged-fragment', 'upgraded'].includes(kind), '实际 ' + kind)
    assert.ok(statSync(join(dir, 'transcript.jsonl')).size > 0)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('重复句不会变成两行（合并或判重都行），也不抛异常', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sm-push-'))
  try {
    const s = makeSession(dir)
    const text = '这个方案我觉得需要再确认一下预算'
    s._pushLine({ t: new Date().toISOString(), text, speaker: 'A' })
    const kind = s._pushLine({ t: new Date().toISOString(), text, speaker: 'A' })
    // 相同句子可能被"碎片合并"吸收，也可能被判重跳过——两者都不该新增行
    assert.ok(['duplicate', 'merged-fragment', 'upgraded'].includes(kind), '实际 ' + kind)
    assert.equal(s.transcript.length, 1)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('没有目录时明确失败，不向界面发布未持久化文本', () => {
  const s = makeSession('')
  const kind = s._pushLine({ t: new Date().toISOString(), text: '一句话', speaker: 'A' })
  assert.equal(kind, 'persist-failed')
  assert.equal(s.onLineCalls.length, 0)
  assert.equal(s.transcript.length, 0)
  assert.match(s.lastError, /没有会议目录/)
})
