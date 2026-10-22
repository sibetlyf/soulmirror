import { MeetingSession } from '../lib/session.js'
const cfg = {
  devices: { capture: '', captureMode: 'loopback', speak: '', micName: '' },
  tts: { provider: 'sapi', voice: 'Microsoft Huihui Desktop', rate: 0 },
  asr: { provider: 'local', lang: 'zh', chunkSeconds: 6, whisperBin: '', whisperModel: '', baseUrl: '', model: '', apiKeyEnv: '' },
  dataDir: 'G:/dsh-test/dsh-meeting-agent/.asr-test/session',
  keepAudio: false,
}
const s = new MeetingSession(cfg, console)
await s.startCapture('live')
await new Promise(r => setTimeout(r, 20000))
await s.stopCapture()
console.log('--- transcript ---')
console.log(s.formatTranscript(20))
console.log('snapshot:', JSON.stringify(s.snapshot()))
