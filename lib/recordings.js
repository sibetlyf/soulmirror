/**
 * 会议录音的"能不能整理"判定、历史录音清单、以及本机音频导入。
 *
 * 为什么单独一个模块：
 *   ① 「会后整理」卡片以前只判断 `audio.wav` 在不在，于是 0 字节的 audio.pcm、
 *      整场静音的录音都只报一句"没有录音文件（本次可能没采到音频）"，
 *      用户不知道是没采集、没落成文件、还是采到了但全是静音 —— 三种毛病修法完全不同。
 *   ② 用户要"选之前的一整场录音来转写纪要"。这里只做**只读解析与复制**：
 *      不执行任何 shell、不转换格式（不合规就明确拒绝并给出 ffmpeg 命令，由用户自己跑）。
 */
import {
  existsSync, statSync, readdirSync, openSync, readSync, closeSync, fstatSync,
  writeFileSync, readFileSync, unlinkSync, createReadStream, createWriteStream, lstatSync,
  statfsSync,
} from 'node:fs'
import { join, sep, resolve, dirname, basename, extname, isAbsolute } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { loadMeta, loadPreparation } from './meeting-record.js'
import { readWavHeader } from './offline-asr.js'
import { scanAudioLevels } from './offline-audio.js'

/** 只接受这两种"音频原始文件" */
export const AUDIO_EXTS = Object.freeze(['.wav', '.pcm'])
/** 单个文件上限 2 GiB（再大就不是"导入一段录音"，而是搬归档） */
export const MAX_IMPORT_BYTES = 2 * 1024 * 1024 * 1024
/**
 * 选保存位置时必须给会议留出的空间（200 MiB）。
 * 一场会 audio.wav 约 115 MB/小时（16k/16bit/单声道），留 200MB 只够录一场多；
 * 小于这个值就明确拒绝，否则用户"选了个快满的盘"，录到一半写失败更难解释。
 */
export const MIN_STORAGE_FREE_BYTES = 200 * 1024 * 1024
/** 会议目录名是 ISO 时间戳（导入目录是 `<时间戳>-import`） */
export const TIMESTAMP_DIR = /^\d{4}-\d{2}-\d{2}/
/** 三种"没有可用录音"的统一出口文案（hint 必须能让人下一步动手） */
export const NO_AUDIO_HINTS = Object.freeze({
  noCapture: '检查「设置 → 设备」里的采集设备；或改用「之前的录音」导入一段',
  noFile: '检查「设置 → 设备」里的采集设备；或改用「之前的录音」导入一段',
  silent: '确认会议声音从被采集的那个设备输出',
})

/** @param {string} file */
function fileSize(file) {
  try { return statSync(file).size || 0 } catch { return 0 }
}

/** 统一拒绝形状：所有失败都要带 reason + 人话 + 下一步 */
function reject(reason, message, hint) {
  return { ok: false, reason, message, hint: hint || '' }
}

/**
 * 判断一个会议目录"为什么不能整理"。
 *
 * 三种情况必须分开（用户要能据此决定下一步做什么）：
 *   no-capture    采集阶段就没收到数据（meta.capture.bytes === 0，且有采集时长证据）
 *   no-audio-file 目录里根本没有留下音频（既没有 audio.wav，也没有有内容的 audio.pcm）
 *   silent        音频在，但 meta 判定整场几乎静音（整理出来会是空纪要）
 *
 * 两种调用形状都支持（宿主内部用对象，测试/工具可直接传位置参数）：
 *   classifyNoAudio({ meta, wavBytes, pcmBytes })
 *   classifyNoAudio(meta, ['audio.wav', ...])
 *
 * @param {{meta?: object|null, wavBytes?: number, pcmBytes?: number}|object|null} input
 * @param {string[]|null} [files]
 * @returns {null | {reason: string, message: string, hint: string}}
 */
export function classifyNoAudio(input = {}, files = null) {
  const positional = Array.isArray(files)
  const meta = positional ? (input || null) : (input && input.meta !== undefined ? input.meta : null)
  let wavBytes, pcmBytes
  if (positional) {
    const names = (files || []).map((f) => String(f || ''))
    const hasWav = names.some((n) => n === 'audio.wav' || /\.wav$/i.test(n))
    const hasPcm = names.some((n) => n === 'audio.pcm' || /\.pcm$/i.test(n))
    const cap = Number(meta && meta.capture && meta.capture.bytes) || 0
    wavBytes = hasWav ? Math.max(cap, 1) : 0
    pcmBytes = hasPcm ? Math.max(cap, 1) : 0
    if (!hasWav && !hasPcm && cap > 0) wavBytes = cap   // 只给 meta 时，bytes>0 也算"有音频"
  } else {
    wavBytes = Number(input && input.wavBytes) || 0
    pcmBytes = Number(input && input.pcmBytes) || 0
  }
  const usable = wavBytes > 0 || pcmBytes > 0
  // 音频才是硬证据：文件在就按"有音频"往下走，避免 meta 写错把真录音判死。
  if (!usable) {
    const cap = (meta && meta.capture) || null
    const captureBytes = Number(cap && cap.bytes) || 0
    const ran = !!(cap && (Number(cap.durationSec) > 0 || Number(cap.silentSec) > 0))
    // 只有"采集确实跑过（有时长/静音秒数）却写了 0 字节"才叫没采到；
    // 连时长都没有的记录，只能如实说"没有留下音频文件"。
    if (cap && captureBytes === 0 && ran) {
      return {
        reason: 'no-capture',
        message: '这次没采到任何音频（0 字节，采集进程没起来或设备不可用）',
        hint: NO_AUDIO_HINTS.noCapture,
      }
    }
    return {
      reason: 'no-audio-file',
      message: '这段会议没有留下音频文件',
      hint: NO_AUDIO_HINTS.noFile,
    }
  }
  // 只有真正落成 audio.wav 的才能判定静音（pcm 可能是没来得及封装的半截数据）
  if (wavBytes > 0) {
    const cap = (meta && meta.capture) || {}
    const sr = cap.silentRatio
    const silentRatio = (sr === null || sr === undefined || sr === '') ? null : (Number.isFinite(Number(sr)) ? Number(sr) : null)
    const verdict = String(cap.verdict || '')
    if ((silentRatio !== null && silentRatio >= 0.98) || verdict.includes('静音')) {
      return {
        reason: 'silent',
        message: '音频几乎静音，整理出来会是空纪要',
        hint: NO_AUDIO_HINTS.silent,
      }
    }
  }
  return null
}

/**
 * 一个会议目录的录音状态（给接口和界面用；不猜、全部来自磁盘）。
 * @param {string} dir
 */
export function inspectRecord(dir) {
  const out = {
    dir: String(dir || ''), ok: false, reason: '', message: '', hint: '',
    wavBytes: 0, pcmBytes: 0, bytes: 0, seconds: 0,
    captureBytes: 0, silentRatio: null, verdict: '',
    meta: null,
  }
  if (!out.dir) {
    out.reason = 'no-audio-file'
    out.message = '还没有会议目录'
    out.hint = NO_AUDIO_HINTS.noFile
    return out
  }
  if (!existsSync(out.dir)) {
    out.reason = 'missing-dir'
    out.message = '这条记录已被删除，或目录不存在'
    out.hint = '从「之前的录音」里选一场，或导入本机的音频文件'
    return out
  }
  out.wavBytes = fileSize(join(out.dir, 'audio.wav'))
  out.pcmBytes = fileSize(join(out.dir, 'audio.pcm'))
  const meta = loadMeta(out.dir)
  out.meta = meta
  const cap = (meta && meta.capture) || {}
  out.captureBytes = Number(cap.bytes) || 0
  const sr = cap.silentRatio
  out.silentRatio = (sr === null || sr === undefined || sr === '') ? null : (Number.isFinite(Number(sr)) ? Number(sr) : null)
  out.verdict = String(cap.verdict || '')
  if (out.wavBytes > 0) {
    try { out.seconds = readWavHeader(join(out.dir, 'audio.wav')).seconds } catch { out.seconds = 0 }
  }
  if (!out.seconds && out.pcmBytes > 0) out.seconds = out.pcmBytes / 32000
  out.seconds = Number(out.seconds.toFixed(1))
  out.bytes = out.wavBytes || out.pcmBytes
  const problem = classifyNoAudio({ meta, wavBytes: out.wavBytes, pcmBytes: out.pcmBytes })
  if (problem) {
    out.reason = problem.reason
    out.message = problem.message
    out.hint = problem.hint
  } else {
    out.ok = true
  }
  return out
}

/** 路径比较用的规范键（Windows 不区分大小写） */
function pathKeyOf(p) {
  const s = resolve(String(p || '')).replace(/[\\/]+$/, '')
  return process.platform === 'win32' ? s.toLowerCase() : s
}

/**
 * 统一 root 入参：支持单根字符串、`[{path, kind}]`，或字符串数组。
 * 返回 `[{path, kind}]`，按 path 去重（同一个根不会因为写了两遍就扫两遍）。
 *
 * @param {string|Array<string|{path?: string, kind?: string}>} root
 */
export function normalizeRoots(root) {
  const input = Array.isArray(root) ? root : (root ? [root] : [])
  const out = []
  const seen = new Set()
  for (const it of input) {
    if (!it) continue
    const path = String(typeof it === 'string' ? it : (it.path || '')).trim()
    if (!path) continue
    const key = pathKeyOf(path)
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ path, kind: (typeof it === 'object' && it.kind === 'custom') ? 'custom' : 'default' })
  }
  return out
}

/**
 * 会议时间（用于合并多个根时排序）：优先 meta 里的结束/开始时间，
 * 其次按目录名（`2026-11-04-1520-...` → 2026-11-04 15:20），都没有就是 0。
 */
function recordStampOf(row, name) {
  const t = Date.parse(String((row && (row.endedAt || row.startedAt)) || ''))
  if (Number.isFinite(t) && t > 0) return t
  const raw = String(name || '').trim()
  const m = /^(\d{4}-\d{2}-\d{2})-(\d{2})(\d{2})/.exec(raw)
  if (m) {
    const t2 = Date.parse(m[1] + 'T' + m[2] + ':' + m[3] + ':00')
    if (Number.isFinite(t2)) return t2
  }
  const only = /^(\d{4}-\d{2}-\d{2})/.exec(raw)
  if (only) {
    const t3 = Date.parse(only[1] + 'T00:00:00')
    if (Number.isFinite(t3)) return t3
  }
  return 0
}

/**
 * 列出历史录音（新的在前）。
 *
 * 没有可用音频的目录也保留在清单里（hasAudio=false + reason/hint），
 * 否则用户找不到"那条记录去哪了"；同时用 unsupportedCount 汇总，界面可以说"还有 N 条没音频"。
 * 但界面绝不能给 hasAudio=false 的行显示"转写并出纪要"——点了必然失败。
 *
 * 支持**多个会议根**（默认根 + 用户配置的保存位置）：两处都要看，
 * 否则"换了保存位置，以前的会议就消失了"。每条带 `root: 'default'|'custom'`，
 * 界面据此标注它在哪；同一个目录（根配成子目录时）只出现一次。
 *
 * @param {string|Array<string|{path: string, kind?: string}>} root 会议数据根目录（一个或多个）
 * @param {{limit?: number}} [opts]
 * @returns {{recordings: object[], unsupportedCount: number, silentCount: number, total: number, scanned: number, roots: Array<{path: string, kind: string}>}}
 */
export function listRecordings(root, { limit = 60 } = {}) {
  const out = { recordings: [], unsupportedCount: 0, silentCount: 0, total: 0, scanned: 0, roots: [], byRoot: {} }
  const roots = normalizeRoots(root)
  if (!roots.length) return out
  out.roots = roots.map((r) => ({ path: r.path, kind: r.kind }))
  for (const r of roots) out.byRoot[r.kind] = 0
  const rows = []
  const seen = new Set()
  for (const r of roots) {
    let entries = []
    try { entries = readdirSync(r.path, { withFileTypes: true }) } catch { continue }
    const names = entries
      .filter((d) => d.isDirectory() && TIMESTAMP_DIR.test(d.name))
      .map((d) => d.name)
      .sort()
      .reverse()
    out.scanned += names.length
    for (const name of names) {
      const dir = join(r.path, name)
      const key = pathKeyOf(dir)
      if (seen.has(key)) continue
      seen.add(key)
      const rec = inspectRecord(dir)
      if (rec.reason === 'missing-dir') continue
      const hasAudio = rec.wavBytes > 0 || rec.pcmBytes > 0
      if (!hasAudio) out.unsupportedCount += 1
      if (rec.reason === 'silent') out.silentCount += 1
      const meta = rec.meta || {}
      let prep = { goal: '' }
      try { prep = loadPreparation(dir) || prep } catch { /* ignore */ }
      let minutesBytes = 0, minutesAt = ''
      try {
        const st = statSync(join(dir, 'minutes.md'))
        minutesBytes = st.size
        if (minutesBytes > 0) minutesAt = new Date(st.mtimeMs).toISOString()
      } catch { /* ignore */ }
      const transcriptBytes = fileSize(join(dir, 'transcript-offline.jsonl')) || fileSize(join(dir, 'transcript.jsonl'))
      const row = {
        dir,
        // 这条记录在哪个根里：default=默认数据目录，custom=用户配置的保存位置
        root: r.kind,
        kind: meta.source === 'import' ? 'import' : 'meeting',
        title: String(meta.title || prep.goal || name),
        startedAt: String(meta.startedAt || ''),
        endedAt: String(meta.endedAt || ''),
        seconds: rec.seconds,
        bytes: rec.bytes,
        hasMinutes: minutesBytes > 0,
        minutesAt,
        hasTranscript: transcriptBytes > 0,
        // 事实字段：界面按 hasAudio 决定要不要给"转写并出纪要"
        hasAudio,
        // 不能整理的原因（三类 + 已删除）；空串 = 可以整理
        reason: rec.reason || '',
        message: rec.message || '',
        hint: rec.hint || '',
      }
      if (meta.source === 'import') row.originalPath = String(meta.originalPath || '')
      rows.push({ row, name })
      out.byRoot[r.kind] = (out.byRoot[r.kind] || 0) + 1
    }
  }
  // 合并多个根后统一按时间倒序：两个根各自排序不足以让"整体最新"排在最前
  rows.sort((a, b) => (recordStampOf(b.row, b.name) - recordStampOf(a.row, a.name)) ||
    (a.name < b.name ? 1 : a.name > b.name ? -1 : 0))
  const flat = rows.map((x) => x.row)
  out.total = flat.length
  out.recordings = flat.slice(0, Math.max(1, Number(limit) || 60))
  return out
}

/** 44 字节标准 PCM WAV 头（16k/16bit/单声道时 data 里就是裸 PCM 的长度） */
export function pcmWavHeader(dataBytes, { sampleRate = 16000, channels = 1, bits = 16 } = {}) {
  const blockAlign = channels * (bits / 8)
  const byteRate = sampleRate * blockAlign
  const out = Buffer.alloc(44)
  out.write('RIFF', 0, 'ascii')
  out.writeUInt32LE(36 + dataBytes, 4)
  out.write('WAVE', 8, 'ascii')
  out.write('fmt ', 12, 'ascii')
  out.writeUInt32LE(16, 16)
  out.writeUInt16LE(1, 20)          // PCM
  out.writeUInt16LE(channels, 22)
  out.writeUInt32LE(sampleRate, 24)
  out.writeUInt32LE(byteRate, 28)
  out.writeUInt16LE(blockAlign, 32)
  out.writeUInt16LE(bits, 34)
  out.write('data', 36, 'ascii')
  out.writeUInt32LE(dataBytes, 40)
  return out
}

/** 裸 PCM → 完整 WAV（小文件用；大文件走 writeWavFromPcm 流式写，避免读满内存） */
export function pcmToWavBuffer(pcm, opts = {}) {
  const buf = Buffer.isBuffer(pcm) ? pcm : Buffer.from(pcm || [])
  if (!(buf.length >= 2)) throw new Error('PCM 数据是空的（没有 16bit 样本），不能生成 WAV')
  const even = buf.length - (buf.length % 2)   // 16bit 样本必须两字节对齐
  return Buffer.concat([pcmWavHeader(even, opts), buf.subarray(0, even)])
}

/**
 * 解析 WAV 头（配合 readWavFormat 只读前 64KB）。
 * @param {Buffer} head
 * @param {number} [totalBytes]
 */
export function parseWavHeader(head, totalBytes = head ? head.length : 0) {
  const out = { riff: false, wav: false, channels: 0, sampleRate: 0, bits: 0, formatTag: 0, dataOffset: 44, dataBytes: 0, totalBytes: Number(totalBytes) || 0 }
  if (!head || head.length < 12) return out
  if (head.toString('ascii', 0, 4) !== 'RIFF' || head.toString('ascii', 8, 12) !== 'WAVE') return out
  out.riff = true
  out.wav = true
  let off = 12
  while (off + 8 <= head.length) {
    const id = head.toString('ascii', off, off + 4)
    const size = head.readUInt32LE(off + 4)
    if (id === 'fmt ' && off + 24 <= head.length) {
      out.formatTag = head.readUInt16LE(off + 8)
      out.channels = head.readUInt16LE(off + 10) || 0
      out.sampleRate = head.readUInt32LE(off + 12) || 0
      out.bits = head.readUInt16LE(off + 22) || 0
    } else if (id === 'data') {
      out.dataOffset = off + 8
      const rest = Math.max(0, out.totalBytes - out.dataOffset)
      out.dataBytes = size === 0 || size === 0xFFFFFFFF ? rest : Math.min(size, rest)
      break
    }
    off += 8 + size + (size % 2)
  }
  return out
}

/** 只读文件头解析格式（几十分钟的录音也不会被整份读进内存） */
export function readWavFormat(file) {
  const fd = openSync(file, 'r')
  try {
    const total = fstatSync(fd).size
    const head = Buffer.alloc(Math.min(65536, Math.max(64, total)))
    const n = readSync(fd, head, 0, head.length, 0)
    return parseWavHeader(head.subarray(0, Math.max(0, n)), total)
  } finally {
    closeSync(fd)
  }
}

/** 是否是会后整理需要的格式：16k / 16bit / 单声道 / 有音频数据 */
export function isTargetWavFormat(fmt) {
  return !!(fmt && fmt.wav && fmt.channels === 1 && fmt.sampleRate === 16000 && fmt.bits === 16 && fmt.dataBytes > 0)
}

/** 格式的人话描述（不带任何路径/环境变量） */
export function describeWavFormat(fmt) {
  if (!fmt || !fmt.wav) return '不是合法的 WAV'
  return (fmt.sampleRate || '?') + ' Hz / ' + (fmt.channels || '?') + ' 通道 / ' + (fmt.bits || '?') + ' bit'
}

/** 给用户的 ffmpeg 命令（插件**不会**自动执行；只是让他们复制去跑）。 */
export function ffmpegCommand(src, dst) {
  const q = (p) => '"' + String(p || '').replace(/"/g, '\\"') + '"'
  return 'ffmpeg -i ' + q(src) + ' -ac 1 -ar 16000 -sample_fmt s16 ' + q(dst)
}

/** 超过这个体积就不做静音预扫描（导入本身是拷贝，几 GB 的预扫描只会让用户干等） */
const PRE_SCAN_MAX_BYTES = 300 * 1024 * 1024

/**
 * 校验"要导入的本机音频文件"。只读 stat / 头 / 电平，**不执行任何 shell，不做转码**。
 *
 * 失败一律返回 { ok:false, reason, message, hint }，reason ∈
 *   bad-path / not-found / not-a-file / unsupported-format / too-large / bad-format / no-audio
 * 成功返回 { ok:true, path, ext, size, format }（format 只有 .wav 才有）。
 *
 * @param {string} input 本机绝对路径
 * @returns {Promise<object>}
 */
export async function validateImportSource(input) {
  const raw = String(input || '').trim()
  if (!raw) return reject('bad-path', '没有提供音频文件路径', '粘贴本机绝对路径，例如 C:\\Users\\你\\Downloads\\meeting.wav')
  if (!isAbsolute(raw)) return reject('bad-path', '只接受本机绝对路径（现在是相对路径）', '例如 C:\\Users\\你\\Downloads\\meeting.wav')
  let st
  try { st = lstatSync(raw) } catch {
    return reject('not-found', '找不到这个文件：' + basename(raw), '确认路径存在；带空格/中文时也要写完整路径')
  }
  if (st.isSymbolicLink()) {
    try { st = statSync(raw) } catch { return reject('not-found', '这个链接指向的文件读不到', '确认链接目标还在，或直接用真实文件路径') }
    if (st.isDirectory()) return reject('not-a-file', '这个链接指向的是目录，不是音频文件', '导入单个 .wav 或 .pcm 文件')
  }
  // 先判"是不是文件"，再判扩展名：目录不该被说成"格式不支持"
  if (!st.isFile()) return reject('not-a-file', '只能导入文件（目录、设备等都不行）', '导入单个 .wav 或 .pcm 文件')
  const ext = extname(raw).toLowerCase()
  const outWav = join(dirname(raw), basename(raw, ext) + '-16k.wav')
  if (!AUDIO_EXTS.includes(ext)) {
    return reject('unsupported-format', '只支持 .wav 和 .pcm（这个文件是 ' + (ext || '没有扩展名') + '）',
      '其它格式先用 ffmpeg 转一下（插件不会自动执行）：' + ffmpegCommand(raw, outWav))
  }
  if (st.size > MAX_IMPORT_BYTES) {
    return reject('too-large', '文件太大（' + (st.size / 1073741824).toFixed(2) + ' GB），单个上限 2 GiB',
      '先用 ffmpeg 切开，或转成 16k/单声道再导入（插件不会自动执行）')
  }
  if (st.size === 0) return reject('no-audio', '这个文件是空的（0 字节）', '重新导出/拷贝一份完整的录音再导入')
  let format = null
  if (ext === '.wav') {
    try { format = readWavFormat(raw) } catch (e) {
      return reject('bad-format', '读不到这个 WAV 的头（' + e.message + '）', '重新导出一份 WAV，或先用 ffmpeg 转换（插件不会自动执行）')
    }
    if (!format.wav || !(format.dataBytes > 0)) {
      return reject('bad-format', '不是有效的 WAV（没有 RIFF/WAVE/data 头）',
        '先用 ffmpeg 转一下（插件不会自动执行）：' + ffmpegCommand(raw, outWav))
    }
    if (!isTargetWavFormat(format)) {
      return reject('bad-format', '源 WAV 是 ' + describeWavFormat(format) + '，需要 16k / 16bit / 单声道',
        '先用 ffmpeg 转一下（插件不会自动执行）：' + ffmpegCommand(raw, outWav))
    }
    // 整段静音的音频导入后只能得到空纪要 —— 在入口拒绝，别让用户等一场必然失败的整理
    if (st.size <= PRE_SCAN_MAX_BYTES) {
      let scan = null
      try { scan = await scanAudioLevels(raw) } catch { scan = null }
      if (scan && scan.ok && scan.silentRatio >= 0.98) {
        return {
          ok: false, reason: 'no-audio',
          message: '这段音频几乎全是静音（静音占 ' + Math.round(scan.silentRatio * 100) + '%），整理出来会是空纪要',
          hint: '确认导出时选对了音轨/设备；或换一段有说话的录音',
        }
      }
    }
  }
  return { ok: true, path: raw, ext, size: st.size, format }
}

/** 裸 PCM 流式拼成 WAV（先写头，再追加数据；内存占用恒定） */
export async function writeWavFromPcm(pcmFile, wavFile) {
  const size = fileSize(pcmFile)
  const dataBytes = size - (size % 2)
  if (!(dataBytes > 0)) throw new Error('PCM 文件是空的（0 字节）')
  writeFileSync(wavFile, pcmWavHeader(dataBytes))
  const input = createReadStream(pcmFile, { start: 0, end: dataBytes - 1, highWaterMark: 1 << 20 })
  const output = createWriteStream(wavFile, { flags: 'a' })
  await pipeline(input, output)
  return { bytes: dataBytes, seconds: Number((dataBytes / 32000).toFixed(1)) }
}

/**
 * 源 WAV 头不是标准 44 字节（中间夹了 LIST 等块）时的重新封装：
 * 只换成标准 44 字节头 + 原样搬运 data 区字节，**不解码、不改音频内容**。
 * （下游 readWavHeader 按 44 字节头算时长，不重封装会算错）
 */
export async function wrapWavStream(src, dst, fmt) {
  const info = fmt || readWavFormat(src)
  if (!info || !info.wav || !(info.dataBytes > 0)) throw new Error('源 WAV 没有可用的 data 区')
  writeFileSync(dst, pcmWavHeader(info.dataBytes, { sampleRate: info.sampleRate, channels: info.channels, bits: info.bits }))
  const input = createReadStream(src, { start: info.dataOffset, end: info.dataOffset + info.dataBytes - 1, highWaterMark: 1 << 20 })
  const output = createWriteStream(dst, { flags: 'a' })
  await pipeline(input, output)
  const bytes = fileSize(dst)
  return { bytes, seconds: Number((info.dataBytes / (info.sampleRate * info.channels * (info.bits / 8))).toFixed(1)) }
}

/** 合规 WAV 直接流式复制（不解码、不改音频内容） */
export async function copyWavStream(src, dst) {
  await pipeline(createReadStream(src, { highWaterMark: 1 << 20 }), createWriteStream(dst))
  const bytes = fileSize(dst)
  let seconds = 0
  try { seconds = Number(readWavHeader(dst).seconds.toFixed(1)) } catch { seconds = 0 }
  return { bytes, seconds }
}

/**
 * 新建导入目录名：`<ISO 时间戳>-import`（与会议目录同名规则，天然可排序）。
 * 同名已存在时加序号，绝不复用别人的目录。
 */
export function nextImportDir(root, { now = new Date() } = {}) {
  const stamp = now.toISOString().replace(/[:.]/g, '-')
  const base = stamp + '-import'
  let dir = join(root, base)
  let n = 2
  while (existsSync(dir) && n < 1000) {
    dir = join(root, base + '-' + n)
    n += 1
  }
  return dir
}

/**
 * candidate 是否 root 的**直接子目录**（删除/整理只允许这种范围）。
 * 符号链接等异常路径由调用方先 lstat 拒绝。
 */
export function isDirectChildDir(root, candidate) {
  if (!root || !candidate) return false
  let r = resolve(root).replace(/[\\/]+$/, '')
  let c = resolve(candidate).replace(/[\\/]+$/, '')
  if (process.platform === 'win32') { r = r.toLowerCase(); c = c.toLowerCase() }
  if (!r || c === r) return false
  if (!c.startsWith(r + sep)) return false
  const rest = c.slice(r.length + 1)
  return !!rest && !rest.includes(sep) && !rest.includes('/')
}

/**
 * candidate 是否在 root 里（含 root 自己）——用于"文件/文件夹能不能打开"这类判断，
 * 和 `isDirectChildDir` 的删除边界不是一回事。
 */
export function isWithinDir(root, candidate) {
  if (!root || !candidate) return false
  let r = resolve(root).replace(/[\\/]+$/, '')
  let c = resolve(candidate).replace(/[\\/]+$/, '')
  if (process.platform === 'win32') { r = r.toLowerCase(); c = c.toLowerCase() }
  if (!r) return false
  if (c === r) return true
  return c.startsWith(r + sep)
}

/** 人话的容量描述（KB/MB/GB），不带二进制单位缩写以免用户误解 */
export function describeBytes(bytes) {
  const n = Number(bytes)
  if (!Number.isFinite(n) || n < 0) return '未知'
  if (n >= 1073741824) return (n / 1073741824).toFixed(1) + ' GB'
  if (n >= 1048576) return Math.round(n / 1048576) + ' MB'
  if (n >= 1024) return Math.round(n / 1024) + ' KB'
  return n + ' 字节'
}

/**
 * 校验"会议保存位置 / 导出位置"能不能真的用。
 *
 * 为什么不是 `accessSync(path, W_OK)`：
 *   Windows 上"看起来可写"的目录，遇到组策略、OneDrive 占位文件、杀软拦截、
 *   父目录只读时，只有**真写一次**才知道。所以这里写一个探针文件、回读、再删掉；
 *   任何一步失败都返回 `not-writable` + 原因，绝不"看起来成功"。
 *
 * 失败一律 `{ ok:false, reason, message, hint }`，reason ∈
 *   bad-path / inside-app / is-file / not-writable / no-space
 * 成功 `{ ok:true, path, freeBytes, freeUnknown }`。
 *
 * @param {string} input 用户选的绝对路径
 * @param {{fs?: object, isAbsolute?: (p: string) => boolean, protectedDirs?: string[], minFreeBytes?: number}} [opts]
 *   · fs              注入读写替身（测试"写不进去"时不必改真实 ACL）
 *   · protectedDirs   DSH / 插件的安装目录（不能把会议写进去）
 * @returns {object}
 */
export function validateStorageDir(input, opts = {}) {
  const raw = String(input || '').trim()
  if (!raw) return reject('bad-path', '没有填写保存位置', '点「选择文件夹」挑一个本机文件夹，或用「恢复默认」')
  const abs = typeof opts.isAbsolute === 'function' ? opts.isAbsolute : isAbsolute
  if (!abs(raw)) {
    return reject('bad-path', '只接受本机绝对路径（现在是相对路径：' + raw + '）',
      '写完整路径，例如 D:\\会议记录；相对路径会随启动目录变化，不能当保存位置')
  }
  const target = resolve(raw)
  const fx = opts.fs || null
  const doLstat = (fx && fx.lstatSync) || lstatSync
  const doStat = (fx && fx.statSync) || statSync
  const doWrite = (fx && fx.writeFileSync) || writeFileSync
  const doRead = (fx && fx.readFileSync) || readFileSync
  const doUnlink = (fx && fx.unlinkSync) || unlinkSync
  const doExists = (fx && fx.existsSync) || existsSync
  const doStatfs = (fx && fx.statfsSync) || statfsSync
  const minFree = Number.isFinite(Number(opts.minFreeBytes)) && Number(opts.minFreeBytes) >= 0
    ? Number(opts.minFreeBytes)
    : MIN_STORAGE_FREE_BYTES

  // 1) 不能指进安装目录：DSH 升级/重装会覆盖或锁住那里的文件
  for (const p of (Array.isArray(opts.protectedDirs) ? opts.protectedDirs : [])) {
    if (!p) continue
    if (isWithinDir(p, target)) {
      return reject('inside-app', '不能把保存位置放在 DSH / 插件的安装目录里（' + p + '）',
        '升级或重装 DSH 会覆盖、锁住这些文件；换成你自己新建的文件夹，例如 D:\\会议记录')
    }
  }

  // 2) 存在性 / 是不是目录
  let st = null
  try { st = doLstat(target) } catch (e) {
    const code = String((e && e.code) || '')
    if (code && code !== 'ENOENT' && code !== 'ENOTDIR') {
      return reject('not-writable', '读不到这个路径：' + ((e && e.message) || code),
        '确认路径拼写正确；被组策略/安全软件挡住时换一个目录')
    }
  }
  if (st && st.isSymbolicLink && st.isSymbolicLink()) {
    try { st = doStat(target) } catch { st = null }
  }
  if (!st) {
    // 不自动创建：路径拼错时静默建目录，等于把会议写到用户没打算用的地方
    return reject('bad-path', '这个文件夹不存在：' + target,
      '先在文件管理器里新建它，或用「选择文件夹」挑一个已存在的目录（不会自动创建）')
  }
  if (!st.isDirectory()) {
    return reject('is-file', '这是一个文件，不是文件夹：' + target,
      '保存位置必须是文件夹；换成上一级目录或另建一个文件夹')
  }

  // 3) 磁盘剩余空间：选了快满的盘，录到一半写失败最难解释
  let freeBytes = null
  try {
    const sb = doStatfs(target)
    const bavail = Number(sb && sb.bavail)
    const bsize = Number(sb && sb.bsize)
    if (Number.isFinite(bavail) && Number.isFinite(bsize)) freeBytes = bavail * bsize
  } catch { freeBytes = null }
  if (freeBytes !== null && freeBytes < minFree) {
    return reject('no-space', '这个磁盘只剩 ' + describeBytes(freeBytes) + '，至少要留 ' + describeBytes(minFree) + ' 才能保存会议',
      '换一个空间更大的磁盘，或先清理出 ' + describeBytes(minFree) + ' 以上的空间')
  }

  // 4) 真写一次再删：不用"看起来可写"的 accessSync 断言
  const probe = join(target, '.soulmirror-write-probe-' + process.pid + '-' + Date.now().toString(36))
  const payload = 'soulmirror storage probe ' + Date.now()
  let writeError = ''
  try {
    doWrite(probe, payload, 'utf8')
    const back = String(doRead(probe, 'utf8'))
    if (back !== payload) throw new Error('写入后回读的内容不一致（可能被同步盘/安全软件拦截）')
  } catch (e) {
    writeError = (e && e.message) ? e.message : String(e)
    try { doUnlink(probe) } catch { /* ignore */ }
    return reject('not-writable', '这个文件夹写不进去：' + writeError,
      '确认当前用户对该文件夹有写权限；只读盘、受保护目录、OneDrive 在线占位、被杀软拦截都会这样。换一个目录或改权限后重试')
  }
  let cleanError = ''
  try { doUnlink(probe) } catch (e) { cleanError = (e && e.message) ? e.message : String(e) }
  if (doExists(probe)) {
    try { doUnlink(probe) } catch { /* ignore */ }
    if (doExists(probe)) {
      return reject('not-writable', '探针文件删不掉：' + probe + (cleanError ? '（' + cleanError + '）' : ''),
        '这个目录能写但不能删，留下的临时文件会污染会议列表；换一个目录或检查权限')
    }
  }
  return { ok: true, path: target, freeBytes, freeUnknown: freeBytes === null }
}
