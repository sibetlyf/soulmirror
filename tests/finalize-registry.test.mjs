import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createFinalizeRegistry, snapshotRun } from '../lib/finalize-registry.js'

/**
 * 会后整理按会议隔离。
 *
 * 原实现用全局 finalizing + lastFinalizedAt(60s)：
 *   · A 会刚整理，B 会 <60s 后结束 → B 被当成重复，没有纪要
 *   · 整理中反复读可变的 session.dir → 新会议串场，内容写进旧目录
 */

function reg(opts) {
  let t = 1000000
  const r = createFinalizeRegistry({ now: () => t, ...opts })
  return { r, tick: (ms) => { t += ms }, now: () => t }
}

test('不同会议互不影响（A 刚整理，B 立刻也能整理）', () => {
  const { r } = reg()
  const a = r.tryBegin('/m/A', '1:100')
  assert.equal(a.ok, true)
  r.end(a.token)

  const b = r.tryBegin('/m/B', '1:100')
  assert.equal(b.ok, true, 'B 不该被 A 去抖掉')
})

test('同一会议同一修订：窗口内只做一次', () => {
  const { r } = reg({ debounceMs: 60000 })
  const a = r.tryBegin('/m/A', '2:200')
  r.end(a.token)
  const again = r.tryBegin('/m/A', '2:200')
  assert.equal(again.ok, false)
  assert.match(again.reason, /刚整理过/)
})

test('同一会议但转写变长了：允许再整理（内容更新）', () => {
  const { r } = reg()
  const a = r.tryBegin('/m/A', '2:200')
  r.end(a.token)
  const b = r.tryBegin('/m/A', '9:900')
  assert.equal(b.ok, true, '新内容应允许重新整理')
})

test('窗口过期后允许重来', () => {
  const { r, tick } = reg({ debounceMs: 60000 })
  const a = r.tryBegin('/m/A', '2:200')
  r.end(a.token)
  tick(61000)
  assert.equal(r.tryBegin('/m/A', '2:200').ok, true)
})

test('同一会议正在整理时，第二次被拒绝（并发保护）', () => {
  const { r } = reg()
  const a = r.tryBegin('/m/A', '2:200')
  assert.equal(a.ok, true)
  const b = r.tryBegin('/m/A', '3:300')
  assert.equal(b.ok, false)
  assert.match(b.reason, /正在整理/)
})

test('end 之后可以再次进入（不会永久占位）', () => {
  const { r } = reg()
  const a = r.tryBegin('/m/A', '1:1')
  r.end(a.token)
  assert.equal(r.isBusy('/m/A'), false)
  const b = r.tryBegin('/m/A', '1:1')
  assert.equal(b.ok, false, '同修订仍被去抖')   // 去抖而非占位
  const c = r.tryBegin('/m/A', '2:2')
  assert.equal(c.ok, true)
})

test('没有目录直接拒绝（不许写到未知位置）', () => {
  const { r } = reg()
  const a = r.tryBegin('', '1:1')
  assert.equal(a.ok, false)
  assert.match(a.reason, /没有会议目录/)
})

test('snapshot 能看出谁在忙', () => {
  const { r } = reg()
  r.tryBegin('/m/A', '1:1')
  const s = r.snapshot()
  assert.equal(s.busy.length, 1)
  assert.equal(s.busy[0].dir, '/m/A')
})

test('snapshotRun 固定会议身份（dir 不再随会话变化）', () => {
  const run = snapshotRun({ dir: '/m/A', startedAt: 111, display: '周会', transcript: [1, 2, 3], bytes: 600 })
  assert.equal(run.dir, '/m/A')
  assert.equal(run.revision, '3:600')
  assert.equal(run.title, '周会')
})
