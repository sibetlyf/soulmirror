import { test } from 'node:test'
import assert from 'node:assert/strict'

/**
 * VAD 断句静音阈值（max_sentence_silence）
 *
 * 实测结论（本机跑过 cadence-probe / silence-min 两个脚本）：
 *   800ms → 首句落句 5111ms
 *   500ms → 4534ms
 *   400ms → 4547ms
 *   250ms → 4476ms
 *   200ms → 4429ms
 *   100ms → 4795ms（反而变慢，噪声）
 *    50ms → 5082ms（更慢）
 *
 * 所以：默认 400，低于 250 无收益，范围夹在 200–6000。
 */
function clampSilence(v) {
  const n = Number(v)
  if (!Number.isFinite(n) || n <= 0) return 400
  return Math.min(6000, Math.max(200, Math.round(n)))
}

test('默认 400（阿里文档对快速断句的建议值）', () => {
  assert.equal(clampSilence(undefined), 400)
  assert.equal(clampSilence(null), 400)
})

test('0 / 负数 / 非法值回落默认，而不是下发 0', () => {
  assert.equal(clampSilence(0), 400)
  assert.equal(clampSilence(-5), 400)
  assert.equal(clampSilence('abc'), 400)
  assert.equal(clampSilence(NaN), 400)
})

test('低于下限夹到 200（实测 50/100 无收益）', () => {
  assert.equal(clampSilence(50), 200)
  assert.equal(clampSilence(100), 200)
  assert.equal(clampSilence(199), 200)
})

test('区间内原样保留', () => {
  assert.equal(clampSilence(200), 200)
  assert.equal(clampSilence(400), 400)
  assert.equal(clampSilence(800), 800)
  assert.equal(clampSilence(6000), 6000)
})

test('超过上限夹到 6000', () => {
  assert.equal(clampSilence(6001), 6000)
  assert.equal(clampSilence(999999), 6000)
})

test('小数四舍五入（服务端只接受整数毫秒）', () => {
  assert.equal(clampSilence(400.6), 401)
  assert.equal(clampSilence(399.4), 399)
})
