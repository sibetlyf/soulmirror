import { readdirSync, statSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = 'C:/Users/liyafeng/.dsh/soulmirror'
const { scanAudioLevels } = await import('file:///G:/dsh-test/soulmirror/lib/offline-audio.js')

const dirs = readdirSync(root).filter((d) => d !== 'persona' && d !== 'workspace')
const rows = []
for (const d of dirs) {
  const wav = join(root, d, 'audio.wav')
  let st
  try { st = statSync(wav) } catch { continue }
  if (st.size < 200000) continue
  const scan = await scanAudioLevels(wav)
  let meta = {}
  try { meta = JSON.parse(readFileSync(join(root, d, 'meta.json'), 'utf8')) } catch { /* ignore */ }
  rows.push({
    name: d.slice(0, 24),
    min: Math.round(scan.durationSec / 60),
    silent: Math.round(scan.silentRatio * 100),
    peak: scan.peakRms,
    device: (meta.captureDevice || meta.device || meta.capture || '').toString().slice(0, 22),
  })
}

rows.sort((a, b) => b.silent - a.silent)
console.log('  静音%  时长  峰值     设备                      会议')
for (const r of rows) {
  console.log('  ' + String(r.silent).padStart(4) + '%  ' + String(r.min).padStart(3) + 'm  ' +
    String(r.peak).padEnd(8) + ' ' + (r.device || '(未记录)').padEnd(24) + ' ' + r.name)
}
const empty = rows.filter((r) => r.silent >= 95).length
const mostly = rows.filter((r) => r.silent >= 70 && r.silent < 95).length
console.log('\n  合计 ' + rows.length + ' 场：全空(≥95%) ' + empty + ' 场，大部分空(70~95%) ' + mostly + ' 场')
