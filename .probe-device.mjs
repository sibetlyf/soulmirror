import { bridge, listDevices, loudestRenderDevice } from 'file:///G:/dsh-test/soulmirror/lib/bridge.js'
import { compareCaptureWithLoud, diagnoseCapture } from 'file:///G:/dsh-test/soulmirror/lib/capture-guard.js'
import { readFileSync } from 'node:fs'

const cfg = JSON.parse(readFileSync('C:/Users/liyafeng/.dsh/soulmirror/config.json', 'utf8'))
const capture = cfg.devices.capture || ''
const speak = cfg.devices.speakDevice || cfg.devices.speak || ''
console.log('配置：capture =', JSON.stringify(capture), ' speak =', JSON.stringify(speak), ' auto =', cfg.devices.captureAuto)

const dev = await listDevices()
console.log('\n渲染端点（会议可能从这些出声）：')
for (const d of (dev.render || [])) console.log('  ·', d.name)

const loud = await loudestRenderDevice({ samples: 5, intervalMs: 200 })
console.log('\n现在在出声的是：', loud ? (loud.name + ' 电平 ' + Number(loud.level).toFixed(4)) : '（没有设备在出声）')

const dg = diagnoseCapture({ capture, speak, captureAuto: cfg.devices.captureAuto })
console.log('\n静态体检：', dg.level, '—', dg.reason || '（无问题）')
if (dg.suggestion) console.log('        建议：', dg.suggestion)

const cmp = compareCaptureWithLoud({ capture, loud })
console.log('\n实测校验：', cmp.level, '—', cmp.reason || '（一致或无法判断）')
if (cmp.suggestion) console.log('        建议：', cmp.suggestion)
