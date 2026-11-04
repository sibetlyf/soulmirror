import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseMeters, resolveCaptureTarget } from '../lib/audio-pick.js'

test('解析 meters 输出', () => {
  const rows = parseMeters('扬声器 (MIPI)\t0.0213\nH27P6 (NVIDIA HDMI)\t0.0000\nCABLE Input\t0.5')
  assert.equal(rows.length, 3)
  assert.equal(rows[0].name, '扬声器 (MIPI)')
  assert.equal(rows[0].peak, 0.0213)
  assert.equal(rows[2].peak, 0.5)
})

test('配置指定优先', () => {
  const r = resolveCaptureTarget({ configured: 'CABLE Input', defaultDevice: '扬声器', meters: [{ name: '扬声器', peak: 0.3 }] })
  assert.equal(r.device, 'CABLE Input')
  assert.equal(r.source, 'configured')
})

test('有设备正在出声 → 用那个（会议实际在用的）', () => {
  const r = resolveCaptureTarget({
    defaultDevice: 'H27P6 (NVIDIA HDMI)',
    meters: [{ name: 'H27P6 (NVIDIA HDMI)', peak: 0 }, { name: '扬声器 (MIPI)', peak: 0.02 }],
  })
  assert.equal(r.device, '扬声器 (MIPI)')
  assert.equal(r.source, 'playing')
})

test('全都静音 → 仍然定为系统默认，而不是报"请先让会议出声"', () => {
  const r = resolveCaptureTarget({
    defaultDevice: '扬声器 (MIPI)',
    meters: [{ name: '扬声器 (MIPI)', peak: 0 }, { name: 'H27P6 (NVIDIA HDMI)', peak: 0 }],
  })
  assert.equal(r.device, '扬声器 (MIPI)', '静音时也要给出一个确定答案')
  assert.equal(r.source, 'system-default')
  assert.match(r.note, /默认/)
})

test('什么都没有时返回空但不抛错', () => {
  const r = resolveCaptureTarget({})
  assert.equal(r.device, '')
  assert.equal(r.source, 'none')
})

test('峰值刚好在阈值上算"有声音"', () => {
  const r = resolveCaptureTarget({ defaultDevice: 'D', meters: [{ name: 'X', peak: 0.01 }], threshold: 0.01 })
  assert.equal(r.source, 'playing')
})
