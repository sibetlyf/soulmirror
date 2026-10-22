/**
 * 阿里云百炼（DashScope）实时语音识别 WebSocket 客户端。
 * 协议：/api-ws/v1/inference，run-task → task-started → 二进制 PCM → result-generated → finish-task
 * 文档：https://docs.bailian.console.aliyun.com/zh/model-studio/real-time-speech-recognition-user-guide
 */
import { randomUUID } from 'node:crypto'
import { WsClient } from './ws.js'

export const DASHSCOPE_WS = 'wss://dashscope.aliyuncs.com/api-ws/v1/inference'

/**
 * @param {object} opts
 * @param {string} opts.apiKey
 * @param {string} [opts.model] paraformer-realtime-v2
 * @param {number} [opts.sampleRate] 16000
 * @param {(s:{text:string, sentenceEnd:boolean, begin?:number, end?:number}) => void} opts.onSentence
 * @param {() => void} [opts.onReady]
 * @param {(err:Error) => void} [opts.onError]
 */
export function startDashScopeAsr(opts) {
  const {
    apiKey,
    model = 'paraformer-realtime-v2',
    sampleRate = 16000,
    url = DASHSCOPE_WS,
    onSentence,
    onReady,
    onError,
    onClose,
    asr = {},
  } = opts

  // 识别参数：默认全开（中间结果天然支持；这里补齐标点/ITN/顺滑/断句/热词/上下文）
  const params = {
    format: 'pcm',
    sample_rate: sampleRate,
    language_hints: asr.languageHints || ['zh', 'en'],
    punctuation_prediction_enabled: asr.punctuation !== false,
    inverse_text_normalization_enabled: asr.itn !== false,
    disfluency_removal_enabled: asr.disfluencyRemoval !== false,
    max_sentence_silence: asr.sentenceSilenceMs || 800,
    // 实时接口只接受已编译的热词表 ID；直接下发数组会被服务端拒绝
    ...(asr.vocabularyId ? { vocabulary_id: asr.vocabularyId } : {}),
    ...(asr.context ? { context: asr.context } : {}),
    ...(asr.speakerDiarization ? { speaker_diarization_enabled: true } : {}),
  }
  if (!apiKey) throw new Error('缺少 DASHSCOPE_API_KEY')

  const ws = new WsClient({ timeoutMs: 15000 })
  const taskId = randomUUID()
  let ready = false
  let closed = false

  const emitErr = (e) => { try { onError?.(e) } catch { /* ignore */ } }

  ws.on('message', (raw) => {
    let msg
    try { msg = JSON.parse(raw) } catch { return }
    const ev = msg?.header?.event
    if (ev === 'task-started') {
      ready = true
      try { onReady?.() } catch { /* ignore */ }
      return
    }
    if (ev === 'result-generated') {
      const s = msg?.payload?.output?.sentence
      if (s && typeof s.text === 'string') {
        try {
          onSentence?.({
            text: s.text,
            sentenceEnd: !!s.sentence_end,
            begin: s.begin_time,
            end: s.end_time,
            speaker: s.speaker || '',
          })
        } catch { /* ignore */ }
      }
      return
    }
    if (ev === 'task-finished') { closed = true; try { onClose?.() } catch { /* ignore */ } return }
    if (ev === 'task-failed') {
      const m = msg?.header?.error_message || 'task-failed'
      emitErr(new Error('DashScope: ' + m))
      closed = true
    }
  })

  ws.on('close', () => {
    if (!closed) { closed = true; try { onClose?.() } catch { /* ignore */ } }
  })

  async function open() {
    await ws.connect(url, {
      Authorization: `bearer ${apiKey}`,
      'X-DashScope-DataInspection': 'enable',
    })
    ws.sendText(JSON.stringify({
      header: { action: 'run-task', task_id: taskId, streaming: 'duplex' },
      payload: {
        task_group: 'audio',
        task: 'asr',
        function: 'recognition',
        model,
        parameters: params,
        input: {},
      },
    }))
    // 等 task-started（最多 8s）
    const t0 = Date.now()
    while (!ready && !closed && Date.now() - t0 < 8000) {
      await new Promise((r) => setTimeout(r, 20))
    }
    if (!ready) throw new Error('DashScope task-started 超时')
  }

  return {
    open,
    get ready() { return ready },
    get closed() { return closed },
    send(pcm) { if (ready && !closed) ws.sendBinary(pcm) },
    async finish() {
      if (closed) return
      try {
        ws.sendText(JSON.stringify({
          header: { action: 'finish-task', task_id: taskId, streaming: 'duplex' },
          payload: { input: {} },
        }))
      } catch { /* ignore */ }
      await new Promise((r) => setTimeout(r, 300))
      try { ws.close() } catch { /* ignore */ }
    },
  }
}
