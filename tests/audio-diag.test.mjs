import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formatAudioDiag } from '../lib/audio-diag.js'

const meters = [
  { name: '扬声器 (MIPI)', peak: 0.0213 },
  { name: 'H27P6 (NVIDIA HDMI)', peak: 0 },
]

test('正常情况：列出设备、标出有声的、给出采集目标', () => {
  const out = formatAudioDiag({
    app: '腾讯会议', inMeeting: true, defaultDevice: '扬声器 (MIPI)',
    meters, target: { device: '扬声器 (MIPI)', source: 'playing' }, processLoopback: false,
  })
  assert.match(out, /腾讯会议（在会中）/)
  assert.match(out, /系统默认播放：扬声器 \(MIPI\)/)
  assert.match(out, /\[有声\] 扬声器/)
  assert.match(out, /\[静音\] H27P6/)
  assert.match(out, /将采集：扬声器 \(MIPI\)（此刻在出声）/)
  assert.match(out, /进程级环回：不可用/)
})

test('全部静音时给出明确建议，而不是只说"没声音"', () => {
  const out = formatAudioDiag({
    app: '腾讯会议', inMeeting: true, defaultDevice: 'D',
    meters: [{ name: 'A', peak: 0 }, { name: 'B', peak: 0 }],
    target: { device: 'D', source: 'system-default' },
  })
  assert.match(out, /当前所有渲染设备都静音/)
  assert.match(out, /建议：/)
})

test('不在会中时提醒先进会', () => {
  const out = formatAudioDiag({ app: '腾讯会议', inMeeting: false, meters })
  assert.match(out, /不在会中/)
  assert.match(out, /先在会议软件里进会/)
})

test('读不到电平时不崩，明确说读不到', () => {
  const out = formatAudioDiag({})
  assert.match(out, /实时电平：读不到/)
  assert.match(out, /将采集：（未确定）/)
})

test('来源能正确翻译成人话', () => {
  const out = formatAudioDiag({ meters, target: { device: 'X', source: 'configured' } })
  assert.match(out, /（配置指定）/)
})
