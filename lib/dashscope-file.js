/**
 * 百炼「录音文件识别」（非实时）+ 说话人分离。
 *
 * 为什么走这条路：
 *   实时识别为了低延迟必须 400ms 就断句，且不做分人；
 *   会后拿到的是整段录音，用文件识别能得到完整句子 + 每个说话人的标注，
 *   更适合出纪要。
 *
 * 本地文件怎么给云端：
 *   DashScope 提供瞬时上传（getPolicy → 传 OSS → 得到 oss:// 地址），
 *   不需要用户自己有 OSS，也不需要公网可访问的 URL。
 */

const BASE = 'https://dashscope.aliyuncs.com/api/v1'

export const FILE_ASR_MODEL = 'paraformer-v2'

/** 1) 取上传凭证 */
export async function getUploadPolicy(apiKey, model = FILE_ASR_MODEL) {
  const r = await fetch(`${BASE}/uploads?action=getPolicy&model=${encodeURIComponent(model)}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  })
  const j = await r.json()
  if (!r.ok || !j?.data) throw new Error('取上传凭证失败：' + JSON.stringify(j).slice(0, 200))
  return j.data
}

/**
 * 2) 上传本地文件到 DashScope 的 OSS，返回 oss:// 地址
 * @param {{ apiKey: string, file: Buffer, fileName: string, model?: string }} o
 */
export async function uploadFile({ apiKey, file, fileName, model = FILE_ASR_MODEL }) {
  const p = await getUploadPolicy(apiKey, model)
  const key = `${p.upload_dir}/${fileName}`

  const form = new FormData()
  form.append('OSSAccessKeyId', p.oss_access_key_id)
  form.append('Signature', p.signature)
  form.append('policy', p.policy)
  form.append('key', key)
  form.append('x-oss-object-acl', p.x_oss_object_acl || 'private')
  form.append('x-oss-forbid-overwrite', p.x_oss_forbid_overwrite || 'true')
  form.append('success_action_status', '200')
  form.append('file', new Blob([file]), fileName)

  const up = await fetch(p.upload_host, { method: 'POST', body: form })
  if (!up.ok) {
    const t = await up.text().catch(() => '')
    throw new Error('上传失败 HTTP ' + up.status + ' ' + t.slice(0, 200))
  }
  return `oss://${key}`
}

/** 3) 提交文件识别任务，开启说话人分离 */
export async function submitTranscription({ apiKey, fileUrl, model = FILE_ASR_MODEL, languageHints = ['zh', 'en'], speakerCount = 0 }) {
  const body = {
    model,
    input: { file_urls: [fileUrl] },
    parameters: {
      channel_id: [0],
      language_hints: languageHints,
      diarization_enabled: true,
      ...(speakerCount > 0 ? { speaker_count: speakerCount } : {}),
    },
  }
  const r = await fetch(`${BASE}/services/audio/asr/transcription`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'X-DashScope-Async': 'enable',
      // 关键：不加这个头，服务端解析不了 oss:// 地址，一律 SERVER_ERROR / FILE_DOWNLOAD_FAILED
      'X-DashScope-OssResourceResolve': 'enable',
    },
    body: JSON.stringify(body),
  })
  const j = await r.json()
  const taskId = j?.output?.task_id
  if (!taskId) throw new Error('提交识别任务失败：' + JSON.stringify(j).slice(0, 300))
  return taskId
}

/** 4) 轮询任务，直到 SUCCEEDED / FAILED */
export async function waitTranscription({ apiKey, taskId, timeoutMs = 10 * 60 * 1000, intervalMs = 2000, signal }) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (signal?.aborted) throw new Error('已取消')
    const r = await fetch(`${BASE}/tasks/${taskId}`, { headers: { Authorization: `Bearer ${apiKey}` } })
    const j = await r.json()
    const st = j?.output?.task_status
    if (st === 'SUCCEEDED') return j.output
    if (st === 'FAILED') throw new Error('识别失败：' + JSON.stringify(j).slice(0, 1200))
    await new Promise((res) => setTimeout(res, intervalMs))
  }
  throw new Error('识别超时')
}

/**
 * 5) 取结果并归一成 [{speaker, begin, end, text}]
 * results[].transcription_url 指向一段 JSON，里面有 transcripts[].sentences[]
 */
export async function fetchTranscriptionResult(output) {
  const out = []
  const files = output?.results || []
  for (const f of files) {
    if (!f?.transcription_url) continue
    const r = await fetch(f.transcription_url)
    const j = await r.json()
    for (const tr of j.transcripts || []) {
      for (const s of tr.sentences || []) {
        const text = String(s.text || '').trim()
        if (!text) continue
        out.push({
          speaker: Number.isFinite(s.speaker_id) ? `说话人${Number(s.speaker_id) + 1}` : '',
          begin: s.begin_time ?? null,
          end: s.end_time ?? null,
          text,
        })
      }
    }
  }
  return out
}

/** 端到端：本地文件 → 带说话人的句子 */
export async function transcribeFileWithSpeakers({ apiKey, file, fileName, model = FILE_ASR_MODEL, languageHints, speakerCount = 0, onProgress, signal }) {
  onProgress?.({ stage: 'upload' })
  const fileUrl = await uploadFile({ apiKey, file, fileName, model })
  onProgress?.({ stage: 'submit', fileUrl })
  const taskId = await submitTranscription({ apiKey, fileUrl, model, languageHints, speakerCount })
  onProgress?.({ stage: 'wait', taskId })
  const output = await waitTranscription({ apiKey, taskId, signal })
  onProgress?.({ stage: 'fetch' })
  const sentences = await fetchTranscriptionResult(output)
  return { sentences, taskId, fileUrl }
}

/** 把带说话人的句子渲染成可读文本（给纪要模型或人看） */
export function renderSentences(sentences, { withTime = false } = {}) {
  return (sentences || []).map((s) => {
    const t = withTime && Number.isFinite(s.begin) ? `[${Math.floor(s.begin / 1000)}s] ` : ''
    const spk = s.speaker ? s.speaker + '：' : ''
    return t + spk + s.text
  }).join('\n')
}
