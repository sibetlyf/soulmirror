// 端到端自检：环回采集 N 秒会议声音 → 本地 whisper 转写 → 打印文本
// 用法：node tools/test-asr-loopback.mjs [秒数]
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { bridge, toolsDir } from '../lib/bridge.js'
import { transcribeWav } from '../lib/asr.js'

const seconds = Number(process.argv[2] || 6)
const dir = join(toolsDir, '..', '.asr-test')
await mkdir(dir, { recursive: true })
const wav = join(dir, `loop-${Date.now()}.wav`)

console.log(`[1/3] 环回采集 ${seconds}s → ${wav}`)
const out = await bridge(['capture', '--out', wav, '--seconds', String(seconds), '--mode', 'loopback'], {
  timeoutMs: (seconds + 20) * 1000,
})
console.log('     ' + out)

console.log('[2/3] 本地 whisper 转写…')
const t0 = Date.now()
const r = await transcribeWav(wav, {
  provider: 'local',
  lang: 'zh',
  whisperBin: '',
  whisperModel: '',
}, console)
console.log(`[3/3] ${((Date.now() - t0) / 1000).toFixed(1)}s  ${r.ok ? 'OK' : 'ERR'}  ${r.ok ? r.text || '(空)' : r.reason}`)
