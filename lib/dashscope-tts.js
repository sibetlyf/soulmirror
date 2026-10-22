/**
 * 阿里云百炼（DashScope）语音合成 WebSocket 客户端（CosyVoice）。
 * 协议：run-task(tts) → task-started → continue-task(text) → 二进制 PCM → result-generated → finish-task
 */
import { randomUUID } from 'node:crypto'
import { WsClient } from './ws.js'

export const DASHSCOPE_TTS_WS = 'wss://dashscope.aliyuncs.com/api-ws/v1/inference'

/**
 * 流式合成：每收到一块 PCM 就回调，便于边合成边播。
 * @param {object} opts
 * @param {string} opts.apiKey
 * @param {string} [opts.model] cosyvoice-v1
 * @param {string} [opts.voice] longxiaochun
 * @param {number} [opts.sampleRate] 16000
 * @param {(pcm:Buffer)=>void} opts.onAudio
 * @param {()=>void} [opts.onReady]
 * @param {(err:Error)=>void} [opts.onError]
 */
export async function synthesizeStream(opts) {
  const {
    apiKey,
    model = 'cosyvoice-v1',
    voice = 'longxiaochun',
    sampleRate = 16000,
    url = DASHSCOPE_TTS_WS,
    onAudio,
    onReady,
    onError,
  } = opts
  if (!apiKey) throw new Error('缺少 DASHSCOPE_API_KEY')

  const ws = new WsClient({ timeoutMs: 15000 })
  const taskId = randomUUID()
  let ready = false
  let failed = null
  const done = new Promise((resolve) => {
    ws.on('message', (raw) => {
      let msg
      try { msg = JSON.parse(raw) } catch { return }
      const ev = msg?.header?.event
      if (ev === 'task-started') { ready = true; onReady?.(); return }
      if (ev === 'task-finished') { resolve('ok'); return }
      if (ev === 'task-failed') {
        failed = new Error('TTS: ' + (msg?.header?.error_message || 'task-failed'))
        onError?.(failed)
        resolve('failed')
      }
    })
    ws.on('close', () => resolve('closed'))
    ws.on('error', (e) => { failed = e; resolve('error') })
  })
  ws.on('binary', (buf) => { try { onAudio?.(buf) } catch { /* ignore */ } })

  await ws.connect(url, { Authorization: `bearer ${apiKey}` })
  ws.sendText(JSON.stringify({
    header: { action: 'run-task', task_id: taskId, streaming: 'duplex' },
    payload: {
      task_group: 'audio',
      task: 'tts',
      function: 'SpeechSynthesizer',
      model,
      parameters: {
        voice,
        text_type: 'PlainText',
        format: 'pcm',
        sample_rate: sampleRate,
        volume: 60,
        rate: 1,
        pitch: 1,
      },
      input: {},
    },
  }))

  const t0 = Date.now()
  while (!ready && !failed && Date.now() - t0 < 8000) await new Promise((r) => setTimeout(r, 20))
  if (!ready) throw failed || new Error('TTS task-started 超时')

  return {
    speak(text) {
      ws.sendText(JSON.stringify({
        header: { action: 'continue-task', task_id: taskId, streaming: 'duplex' },
        payload: { input: { text } },
      }))
    },
    async finish() {
      try {
        ws.sendText(JSON.stringify({
          header: { action: 'finish-task', task_id: taskId, streaming: 'duplex' },
          payload: { input: {} },
        }))
      } catch { /* ignore */ }
      await Promise.race([done, new Promise((r) => setTimeout(r, 15000))])
      try { ws.close() } catch { /* ignore */ }
    },
  }
}
