import { test } from 'node:test'
import assert from 'node:assert/strict'

/**
 * "贴底才跟随"的判定是纯数学：离底部小于阈值就算贴底。
 * 这里测阈值行为，避免把"用户往上翻"误判成贴底而跳走。
 */
function shouldStick(scrollHeight, scrollTop, clientHeight, threshold = 48) {
  return (scrollHeight - scrollTop - clientHeight) < threshold
}

test('已经在底部 → 跟随', () => {
  assert.equal(shouldStick(1000, 400, 600), true)   // gap = 0
})

test('接近底部（40px 内）→ 仍然跟随', () => {
  assert.equal(shouldStick(1000, 360, 600), true)   // gap = 40
})

test('往上翻了一段 → 不跟随（不能把用户拽回去）', () => {
  assert.equal(shouldStick(1000, 100, 600), false)  // gap = 300
})

test('内容不够长时不滚动也不报错', () => {
  assert.equal(shouldStick(600, 0, 600), true)      // gap = 0
})

test('阈值可调', () => {
  assert.equal(shouldStick(1000, 300, 600, 200), true)   // gap=100 < 200
  assert.equal(shouldStick(1000, 300, 600, 50), false)   // gap=100 > 50
})
