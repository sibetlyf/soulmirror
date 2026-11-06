import { listDevices, loudestRenderDevice } from 'file:///G:/dsh-test/soulmirror/lib/bridge.js'
import { compareCaptureWithLoud, diagnoseCapture } from 'file:///G:/dsh-test/soulmirror/lib/capture-guard.js'
import { scanAudioLevels } from 'file:///G:/dsh-test/soulmirror/lib/offline-audio.js'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const cfg = JSON.parse(readFileSync('C:/Users/liyafeng/.dsh/soulmirror/config.json', 'utf8'))
const capture = cfg.devices.capture || ''
const speak = cfg.devices.speakDevice || cfg.devices.speak || ''

// ① 设备清单（listDevices 是扁平数组，flow 区分渲染/采集）
const dev = await listDevices()
const render = (Array.isArray(dev) ? dev : []).filter((d) => d.flow === 'RENDER')
console.log('渲染端点 ' + render.length + ' 个：')
for (const d of render) console.log('  · ' + d.name)

const loud = await loudestRenderDevice({ samples: 5, intervalMs: 200 })
console.log('\n现在在出声：', loud ? loud.name + '（' + Number(loud.level).toFixed(4) + '）' : '没有设备在出声')

const dg = diagnoseCapture({ capture, speak, captureAuto: cfg.devices.captureAuto })
const cmp = compareCaptureWithLoud({ capture, loud })
console.log('静态体检：' + dg.level + ' — ' + (dg.reason || '无问题'))
console.log('实测校验：' + cmp.level + ' — ' + (cmp.reason || '一致或无法判断'))

// ② 历史录音里"声音出现在哪些时段"——判断是不是设备中途变了
console.log('\n声音时间分布（每 2 分钟一格，█=有声）：')
const root = 'C:/Users/liyafeng/.dsh/soulmirror'
for (const d of readdirSync(root)) {
  if (d === 'persona' || d === 'workspace') continue
  const wav = join(root, d, 'audio.wav')
  try { if (statSync(wav).size < 200000) continue } catch { continue }
  const s = await scanAudioLevels(wav, { windowMs: 2000 })
  if (!s.ok) continue
  const strip = s.windows.map((w) => (w.rms >= 0.006 ? '█' : '·')).join('')
  const shown = strip.length > 60 ? strip.slice(0, 60) : strip
  console.log('  ' + d.slice(0, 22).padEnd(23) + ' 静音' + String(Math.round(s.silentRatio * 100)).padStart(3) + '%  ' + shown)
}
