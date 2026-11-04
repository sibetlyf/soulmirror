import { test } from 'node:test'
import assert from 'node:assert/strict'
import { nextLength, sliceVisible, shouldAnimate, DEFAULT_CPS } from '../lib/typewriter.js'

test('按帧推进：33ms 一帧约 1-2 个字', () => {
  const n = nextLength(0, 20, { cps: 45, dtMs: 33 })
  assert.ok(n >= 1 && n <= 3, '一帧不应跳太多，实际 ' + n)
})

test('不会超过目标长度', () => {
  assert.equal(nextLength(9, 10, { cps: 1000, dtMs: 100 }), 10)
})

test('目标变短时立即收敛（新的中间结果替换旧的）', () => {
  assert.equal(nextLength(30, 12), 12)
  assert.equal(nextLength(30, 0), 0)
})

test('落后很多会自动加速，不会永远追不上', () => {
  const slow = nextLength(0, 10, { cps: 45, dtMs: 33 })
  const fast = nextLength(0, 80, { cps: 45, dtMs: 33 })
  assert.ok(fast > slow, '差距大时每帧应推进更多')
})

test('非法输入不产生 NaN', () => {
  assert.equal(nextLength(NaN, 5, {}), 1)
  assert.equal(nextLength(-3, 5, {}), 1)
  assert.equal(nextLength(3, NaN, {}), 0)
})

test('sliceVisible 只取可见部分，超长原样返回', () => {
  assert.equal(sliceVisible('你好世界', 2), '你好')
  assert.equal(sliceVisible('你好世界', 99), '你好世界')
  assert.equal(sliceVisible('你好', 0), '')
  assert.equal(sliceVisible(null, 5), '')
})

test('尊重系统"减少动态效果"', () => {
  assert.equal(shouldAnimate(true), false)
  assert.equal(shouldAnimate(false), true)
})

test('默认速度是合理的', () => {
  assert.ok(DEFAULT_CPS >= 20 && DEFAULT_CPS <= 80)
})
