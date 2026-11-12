/**
 * 声纹服务：注册（录一段 / 从会议里挑一段）+ 识别（会后把说话人簇认成人）。
 *
 * 这一层是"能用"的关键，规则全部来自参考项目：
 *   · 注册要 10 秒（比识别的 3 秒严格，因为真实说话不如读稿干净）
 *   · 证据窗口 2.0s / 1.0s 步进 / turn 首尾修 0.5s / 每人 ≤20 个 / 不跨别人
 *   · 二簇切分后**丢掉少数簇**（一个窗口的污染会拖坏整簇的质心）
 *   · 认人双门槛（0.60 + margin 0.15）；不满足就保留匿名 + 给原因
 *
 * 音频读取按 WAV 分块读，不把整场会（几十上百 MB）读进内存。
 */
import { closeSync, openSync, readSync, fstatSync } from 'node:fs'
import { assessPcm, checkEnrollment, qualityWeight, MIN_SAMPLE_SPEECH_SECONDS } from './quality.js'
import {
  checkEvidence, cosine, l2normalize, matchPerson, planWindows, clusterByCosine, weightedMean,
} from './match.js'

const DATA_CHUNK_SEARCH_LIMIT = 4096

/** 解析 WAV：返回 PCM 数据起点与格式（只认 16k/16bit/单声道，其它明确报错） */
export function readWavLayout(file) {
  const fd = openSync(file, 'r')
  try {
    const size = fstatSync(fd).size
    const head = Buffer.alloc(DATA_CHUNK_SEARCH_LIMIT)
    const n = readSync(fd, head, 0, head.length, 0)
    if (n < 12 || head.toString('ascii', 0, 4) !== 'RIFF' || head.toString('ascii', 8, 12) !== 'WAVE') {
      throw new Error('不是 WAV 文件：' + file)
    }
    const channels = head.readUInt16LE(22) || 1
    const sampleRate = head.readUInt32LE(24) || 0
    const bits = head.readUInt16LE(34) || 16
    let offset = 12
    let dataStart = 44
    let dataSize = size - 44
    while (offset + 8 <= n) {
      const id = head.toString('ascii', offset, offset + 4)
      const chunkSize = head.readUInt32LE(offset + 4)
      if (id === 'data') { dataStart = offset + 8; dataSize = Math.min(chunkSize || (size - dataStart), size - dataStart); break }
      offset += 8 + chunkSize + (chunkSize % 2)
    }
    return { file, size, channels, sampleRate, bits, dataStart, dataSize }
  } finally { closeSync(fd) }
}

/**
 * 只读一段 PCM 转成 float32（范围外自动夹到文件内）。
 * @returns {Float32Array}
 */
export function readWavSamples(file, startSec, endSec) {
  const layout = readWavLayout(file)
  if (layout.channels !== 1) throw new Error('只支持单声道录音（当前 ' + layout.channels + ' 声道）')
  if (layout.bits !== 16) throw new Error('只支持 16bit 录音（当前 ' + layout.bits + 'bit）')
  const bytesPerSample = 2
  const totalFrames = Math.floor(layout.dataSize / bytesPerSample)
  const from = Math.max(0, Math.floor(Number(startSec) * layout.sampleRate))
  const to = Math.min(totalFrames, Math.ceil(Number(endSec) * layout.sampleRate))
  const count = Math.max(0, to - from)
  if (!count) return new Float32Array(0)
  const buf = Buffer.alloc(count * bytesPerSample)
  const fd = openSync(file, 'r')
  try {
    let read = 0
    while (read < buf.length) {
      const got = readSync(fd, buf, read, buf.length - read, layout.dataStart + from * bytesPerSample + read)
      if (!got) break
      read += got
    }
  } finally { closeSync(fd) }
  const out = new Float32Array(count)
  for (let i = 0; i < count; i++) out[i] = buf.readInt16LE(i * 2) / 32768
  return out
}

/**
 * 二簇切分，保留主簇（参考项目 evidence.rs 的核心结论）。
 * 少于 2 个簇时直接返回全部；主簇按成员数优先，同数量取更紧凑的。
 *
 * @param {Float32Array[]} vectors
 * @returns {{kept: number[], dropped: number[], mixed: boolean}}
 */
export function keepMainCluster(vectors) {
  if (!vectors || vectors.length < 2) return { kept: (vectors || []).map((_, i) => i), dropped: [], mixed: false }
  const clusters = clusterByCosine(vectors, 0.35)
  if (clusters.length <= 1) return { kept: vectors.map((_, i) => i), dropped: [], mixed: false }
  clusters.sort((a, b) => b.length - a.length)
  const kept = clusters[0]
  const dropped = clusters.slice(1).flat()
  // 少数簇超过 35% 才算"真的混了两个人"，否则只是噪声
  const mixed = dropped.length / vectors.length > 0.35
  return { kept, dropped, mixed }
}

/**
 * 注册：从一段音频（或会议的某个区间）算样本并入库。
 *
 * @param {{library: any, space: any, embedder: any, personName?: string, personId?: string,
 *   pcm?: Float32Array, wavFile?: string, startSec?: number, endSec?: number,
 *   consent?: {grantedAt?: string, noticeVersion?: string, captureMethod?: string}}} o
 */
export async function enrollSample(o) {
  const library = o.library
  if (!library) throw new Error('没有声纹库')
  const embedder = o.embedder
  if (!embedder || !embedder.ok) {
    return { ok: false, reason: embedder ? embedder.reason : 'model-missing', message: (embedder && embedder.hint) || '声纹模型不可用' }
  }

  let pcm = o.pcm
  if (!pcm && o.wavFile) pcm = readWavSamples(o.wavFile, o.startSec || 0, o.endSec || 1e9)
  if (!pcm || !pcm.length) return { ok: false, reason: 'no-audio', message: '没有可用的音频' }

  const gate = checkEnrollment(pcm, { })
  if (!gate.ok) return { ok: false, reason: gate.reason, message: gate.message, advice: gate.advice, stats: gate.stats }

  // 入库前把 person 定下来：已有就加样本，没有就新建
  let personId = o.personId || ''
  let personName = ''
  if (personId) {
    const existing = library.person(personId)
    if (!existing || existing.status !== 'active') return { ok: false, reason: 'person-missing', message: '这个人不存在或已删除' }
    personName = existing.displayName
  } else {
    const created = library.addPerson(o.personName)
    personId = created.personId
    personName = created.displayName
  }

  let embedding
  try {
    embedding = await embedder.embed(pcm)
  } catch (e) {
    return { ok: false, reason: (e && e.code) || 'embed-failed', message: e.message || String(e) }
  }
  if (!embedding || !embedding.length) return { ok: false, reason: 'empty-embedding', message: '模型返回了空向量' }

  const weight = qualityWeight(gate.stats)
  const sample = library.addSample({
    personId, space: o.space, embedding,
    quality: { ...gate.stats, weight },
    seconds: gate.stats.speechSeconds,
    consent: {
      grantedAt: (o.consent && o.consent.grantedAt) || new Date().toISOString(),
      noticeVersion: (o.consent && o.consent.noticeVersion) || 'v1',
      captureMethod: (o.consent && o.consent.captureMethod) || 'manual',
    },
  })
  return {
    ok: true, personId, personName, sampleId: sample.sampleId,
    seconds: Math.round(gate.stats.speechSeconds * 10) / 10,
    weight: Math.round(weight * 100) / 100,
  }
}

/**
 * 识别一个说话人：给它那组句子规划窗口、算向量、纯化、匹配。
 *
 * @param {{library: any, space: any, embedder: any, wavFile: string,
 *   lines: {begin:number,end:number,speaker:string}[]} } o
 * @returns {{label:string, name?:string, personId?:string, reason?:string, detail?:object}}
 */
export async function identifyLabel(o) {
  const { library, space, embedder, wavFile, lines } = o
  const label = String((o && o.label) || (lines && lines[0] && lines[0].speaker) || '')
  if (!embedder || !embedder.ok) {
    return { label, reason: 'model-missing', detail: { hint: embedder && embedder.hint ? embedder.hint : '声纹模型不可用' } }
  }
  const windows = planWindows(lines)
  if (!windows.length) {
    return { label, reason: 'not-enough-speech', detail: { windows: 0, requiredWindows: 5, seconds: 0, requiredSeconds: 3, requiredContinuousSeconds: 4 } }
  }

  const vectors = []
  for (const w of windows) {
    try {
      const pcm = readWavSamples(wavFile, w.start, w.end)
      if (pcm.length < 16000 * 0.5) continue
      const vec = await embedder.embed(pcm)
      if (vec && vec.length) vectors.push(vec)
    } catch { /* 单个窗口失败不影响整簇：证据少一点而已 */ }
  }
  if (!vectors.length) {
    return { label, reason: 'not-enough-speech', detail: { windows: 0, requiredWindows: 5, seconds: 0, requiredSeconds: 3, requiredContinuousSeconds: 4 } }
  }

  const main = keepMainCluster(vectors)
  const kept = main.kept.map((i) => vectors[i])
  const keptSeconds = (kept.length * 2.0)
  const evidence = checkEvidence({ keptSeconds, windows: kept.length })
  if (!evidence.ok) return { label, reason: evidence.reason, detail: evidence.detail }
  if (main.mixed) return { label, reason: 'mixed-voices', detail: { windows: kept.length, seconds: Math.round(keptSeconds * 10) / 10 } }

  const centroid = weightedMean(kept, kept.map(() => 1))
  const persons = library.matcherPersons(space)
  const result = matchPerson({
    query: centroid,
    persons,
    memberEmbeddingsOf: (personId) => library.memberVectors(personId, space),
  })
  if (!result.ok) {
    // 区分"差一点"和"根本不像"：差一点是阈值问题，根本不像是采集链/样本来源问题，修法完全不同。
    const best = Number(result.detail && result.detail.bestScore)
    if (result.reason === 'below-threshold' && Number.isFinite(best) && best < DOMAIN_MISMATCH_BELOW) {
      return {
        label, reason: 'domain-mismatch',
        detail: { ...result.detail, bestScore: best, domainMismatchBelow: DOMAIN_MISMATCH_BELOW },
      }
    }
    return { label, reason: result.reason, detail: result.detail }
  }
  return {
    label, name: result.match.displayName, personId: result.match.personId,
    detail: { score: result.match.score, runnerUpScore: result.match.runnerUpScore, windows: kept.length },
  }
}

/**
 * 会后：把云端分出的每个说话人簇都试着认人。
 * 认不出不影响纪要；返回结构直接进界面，说明"为什么没认出来"。
 *
 * @param {{library:any, space:any, embedder:any, wavFile:string, lines:any[], logger?:any}} o
 */
export async function identifySpeakers({ library, space, embedder, wavFile, lines, logger }) {
  const labels = Array.from(new Set((lines || []).map((l) => l && l.speaker).filter(Boolean)))
  const results = []
  for (const label of labels) {
    const subset = (lines || []).filter((l) => l && l.speaker === label)
    try {
      results.push(await identifyLabel({ library, space, embedder, wavFile, lines: subset, label }))
    } catch (e) {
      logger?.warn?.('[soulmirror] 说话人识别失败 ' + label + '：' + (e && e.message ? e.message : String(e)))
      results.push({ label, reason: 'error', detail: { message: e && e.message ? e.message : String(e) } })
    }
  }
  return results
}

/** 低于这个分数说明"完全不像"，多半是样本与会话录音来自不同的采集链（面板麦克风 vs 会议环回） */
export const DOMAIN_MISMATCH_BELOW = 0.35

export const MIN_ENROLL_SECONDS = MIN_SAMPLE_SPEECH_SECONDS
export { cosine, l2normalize }
