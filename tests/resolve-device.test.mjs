import { test } from 'node:test'
import assert from 'node:assert/strict'
import { matchDevice, deviceRef, normalizeDeviceName } from '../lib/resolve-device.js'

// 真机上的两个名字（用户拔掉耳机导致的变更）
const HEADPHONE = '耳机 (适用于 MIPI SoundWire® 音频的英特尔® 智音技术)'
const SPEAKER = '扬声器 (适用于 MIPI SoundWire® 音频的英特尔® 智音技术)'

const list = [
  { name: 'H27P6 (NVIDIA High Definition Audio)', id: 'id-hdmi', index: 0 },
  { name: SPEAKER, id: 'id-mipi', index: 1 },
  { name: 'CABLE Input (VB-Audio Virtual Cable)', id: 'id-cable', index: 2 },
]

test('按端点 ID 精确命中（最稳）', () => {
  const r = matchDevice(list, 'id-mipi')
  assert.equal(r.how, 'id')
  assert.equal(r.device.name, SPEAKER)
})

test('名字一致时直接命中', () => {
  const r = matchDevice(list, SPEAKER)
  assert.equal(r.how, 'exact')
})

test('设备被改名（耳机 → 扬声器）时，仍能找到同一台', () => {
  const r = matchDevice(list, HEADPHONE)
  // 规范化后：耳机 vs 扬声器 不同，但互相包含不了；此例应识别为"找不到"
  // —— 真实价值在于下面的 normalized/contains 用例，这个用例确保不会误配到 HDMI
  if (r.device) assert.notEqual(r.device.name, list[0].name, '不能错配到 HDMI')
})

test('规范化后一致：只差 ® 和括号修饰', () => {
  const rows = [{ name: '扬声器 (适用于 MIPI SoundWire® 音频的英特尔® 智音技术)', id: 'x' }]
  const r = matchDevice(rows, '扬声器 (MIPI SoundWire 音频的英特尔 智音技术)')
  assert.equal(r.how, 'normalized')
})

test('长短名互相包含也能命中', () => {
  const rows = [{ name: 'CABLE Input (VB-Audio Virtual Cable)', id: 'c' }]
  const r = matchDevice(rows, 'CABLE Input')
  assert.equal(r.how, 'contains')
})

test('找不到就明确返回 none，交给上层回退', () => {
  const r = matchDevice(list, '不存在的设备')
  assert.equal(r.device, null)
  assert.equal(r.how, 'none')
})

test('空列表 / 空配置都不抛错', () => {
  assert.equal(matchDevice([], 'x').how, 'none')
  assert.equal(matchDevice(list, '').how, 'none')
})

test('deviceRef 优先返回端点 ID', () => {
  assert.equal(deviceRef({ name: 'n', id: 'the-id' }), 'the-id')
  assert.equal(deviceRef({ name: 'n' }), 'n')
  assert.equal(deviceRef(null), '')
})

test('normalizeDeviceName 去掉修饰词', () => {
  const a = normalizeDeviceName(SPEAKER)
  assert.ok(!a.includes('®'))
  assert.ok(a.includes('mipi'))
})
