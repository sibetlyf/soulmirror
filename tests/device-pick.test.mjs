import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pickCaptureDevice } from '../lib/bridge.js'

const DEFAULT_DEV = '扬声器 (MIPI)'
const HDMI = 'H27P6 (NVIDIA HDMI)'
const CABLE = 'CABLE Input (VB-Audio Virtual Cable)'

test('配置里显式指定 → 用配置的', () => {
  const r = pickCaptureDevice({ configured: CABLE, defaultDevice: DEFAULT_DEV, loud: { name: HDMI, level: 0.9 } })
  assert.equal(r.device, CABLE)
  assert.equal(r.why, '配置指定')
})

test('没配置、默认设备正常 → 用系统默认播放设备', () => {
  const r = pickCaptureDevice({ configured: '', defaultDevice: DEFAULT_DEV, loud: null })
  assert.equal(r.device, DEFAULT_DEV)
  assert.equal(r.why, '系统默认播放设备')
})

test('别的设备正在出声 → 用那个（应用实际在这里播）', () => {
  const r = pickCaptureDevice({ configured: '', defaultDevice: DEFAULT_DEV, loud: { name: HDMI, level: 0.62 } })
  assert.equal(r.device, HDMI)
  assert.match(r.why, /正在出声/)
})

test('出声设备就是默认设备 → 仍用默认，不啰嗦', () => {
  const r = pickCaptureDevice({ configured: '', defaultDevice: DEFAULT_DEV, loud: { name: DEFAULT_DEV, level: 0.7 } })
  assert.equal(r.device, DEFAULT_DEV)
  assert.equal(r.why, '系统默认播放设备')
})

test('电平太低不算"正在出声"（避免底噪误判）', () => {
  const r = pickCaptureDevice({ configured: '', defaultDevice: DEFAULT_DEV, loud: { name: HDMI, level: 0.01 } })
  assert.equal(r.device, DEFAULT_DEV)
})

test('拿不到默认设备时给出空（让系统自己选）', () => {
  const r = pickCaptureDevice({ configured: '', defaultDevice: '', loud: null })
  assert.equal(r.device, '')
  assert.match(r.why, /未检测到/)
})

test('阈值可调', () => {
  const r = pickCaptureDevice({ configured: '', defaultDevice: DEFAULT_DEV, loud: { name: HDMI, level: 0.06 }, loudThreshold: 0.5 })
  assert.equal(r.device, DEFAULT_DEV)
})
