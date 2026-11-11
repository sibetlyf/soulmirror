/**
 * Kaldi 风格 fbank 前端 —— 与 OpenASR 的 `KaldiFbankFrontend` 参数对齐。
 *
 * 为什么要自己实现（而不是随便算个 MFCC）：
 *   声纹模型的输入不是"随便的特征"，是它训练时的那个前端。前端不一致，
 *   向量就落在另一个空间里，余弦相似度会整体偏移——看起来"能跑"，
 *   实际门槛全错。参考项目把这个前端写成了明文规范，我们照抄：
 *
 *   docs/design/wespeaker-resnet-embedder.md:
 *     Hamming 窗（不是 Povey）、80 mel、25/10 ms 帧移、16 kHz、
 *     preemph 0.97、input_scale=32768、fmin=20、fmax=8000、
 *     snip_edges、逐段 CMN（只减均值）、log 能量下限 f32::EPSILON。
 *
 * 输出：Float32Array，行优先 [frames, 80]。
 */

export const FRONTEND_VERSION = 'kaldi-fbank-hamming-80-25-10-v1'

const SAMPLE_RATE = 16000
const FRAME_LENGTH_S = 0.025
const FRAME_SHIFT_S = 0.010
const PREEMPHASIS = 0.97
const INPUT_SCALE = 32768
const LOW_FREQ = 20
const HIGH_FREQ = 8000
const NUM_MEL = 80
const LOG_FLOOR = 1.1754943508222875e-38   // f32::EPSILON（与参考实现一致）
const NFFT = 512

const FRAME_LEN = Math.round(FRAME_LENGTH_S * SAMPLE_RATE)   // 400
const FRAME_SHIFT = Math.round(FRAME_SHIFT_S * SAMPLE_RATE)  // 160

/** mel 刻度（Kaldi 用 1127 * ln(1 + f/700)） */
function hzToMel(hz) { return 1127 * Math.log(1 + hz / 700) }
function melToHz(mel) { return 700 * (Math.exp(mel / 1127) - 1) }

/** Hamming 窗 */
function hamming(n, len) { return 0.54 - 0.46 * Math.cos((2 * Math.PI * n) / (len - 1)) }

/**
 * 80 个三角 mel 滤波器（Kaldi 的 bin 对齐：把 Hz 换算成 FFT bin 下标）。
 * @returns {Array<{start:number, weights:Float32Array}>}
 */
function melFilters() {
  const fftBins = NFFT / 2 + 1
  const binHz = SAMPLE_RATE / NFFT
  const melLow = hzToMel(LOW_FREQ)
  const melHigh = hzToMel(HIGH_FREQ)
  const melPoints = []
  for (let i = 0; i <= NUM_MEL + 1; i++) {
    const mel = melLow + ((melHigh - melLow) * i) / (NUM_MEL + 1)
    melPoints.push(melToHz(mel))
  }
  const bins = melPoints.map((hz) => Math.floor((NFFT + 1) * hz / SAMPLE_RATE))
  const filters = []
  for (let m = 1; m <= NUM_MEL; m++) {
    const left = bins[m - 1]
    const center = bins[m]
    const right = bins[m + 1]
    const start = Math.max(0, Math.min(fftBins - 1, left))
    const end = Math.max(start + 1, Math.min(fftBins - 1, right))
    const weights = new Float32Array(end - start + 1)
    for (let i = start; i <= end; i++) {
      let w = 0
      if (center > left && i >= left && i <= center) w = (i - left) / (center - left)
      else if (right > center && i > center && i <= right) w = (right - i) / (right - center)
      weights[i - start] = w
    }
    filters.push({ start, weights })
  }
  return filters
}

/** 迭代 radix-2 复数 FFT（NFFT 固定 512，够用且不引依赖） */
function fft(re, im) {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) { const t = re[i]; re[i] = re[j]; re[j] = t; const u = im[i]; im[i] = im[j]; im[j] = u }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len
    const wRe = Math.cos(ang), wIm = Math.sin(ang)
    for (let i = 0; i < n; i += len) {
      let curRe = 1, curIm = 0
      for (let j = 0; j < len / 2; j++) {
        const uRe = re[i + j], uIm = im[i + j]
        const vRe = re[i + j + len / 2] * curRe - im[i + j + len / 2] * curIm
        const vIm = re[i + j + len / 2] * curIm + im[i + j + len / 2] * curRe
        re[i + j] = uRe + vRe
        im[i + j] = uIm + vIm
        re[i + j + len / 2] = uRe - vRe
        im[i + j + len / 2] = uIm - vIm
        const nextRe = curRe * wRe - curIm * wIm
        curIm = curRe * wIm + curIm * wRe
        curRe = nextRe
      }
    }
  }
}

/**
 * 计算 fbank。
 *
 * @param {Float32Array|number[]} samples 单声道 float32，范围 [-1,1]
 * @param {{removeDc?: boolean, cmn?: boolean}} [opts]
 * @returns {{data: Float32Array, frames: number, dim: number, frontend: string}}
 */
export function computeFbank(samples, opts = {}) {
  const removeDc = opts.removeDc !== false
  const cmn = opts.cmn !== false
  const n = samples.length
  if (!n) return { data: new Float32Array(0), frames: 0, dim: 0, frontend: FRONTEND_VERSION }

  // input_scale=32768：与参考实现一样把浮点样本当 int16 量程用
  const x = new Float32Array(n)
  for (let i = 0; i < n; i++) x[i] = Number(samples[i] || 0) * INPUT_SCALE

  // snip_edges：只保留完整帧
  const frames = Math.floor((n - FRAME_LEN) / FRAME_SHIFT) + 1
  if (frames <= 0) return { data: new Float32Array(0), frames: 0, dim: 0, frontend: FRONTEND_VERSION }

  // 逐句去直流（参考实现是 utterance CMN 的一部分）
  if (removeDc) {
    let mean = 0
    for (let i = 0; i < n; i++) mean += x[i]
    mean /= n
    for (let i = 0; i < n; i++) x[i] -= mean
  }

  // preemph 0.97
  const pre = new Float32Array(n)
  pre[0] = x[0]
  for (let i = 1; i < n; i++) pre[i] = x[i] - PREEMPHASIS * x[i - 1]

  const filters = melFilters()
  const out = new Float32Array(frames * NUM_MEL)
  const re = new Float32Array(NFFT)
  const im = new Float32Array(NFFT)
  const power = new Float32Array(NFFT / 2 + 1)

  for (let f = 0; f < frames; f++) {
    const offset = f * FRAME_SHIFT
    for (let i = 0; i < NFFT; i++) {
      if (i < FRAME_LEN) {
        re[i] = pre[offset + i] * hamming(i, FRAME_LEN)
        im[i] = 0
      } else { re[i] = 0; im[i] = 0 }
    }
    fft(re, im)
    for (let b = 0; b < power.length; b++) power[b] = re[b] * re[b] + im[b] * im[b]
    for (let m = 0; m < NUM_MEL; m++) {
      const { start, weights } = filters[m]
      let sum = 0
      for (let i = 0; i < weights.length; i++) sum += power[start + i] * weights[i]
      out[f * NUM_MEL + m] = Math.log(Math.max(sum, LOG_FLOOR))
    }
  }

  // 逐句 CMN：只减均值（参考实现明确"mean only"）
  if (cmn && frames > 0) {
    for (let m = 0; m < NUM_MEL; m++) {
      let mean = 0
      for (let f = 0; f < frames; f++) mean += out[f * NUM_MEL + m]
      mean /= frames
      for (let f = 0; f < frames; f++) out[f * NUM_MEL + m] -= mean
    }
  }

  return { data: out, frames, dim: NUM_MEL, frontend: FRONTEND_VERSION }
}

/** 帧数：与 snip_edges 一致，界面显示"这段音频能算多少帧"用 */
export function frameCount(samplesLength) {
  const n = Number(samplesLength) || 0
  return Math.max(0, Math.floor((n - FRAME_LEN) / FRAME_SHIFT) + 1)
}

export const FRONTEND_CONSTANTS = Object.freeze({
  sampleRate: SAMPLE_RATE, frameLength: FRAME_LEN, frameShift: FRAME_SHIFT,
  numMel: NUM_MEL, nfft: NFFT, preemphasis: PREEMPHASIS, inputScale: INPUT_SCALE,
  lowFreq: LOW_FREQ, highFreq: HIGH_FREQ, logFloor: LOG_FLOOR,
})
