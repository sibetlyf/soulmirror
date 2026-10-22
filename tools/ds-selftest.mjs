// 阿里云链路自检：TTS(cosyvoice) → CABLE → ASR(paraformer) → 繁转简
// 用法：set DASHSCOPE_API_KEY=sk-... && node tools/ds-selftest.mjs
import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { synthesizeStream } from '../lib/dashscope-tts.js'
import { startDashScopeAsr } from '../lib/dashscope.js'
import { toSimplified } from '../lib/t2s.js'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const MB = join(root, 'tools', 'mbridge.exe')
const key = process.env.DASHSCOPE_API_KEY
if (!key) { console.log('SKIP 没有 DASHSCOPE_API_KEY'); process.exit(2) }

const SENTENCE = '大家好，我是会议助手，正在测试阿里云实时语音识别。'

// 1) 采集（虚拟线）
const cap = spawn(MB, ['capture-stream', '--mode', 'device', '--device', 'CABLE Output'], { stdio: ['ignore', 'pipe', 'pipe'] })
const sentences = []
let firstPartialAt = 0
const t0 = Date.now()
const asr = startDashScopeAsr({
  apiKey: key,
  model: 'paraformer-realtime-v2',
  asr: {
    hotwords: ['会议助手', '会议纪要', '阿里云'],
    context: '这是一场产品周会，涉及排期、预算、上线时间。',
    sentenceSilenceMs: 700,
    punctuation: true,
    itn: true,
    disfluencyRemoval: true,
  },
  onSentence: (s) => {
    if (!firstPartialAt && s.text) firstPartialAt = Date.now() - t0
    if (s.sentenceEnd && s.text.trim()) sentences.push({ text: s.text.trim(), begin: s.begin, end: s.end })
  },
})
await asr.open(); console.log('ASR open')
cap.stdout.on('data', (d) => asr.send(d))

// 2) 合成并播放到虚拟线
const pc = spawn(MB, ['stream-play', '--device', 'CABLE Input', '--rate', '16000'], { stdio: ['pipe', 'ignore', 'pipe'] })
const tts = await synthesizeStream({
  apiKey: key, model: 'cosyvoice-v2', voice: 'longxiaochun_v2', sampleRate: 16000,
  onAudio: (b) => { try { pc.stdin.write(b) } catch { /* ignore */ } },
})
console.log('TTS ready'); tts.speak(SENTENCE)
await tts.finish(); console.log('TTS done')
try { pc.stdin.end() } catch { /* ignore */ }
await new Promise((r) => pc.on('close', r))
await new Promise((r) => setTimeout(r, 2500))
cap.kill(); console.log('cap killed')
await asr.finish(); console.log('ASR closed')

const raw = sentences.map((x) => x.text).join('')
const sim = toSimplified(raw)
console.log('TTS 文本:', SENTENCE)
console.log('ASR 原文:', raw || '(空)')
console.log('繁转简  :', sim || '(空)')
console.log('首字延迟:', firstPartialAt + 'ms')
console.log('时间戳:', JSON.stringify(sentences.map((x) => [x.begin, x.end])))
const hit = sim.includes('会议助手') || sim.replace(/[，。！？\s]/g, '').includes('会议助手')
console.log(hit ? 'RESULT PASS' : 'RESULT FAIL')
process.exit(hit ? 0 : 1)
