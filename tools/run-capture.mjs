// 长时采集：后台跑 N 秒，逐片转写并打印
// 用法：node tools/run-capture.mjs <秒数>
import { MeetingSession } from '../lib/session.js'

const seconds = Number(process.argv[2] || 180)
const cfg = {
  devices: { capture: '', captureMode: 'loopback', speak: '', micName: '' },
  tts: { provider: 'sapi', voice: '', rate: 0 },
  asr: { provider: 'local', lang: 'zh', chunkSeconds: 6, whisperBin: '', whisperModel: '', baseUrl: '', model: '', apiKeyEnv: '', silenceRms: 0.004 },
  dataDir: 'G:/dsh-test/soulmirror/.asr-test/live',
  keepAudio: false,
}

const s = new MeetingSession(cfg, console)
let seen = 0
await s.startCapture('online')
console.log(`capture started, ${seconds}s`)

const timer = setInterval(() => {
  while (seen < s.transcript.length) {
    const it = s.transcript[seen++]
    console.log(`[${it.t.slice(11, 19)}] (rms ${it.rms?.toFixed(3)}) ${it.text}`)
  }
  if (s.lastError) console.log('!! ' + s.lastError)
}, 1000)

setTimeout(async () => {
  clearInterval(timer)
  await s.stopCapture()
  console.log('--- done, lines=' + s.transcript.length + ' chunks=' + s.chunks)
  process.exit(0)
}, seconds * 1000)
