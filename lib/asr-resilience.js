/**
 * ASR 链路的"非网络"逻辑：重连退避、断线缓冲、丢帧记账。
 *
 * 单独抽出来是为了能在没有网络的情况下测——重连行为最容易出 bug，
 * 而它恰恰是线上最难复现的部分。
 */

/** 退避序列：1s / 2s / 4s / 8s / 15s，之后一直是 15s */
export const BACKOFF_MS = [1000, 2000, 4000, 8000, 15000]

/**
 * 第 attempt 次重连前该等多久（attempt 从 1 开始）。
 * @param {number} attempt
 * @param {number} [jitterRatio] 0–1，随机抖动比例，避免多端同时重连
 * @param {() => number} [rand]
 */
export function nextDelay(attempt, jitterRatio = 0, rand = Math.random) {
  const n = Math.max(1, Math.floor(Number(attempt) || 1))
  const base = BACKOFF_MS[Math.min(n - 1, BACKOFF_MS.length - 1)]
  if (jitterRatio <= 0) return base
  const j = base * Math.min(1, jitterRatio) * rand()
  return Math.round(base - j)
}

/**
 * 定长环形缓冲（按毫秒记账的 PCM 队列）。
 * 断线期间把最近的音频留住，重连后补发，避免断点丢词。
 */
export class PcmRing {
  /** @param {number} capacityMs 最多保留多少毫秒音频（16k 单声道 16bit = 32 B/ms） */
  constructor(capacityMs = 3000, bytesPerMs = 32) {
    this.capacity = Math.max(1, Math.round(capacityMs * bytesPerMs))
    this.chunks = []
    this.size = 0
    this.droppedBytes = 0
  }

  push(buf) {
    if (!buf || !buf.length) return
    this.chunks.push(buf)
    this.size += buf.length
    while (this.size > this.capacity && this.chunks.length > 1) {
      const cut = this.chunks.shift()
      this.size -= cut.length
      this.droppedBytes += cut.length
    }
  }

  /** 取出全部并清空 */
  drain() {
    const all = this.chunks
    this.chunks = []
    this.size = 0
    return all
  }

  clear() {
    this.chunks = []
    this.size = 0
  }

  get bufferedMs() {
    return Math.round(this.size / 32)
  }
}

/**
 * 断点记账：决定"这次断线要不要在转写里标一个 gap"。
 *
 * 规则：
 *   - 丢失 < gapMarkerMs → 视为可接受，不打扰用户（重连补发通常能接上）
 *   - 丢失 ≥ gapMarkerMs → 写一条 gap 标记，让纪要里能看到"这里断过"
 */
export function shouldMarkGap(droppedMs, gapMarkerMs = 1500) {
  return Number(droppedMs) >= Math.max(1, Number(gapMarkerMs) || 1500)
}

/** 一条 gap 标记的文本（写进 transcript，src='gap'） */
export function gapText(droppedMs) {
  const sec = Math.max(1, Math.round((Number(droppedMs) || 0) / 1000))
  return `（此处中断约 ${sec} 秒，未识别）`
}

/**
 * 重连状态机（纯逻辑，不碰网络）
 *
 *   idle → connecting → online → degraded ⇄ connecting → failed
 */
export class ReconnectState {
  constructor({ maxAttempts = 6, jitterRatio = 0.2, rand = Math.random } = {}) {
    this.maxAttempts = maxAttempts
    this.jitterRatio = jitterRatio
    this.rand = rand
    this.attempt = 0
    this.phase = 'idle'
    this.reconnects = 0
    this.lastError = ''
  }

  get isOnline() { return this.phase === 'online' }
  get isFailed() { return this.phase === 'failed' }

  opened() {
    this.phase = 'online'
    this.attempt = 0
    this.lastError = ''
  }

  /** 断开：返回还要不要重试，以及等多久 */
  dropped(reason) {
    this.lastError = String(reason || '连接断开')
    if (this.phase === 'online') this.phase = 'degraded'
    this.attempt++
    if (this.attempt > this.maxAttempts) {
      this.phase = 'failed'
      return { retry: false, delayMs: 0, attempt: this.attempt }
    }
    this.phase = 'connecting'
    this.reconnects++
    return {
      retry: true,
      delayMs: nextDelay(this.attempt, this.jitterRatio, this.rand),
      attempt: this.attempt,
    }
  }

  snapshot() {
    return {
      phase: this.phase,
      attempt: this.attempt,
      reconnects: this.reconnects,
      lastError: this.lastError,
      online: this.isOnline,
      failed: this.isFailed,
    }
  }
}
