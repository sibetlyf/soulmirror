/**
 * 会后的离线重转写。
 *
 * 为什么需要：
 *   实时识别为了低延迟，会在句末静音 400ms 就断句，遇到打断、口音、网络抖动会丢句子；
 *   会后录音已经在本地，用同一路音频"慢慢跑一遍"（快速重放）能拿到完整、干净的文本。
 *
 * 说话人区分（diarization）不在这里做：
 *   我们用的 paraformer-realtime 系列不做分人；分人需要
 *   - DashScope 录音文件识别（paraformer-v2 + diarization_enabled），要求音频有公网 URL 或 OSS；
 *   - 或本地声纹聚类（CAM++ 27MB onnx）。
 *   两条路都要额外的账号权限或模型文件，所以先把它留成显式开关。
 */
import { readFileSync } from 'node:fs'
import { startDashScopeAsr } from './dashscope.js'

/** 读 PCM16 WAV（跳过 44 字节头）；返回 { pcm, sampleRate, channels, seconds } */
export function readWavPcm(file) {
  const buf = readFileSync(file)
  if (buf.length < 44 || buf.toString('ascii', 0, 4) !== 'RIFF') {
    return { pcm: buf, sampleRate: 16000, channels: 1, seconds: buf.length / 2 / 16000 }
  }
  const channels = buf.readUInt16LE(22) || 1
  const sampleRate = buf.readUInt32LE(24) || 16000
  const bits = buf.readUInt16LE(34) || 16
  const pcm = buf.subarray(44)
  const frames = pcm.length / (channels * (bits / 8))
  return { pcm, sampleRate, channels, seconds: frames / sampleRate }
}

/**
 * 把一整段 PCM 用实时协议"快速重放"，收集完整句子。
 * @param {{ apiKey: string, model: string, pcm: Buffer, sampleRate?: number, speed?: number,
 *           onSentence?: (s:any)=>void, signal?: AbortSignal }} o
 * @returns {Promise<{ sentences: Array<{begin:number,end:number,text:string}>, text: string }>}
 */
export async function transcribeOffline({
  apiKey, model = 'paraformer-realtime-v2', pcm, sampleRate = 16000, speed = 4, onSentence,
} = {}) {
  const sentences = []
  if (!pcm || pcm.length === 0) return { sentences, text: '' }

  const asr = startDashScopeAsr({
    apiKey,
    model,
    sampleRate,
    asr: { sentenceSilenceMs: 400 },
    onSentence: (s) => {
      if (!s.sentenceEnd) return
      const text = String(s.text || '').trim()
      if (!text) return
      const item = { begin: s.begin ?? null, end: s.end ?? null, text }
      sentences.push(item)
      try { onSentence?.(item) } catch { /* ignore */ }
    },
    onError: () => { /* 失败由下面的 finish 兜底 */ },
  })

  await asr.open()

  // 快速重放：按 speed 倍速喂，留出服务端处理余量
  const bytesPerMs = (sampleRate * 2) / 1000
  const chunkMs = 100
  const chunkBytes = Math.max(2, Math.round(chunkMs * bytesPerMs))
  const waitMs = Math.max(5, Math.round(chunkMs / Math.max(1, speed)))

  for (let off = 0; off < pcm.length; off += chunkBytes) {
    try { asr.send(pcm.subarray(off, Math.min(off + chunkBytes, pcm.length))) } catch { break }
    await new Promise((r) => setTimeout(r, waitMs))
  }
  // 等最后一句落地
  await new Promise((r) => setTimeout(r, 1200))
  try { await asr.finish() } catch { /* ignore */ }

  return { sentences, text: sentences.map((s) => s.text).join('\n') }
}

/** 用离线结果生成纪要；没有模型时退化为抽取式 */
export async function buildOfflineMinutes({ sentences, completer, limit = 400 }) {
  const lines = (sentences || []).slice(-limit).map((s) => s.text).filter(Boolean)
  if (lines.length === 0) return ''
  const text = lines.join('\n')
  if (completer) {
    try {
      const out = await completer([
        { role: 'system', content: '你是会议纪要助手。输出 Markdown：## 决议 / ## 待办 / ## 风险 / ## 未决问题，没有就写“无”。只依据给定内容，不要编造。' },
        { role: 'user', content: text },
      ])
      if (out && out.trim()) return out.trim()
    } catch { /* 退化为抽取式 */ }
  }
  return '## 会议要点（抽取式）\n' + lines.slice(-12).map((l) => '- ' + l).join('\n')
}
