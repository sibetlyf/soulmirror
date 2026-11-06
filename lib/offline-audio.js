/**
 * 会后重转写的音频预处理：**先看有没有人声，再决定上传什么**。
 *
 * 为什么需要：
 *   1. 云端文件识别对"整段静音"会返回 SUCCESS_WITH_NO_VALID_FRAGMENT ——
 *      名字看起来像成功，实际一个字都没识别出来，还白花了上传流量
 *   2. 会议录音常常"开头十分钟没人说话，结尾拖一段空场"，
 *      把这些部分传上去既费流量也拖慢识别
 *
 * 做法（全程流式，不把 40MB 一次读进内存）：
 *   scanAudioLevels  按窗口算 RMS，得出"有声区间"与静音占比
 *   extractRangeToWav 只把有声区间（前后各留 2 秒）写成新 wav
 */

import { createReadStream, createWriteStream, openSync, readSync, closeSync, fstatSync, writeFileSync } from 'node:fs'
import { pipeline } from 'node:stream/promises'

/** 默认：500ms 一个窗口，低于 0.006 视为静音 */
export const DEFAULT_SILENCE_RMS = 0.006
export const DEFAULT_WINDOW_MS = 500

/** 读 WAV 头（只读前 64 字节） */
export function readWavInfo(file) {
  const fd = openSync(file, 'r')
  try {
    const head = Buffer.alloc(64)
    const n = readSync(fd, head, 0, 64, 0)
    const size = fstatSync(fd).size
    if (n < 44 || head.toString('ascii', 0, 4) !== 'RIFF') {
      return { ok: false, channels: 1, sampleRate: 16000, bits: 16, dataOffset: 0, dataSize: size, size }
    }
    const channels = head.readUInt16LE(22) || 1
    const sampleRate = head.readUInt32LE(24) || 16000
    const bits = head.readUInt16LE(34) || 16
    const dataSize = Math.min(head.readUInt32LE(40) || (size - 44), size - 44)
    return { ok: true, channels, sampleRate, bits, dataOffset: 44, dataSize, size }
  } finally {
    closeSync(fd)
  }
}

/**
 * 流式扫描电平。
 * @param {string} file
 * @param {{windowMs?: number, silenceRms?: number}} [opts]
 * @returns {Promise<{ok: boolean, durationSec: number, windows: Array<{t: number, rms: number}>,
 *   silentRatio: number, firstLoudSec: number, lastLoudSec: number, peakRms: number, error?: string}>}
 */
export async function scanAudioLevels(file, opts = {}) {
  const { windowMs = DEFAULT_WINDOW_MS, silenceRms = DEFAULT_SILENCE_RMS } = opts
  const info = readWavInfo(file)
  if (!info.ok) {
    return { ok: false, durationSec: 0, windows: [], silentRatio: 1, firstLoudSec: 0, lastLoudSec: 0, peakRms: 0, error: '不是合法的 WAV' }
  }
  const bytesPerSec = info.sampleRate * info.channels * (info.bits / 8)
  if (!bytesPerSec) {
    return { ok: false, durationSec: 0, windows: [], silentRatio: 1, firstLoudSec: 0, lastLoudSec: 0, peakRms: 0, error: 'WAV 头里的采样率/声道不合法' }
  }
  const windowBytes = Math.max(2, Math.round((bytesPerSec * windowMs) / 1000))
  const durationSec = info.dataSize / bytesPerSec
  const windows = []
  let peak = 0
  let loud = 0

  // 逐块读，块内再按窗口切
  let carried = Buffer.alloc(0)
  let consumed = 0
  const stream = createReadStream(file, { start: info.dataOffset, end: info.dataOffset + info.dataSize - 1, highWaterMark: 1024 * 1024 })
  for await (const chunk of stream) {
    carried = carried.length ? Buffer.concat([carried, chunk]) : chunk
    while (carried.length >= windowBytes) {
      const win = carried.subarray(0, windowBytes)
      const rms = rms16(win)
      windows.push({ t: (consumed + windowBytes / 2) / bytesPerSec, rms })
      if (rms > peak) peak = rms
      if (rms >= silenceRms) loud += 1
      consumed += windowBytes
      carried = carried.subarray(windowBytes)
    }
  }
  if (carried.length >= 2) {
    const rms = rms16(carried)
    windows.push({ t: (consumed + carried.length / 2) / bytesPerSec, rms })
    if (rms > peak) peak = rms
    if (rms >= silenceRms) loud += 1
  }

  const total = windows.length || 1
  const silentRatio = 1 - loud / total
  const firstLoud = windows.find((w) => w.rms >= silenceRms)
  let lastLoud = null
  for (let i = windows.length - 1; i >= 0; i--) {
    if (windows[i].rms >= silenceRms) { lastLoud = windows[i]; break }
  }

  return {
    ok: true,
    durationSec: Number(durationSec.toFixed(1)),
    windows,
    silentRatio: Number(silentRatio.toFixed(3)),
    firstLoudSec: firstLoud ? Number(firstLoud.t.toFixed(1)) : 0,
    lastLoudSec: lastLoud ? Number(lastLoud.t.toFixed(1)) : 0,
    peakRms: Number(peak.toFixed(4)),
  }
}

/** int16 PCM 的 RMS（0~1） */
export function rms16(buf) {
  let sum = 0
  let n = 0
  for (let i = 0; i + 1 < buf.length; i += 2) {
    const v = buf.readInt16LE(i) / 32768
    sum += v * v
    n++
  }
  return n ? Math.sqrt(sum / n) : 0
}

/**
 * 只把 [startSec, endSec) 区间写成新 wav（流式拷贝，内存占用恒定）。
 * @param {{src: string, dst: string, startSec: number, endSec: number}} o
 */
export async function extractRangeToWav({ src, dst, startSec = 0, endSec = 0 }) {
  const info = readWavInfo(src)
  if (!info.ok) throw new Error('源文件不是合法 WAV')
  const bytesPerSec = info.sampleRate * info.channels * (info.bits / 8)
  const startByte = Math.max(0, Math.round(startSec * bytesPerSec))
  const endByte = Math.min(info.dataSize, Math.round(endSec * bytesPerSec))
  const takeBytes = Math.max(0, endByte - startByte)
  if (!takeBytes) throw new Error('截取区间为空')

  // 头部：复制原头，改长度字段
  const head = Buffer.alloc(44)
  const fd = openSync(src, 'r')
  try { readSync(fd, head, 0, 44, 0) } finally { closeSync(fd) }
  head.writeUInt32LE(36 + takeBytes, 4)
  head.writeUInt32LE(takeBytes, 40)
  // 同步写头，避免与下面的追加流竞争（否则偶发文件比头里写的短）
  writeFileSync(dst, head)

  const out = createWriteStream(dst, { flags: 'a' })
  const input = createReadStream(src, {
    start: info.dataOffset + startByte,
    end: info.dataOffset + startByte + takeBytes - 1,
    highWaterMark: 1024 * 1024,
  })
  await pipeline(input, out)
  return { dst, bytes: takeBytes, seconds: Number((takeBytes / bytesPerSec).toFixed(1)) }
}

/**
 * 决策：该传整段，还是只传有声区间？还是根本别传？
 *
 * @param {{silentRatio: number, firstLoudSec: number, lastLoudSec: number, durationSec: number}} scan
 * @param {{minKeepSec?: number, padSec?: number, skipIfSilentAbove?: number}} [opts]
 * @returns {{action: 'skip'|'trim'|'full', startSec: number, endSec: number, reason: string}}
 */
export function planOfflineUpload(scan, opts = {}) {
  const { minKeepSec = 10, padSec = 2, skipIfSilentAbove = 0.98 } = opts
  if (!scan || !scan.ok) return { action: 'skip', startSec: 0, endSec: 0, reason: '读不到音频信息' }
  if (scan.silentRatio >= skipIfSilentAbove) {
    return { action: 'skip', startSec: 0, endSec: 0, reason: '录音里几乎没有人声（静音占 ' + Math.round(scan.silentRatio * 100) + '%）' }
  }
  const start = Math.max(0, scan.firstLoudSec - padSec)
  const end = Math.min(scan.durationSec, scan.lastLoudSec + padSec)
  const keep = end - start
  if (!(keep >= minKeepSec)) {
    return { action: 'skip', startSec: 0, endSec: 0, reason: '有声片段太短（' + keep.toFixed(1) + ' 秒）' }
  }
  // 整段本来就差不多全程有声 → 不用裁，省一次拷贝
  if (start < 1 && scan.durationSec - end < 1) {
    return { action: 'full', startSec: 0, endSec: scan.durationSec, reason: '整段都有声' }
  }
  return {
    action: 'trim',
    startSec: Number(start.toFixed(1)),
    endSec: Number(end.toFixed(1)),
    reason: '只传有声区间：' + start.toFixed(0) + 's~' + end.toFixed(0) + 's（省 ' + Math.round((1 - keep / scan.durationSec) * 100) + '% 流量）',
  }
}

/** 云端错误 → 人话 */
export function explainOfflineError(message) {
  const s = String(message || '')
  if (/SUCCESS_WITH_NO_VALID_FRAGMENT/.test(s)) {
    return '云端没识别出任何语音（录音静音、只有噪声，或采样格式不被接受）'
  }
  if (/401|Unauthorized/i.test(s)) return 'Key 无效或未被接受'
  if (/403|Forbidden/i.test(s)) return 'Key 无权限或账号被停用'
  if (/429|rate.?limit/i.test(s)) return '被限流，稍后再试'
  if (/timeout|超时/i.test(s)) return '处理超时'
  if (/ENOTFOUND|ECONNRESET|ECONNREFUSED|network/i.test(s)) return '网络不通'
  return s.slice(0, 160)
}
