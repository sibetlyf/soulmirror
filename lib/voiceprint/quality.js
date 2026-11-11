/**
 * 注册样本的质量分 —— 照 OpenASR 的 `SampleQuality::weight()` 结构。
 *
 * 为什么样本要打分而不是一律等权：
 *   一段在安静会议室录的 12 秒，和一段在嘈杂机房录的 12 秒，
 *   后者算出来的向量更抖。等权平均会让抖的样本把原型拉偏。
 *   权重只用于"加权"和"支持加分"，**绝不参与认人门槛**（门槛只看余弦）。
 *
 * 参考实现（voice_id/domain.rs）：
 *   speech = clamp(speech_seconds/15, .25, 1)
 *   snr    = clamp((snr-5)/25, .2, 1)
 *   clip   = clamp(1 - clipping_ratio*8, .1, 1)
 *   cov    = clamp(vad_coverage, .2, 1)
 *   weight = clamp(speech*.35 + snr*.25 + clip*.2 + cov*.2, .05, 1)
 */

export const MIN_SAMPLE_SPEECH_SECONDS = 10
export const TARGET_SAMPLE_SPEECH_SECONDS = 12

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

/**
 * 从 16k 单声道 float 采样估四个指标。
 * 都是可解释的物理量，不做"生物特征打分"。
 *
 * @param {Float32Array} samples
 * @param {{sampleRate?: number, speechSeconds?: number, vadCoverage?: number}} [opts]
 */
export function assessPcm(samples, opts = {}) {
  const sr = Number(opts.sampleRate) || 16000
  const n = samples.length
  const seconds = n / sr
  let sum = 0, sumSq = 0, peak = 0, clipped = 0
  for (let i = 0; i < n; i++) {
    const v = samples[i]
    sum += v
    sumSq += v * v
    const a = Math.abs(v)
    if (a > peak) peak = a
    if (a >= 0.999) clipped++
  }
  const mean = n ? sum / n : 0
  let varSum = 0
  for (let i = 0; i < n; i++) varSum += (samples[i] - mean) * (samples[i] - mean)
  const rms = n ? Math.sqrt(varSum / n) : 0
  const noiseFloor = 1e-4
  // 简易 SNR 估计：信号 RMS 与假设噪声底比（不做语音/静音分离，够用于加权）
  const snr = 20 * Math.log10(Math.max(rms, 1e-9) / noiseFloor)
  return {
    speechSeconds: Number(opts.speechSeconds) || seconds,
    seconds,
    rms,
    peak,
    snrEstimate: clamp(snr, 0, 60),
    clippingRatio: n ? clipped / n : 0,
    vadCoverage: Number.isFinite(opts.vadCoverage) ? clamp(opts.vadCoverage, 0, 1) : 1,
  }
}

/** 参考实现的权重公式（数值照抄，便于和它们的结果对照） */
export function qualityWeight(q) {
  const speech = clamp((Number(q.speechSeconds) || 0) / 15, 0.25, 1)
  const snr = clamp((Number(q.snrEstimate) - 0) / 25, 0.2, 1)
  const clip = clamp(1 - (Number(q.clippingRatio) || 0) * 8, 0.1, 1)
  const cov = clamp(Number(q.vadCoverage) ?? 1, 0.2, 1)
  return clamp(speech * 0.35 + snr * 0.25 + clip * 0.2 + cov * 0.2, 0.05, 1)
}

/**
 * 能否作为注册样本。
 * 门槛与参考项目一致：注册要 10 秒，因为它比识别的 3 秒更严格——
 * 真实说话永远不如读稿干净，按识别门槛注册的人第一次就会失配。
 */
export function checkEnrollment(samples, opts = {}) {
  const stats = assessPcm(samples, opts)
  const speech = stats.speechSeconds
  if (speech < MIN_SAMPLE_SPEECH_SECONDS) {
    return {
      ok: false, stats,
      reason: 'not-enough-speech',
      message: '至少要 ' + MIN_SAMPLE_SPEECH_SECONDS + ' 秒有效语音，这段只有 ' + speech.toFixed(1) + ' 秒',
      advice: '再录 ' + Math.ceil(MIN_SAMPLE_SPEECH_SECONDS - speech) + ' 秒左右（推荐 ' + TARGET_SAMPLE_SPEECH_SECONDS + ' 秒）',
    }
  }
  if (stats.rms < 0.002) {
    return {
      ok: false, stats,
      reason: 'too-quiet',
      message: '这段几乎是静音（RMS ' + stats.rms.toFixed(4) + '）',
      advice: '确认麦克风选对了，且说话时有声音进到采集设备',
    }
  }
  if (stats.clippingRatio > 0.05) {
    return {
      ok: false, stats,
      reason: 'clipping',
      message: '削波比例过高（' + (stats.clippingRatio * 100).toFixed(1) + '%）',
      advice: '把系统/麦克风音量调小一点再录',
    }
  }
  return { ok: true, stats, reason: '', message: '', weight: qualityWeight(stats) }
}
