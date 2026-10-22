import { readFile, rm, writeFile } from 'node:fs/promises'

/** 对 16bit 单声道 WAV 做数字增益（限幅），用于会议音量偏小的场景 */
export async function boostWav(filePath, factor) {
  if (!(factor > 1)) return false
  const buf = await readFile(filePath)
  // 跳过 RIFF 头（本插件生成的都是 44 字节标准头）
  let off = 12
  let dataOff = -1
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4)
    const size = buf.readUInt32LE(off + 4)
    if (id === 'data') { dataOff = off + 8; break }
    off += 8 + size + (size % 2)
  }
  if (dataOff < 0) return false
  for (let i = dataOff; i + 1 < buf.length; i += 2) {
    let v = buf.readInt16LE(i) * factor
    if (v > 32767) v = 32767
    else if (v < -32768) v = -32768
    buf.writeInt16LE(v | 0, i)
  }
  await writeFile(filePath, buf)
  return true
}
import { existsSync } from 'node:fs'
import { cpus } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { run } from './proc.js'

const pluginDir = dirname(dirname(fileURLToPath(import.meta.url)))

/** 默认的本地 whisper.cpp 位置（插件自带 tools/whisper） */
export const LOCAL_ASR = {
  bin: join(pluginDir, 'tools', 'whisper', 'Release', 'whisper-cli.exe'),
  binAlt: join(pluginDir, 'tools', 'whisper', 'whisper-cli.exe'),
  model: join(pluginDir, 'tools', 'whisper', 'models', 'ggml-base.bin'),
  modelAlt: join(pluginDir, 'tools', 'whisper', 'models', 'ggml-base-q5_1.bin'),
}

export function pickLocalModel(cfg) {
  if (cfg.whisperModel && existsSync(cfg.whisperModel)) return cfg.whisperModel
  for (const p of [LOCAL_ASR.model, LOCAL_ASR.modelAlt]) if (existsSync(p)) return p
  return LOCAL_ASR.model
}

function resolveLocalBin(cfg) {
  if (cfg.whisperBin && existsSync(cfg.whisperBin)) return cfg.whisperBin
  for (const p of [LOCAL_ASR.bin, LOCAL_ASR.binAlt]) {
    if (existsSync(p)) return p
    const exe = p.replace(/\.exe$/, '')
    if (existsSync(exe)) return exe
  }
  return ''
}

/**
 * 本地 whisper.cpp 离线识别（不需要任何 Key）。
 * 会议声从 WASAPI 环回拿到的是数字音频，识别质量比麦克风拾音好很多。
 */
async function transcribeLocal(filePath, cfg, logger) {
  const bin = resolveLocalBin(cfg)
  if (!bin) return { ok: false, reason: '本地 ASR 未就绪：找不到 tools/whisper 下的 whisper 可执行文件' }
  const model = pickLocalModel(cfg)
  if (!existsSync(model)) return { ok: false, reason: '本地 ASR 缺少模型：' + model }

  const threads = Math.max(2, Math.min(16, cpus().length))
  const args = [
    '-m', model, '-f', filePath, '-l', cfg.lang || 'zh', '-nt', '--no-prints', '-otxt',
    '-t', String(threads), '-bs', '1', '-bo', '1',
    '--prompt', '以下是普通话的句子，请用简体中文转写。',
  ]
  const r = await run(bin, args, { timeoutMs: 120000 })
  if (r.code !== 0) {
    return { ok: false, reason: `whisper 退出码 ${r.code}: ${(r.stderr || r.stdout || '').slice(0, 300)}` }
  }
  // -otxt 会把结果写到 <file>.txt，同时 stdout 里也有一份
  const text = (r.stdout || '')
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s && !s.startsWith('[') && !/^whisper/i.test(s))
    .join(' ')
    .trim()
  return { ok: true, text }
}

/** OpenAI 兼容的 /v1/audio/transcriptions */
async function transcribeOpenai(filePath, cfg, logger) {
  if (!cfg.baseUrl) return { ok: false, reason: 'ASR 未配置 baseUrl' }
  const key = process.env[cfg.apiKeyEnv] || cfg.apiKey || ''
  if (!key) return { ok: false, reason: `ASR 缺少密钥：环境变量 ${cfg.apiKeyEnv} 未设置` }

  const buf = await readFile(filePath)
  const fd = new FormData()
  fd.set('file', new Blob([buf], { type: 'audio/wav' }), 'chunk.wav')
  fd.set('model', cfg.model || 'whisper-1')
  if (cfg.lang) fd.set('language', cfg.lang)
  fd.set('response_format', 'json')

  const url = cfg.baseUrl.replace(/\/+$/, '') + '/audio/transcriptions'
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}` },
      body: fd,
      signal: AbortSignal.timeout(60000),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      return { ok: false, reason: `ASR HTTP ${res.status}: ${body.slice(0, 200)}` }
    }
    const data = await res.json()
    return { ok: true, text: (data.text || data.result || '').trim() }
  } catch (err) {
    logger?.warn?.(`[soulmirror] ASR 失败: ${err.message}`)
    return { ok: false, reason: err.message }
  }
}

export async function transcribeWav(filePath, cfg, logger) {
  if (!cfg || cfg.provider === 'none') {
    return { ok: false, reason: 'ASR 未配置（asr.provider = none）' }
  }
  if (cfg.provider === 'local') return transcribeLocal(filePath, cfg, logger)
  if (cfg.provider === 'openai') return transcribeOpenai(filePath, cfg, logger)
  return { ok: false, reason: `未知 ASR provider: ${cfg.provider}` }
}

export async function removeFile(path) {
  try { await rm(path, { force: true }) } catch { /* ignore */ }
  try { await rm(path.replace(/\.wav$/i, '.txt'), { force: true }) } catch { /* ignore */ }
}
