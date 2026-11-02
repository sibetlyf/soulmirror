import { test } from 'node:test'
import assert from 'node:assert/strict'

/**
 * "会议声音不在默认设备上" 是实际踩到的坑：
 * 会议音频走 HDMI，插件采默认设备（MIPI）的环回，采到的全是静音。
 * 这里测的是挑选逻辑本身（不碰真实音频设备）。
 */

function pickLoudest(levels, min = 0.01) {
  let best = null
  for (const [name, level] of levels) {
    if (level >= min && (!best || level > best.level)) best = { name, level }
  }
  return best
}

test('挑电平最高的渲染设备', () => {
  const map = new Map([
    ['MIPI 扬声器', 0],
    ['H27P6 (HDMI)', 0.73],
    ['CABLE Input', 0.02],
  ])
  assert.equal(pickLoudest(map).name, 'H27P6 (HDMI)')
})

test('全都安静时返回 null，用默认设备', () => {
  const map = new Map([['A', 0], ['B', 0.005]])
  assert.equal(pickLoudest(map), null)
})

test('刚好达到阈值也算（>= min）', () => {
  assert.equal(pickLoudest(new Map([['A', 0.01]]), 0.01).name, 'A')
})

test('多次采样取各设备最大值后再挑', () => {
  const samples = [
    new Map([['HDMI', 0.2], ['MIPI', 0]]),
    new Map([['HDMI', 0.9], ['MIPI', 0.1]]),
    new Map([['HDMI', 0], ['MIPI', 0.3]]),
  ]
  const max = new Map()
  for (const s of samples) for (const [k, v] of s) max.set(k, Math.max(max.get(k) || 0, v))
  assert.equal(pickLoudest(max).name, 'HDMI')
  assert.equal(max.get('MIPI'), 0.3)
})

test('设备名重复出现取最大，不会互相覆盖成小值', () => {
  const max = new Map()
  const seq = [['HDMI', 0.8], ['HDMI', 0.1], ['HDMI', 0.5]]
  for (const [k, v] of seq) max.set(k, Math.max(max.get(k) || 0, v))
  assert.equal(max.get('HDMI'), 0.8)
})
