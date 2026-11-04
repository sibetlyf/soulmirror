/**
 * 生产级 ASR 流：把 DashScope 裸客户端包成"会自己重连、会记账、会标断点"的组件。
 *
 * 记账原则（之前写错过，这里定死）：
 *   - 断线期间进来的音频先进环形缓冲，重连后补发 → 这部分**不算丢**
 *   - 只有缓冲被撑满、把最旧的挤掉 → 那才是**真丢**
 *   - 真丢累计到阈值，才在转写里标一条 gap
 */
import { startDashScopeAsr } from './dashscope.js'
import { PcmRing, ReconnectState, shouldMarkGap, gapText } from './asr-resilience.js'

const BYTES_PER_MS = 32 // 16k 单声道 16bit

export function createResilientAsr(opts) {
  const {
    apiKey, model, asr = {}, onSentence, onError, onGap, onState, logger,
    ringMs = 4000, maxAttempts = 6,
  } = opts
  const makeAsr = opts.makeAsr || startDashScopeAsr

  const ring = new PcmRing(ringMs)
  const state = new ReconnectState({ maxAttempts })
  let client = null
  let stopped = false
  let timer = null
  let sentBytes = 0
  let lostBytes = 0
  let connecting = null
  let evictedBase = 0

  function snapshot() {
    return {
      ...state.snapshot(),
      sentMs: Math.round(sentBytes / BYTES_PER_MS),
      droppedMs: Math.round(lostBytes / BYTES_PER_MS),
      bufferedMs: ring.bufferedMs,
    }
  }

  let lastNotifyAt = 0

  function notify() {
    try { onState?.(snapshot()) } catch { /* ignore */ }
  }

  async function connect() {
    if (stopped) return
    if (connecting) return connecting
    connecting = (async () => {
      try {
        client = makeAsr({
          apiKey,
          model,
          sampleRate: 16000,
          asr,
          onSentence: (s) => { try { onSentence?.(s) } catch { /* ignore */ } },
          onError: (e) => handleDrop(e?.message || 'ASR 错误'),
        })
        await client.open()
        state.opened()

        // 只把"被挤掉"的算真丢；留在缓冲里的会被补发
        const evicted = ring.droppedBytes - evictedBase
        if (evicted > 0) {
          lostBytes += evicted
          const lostMs = Math.round(evicted / BYTES_PER_MS)
          if (shouldMarkGap(lostMs)) {
            try { onGap?.({ droppedMs: lostMs, text: gapText(lostMs) }) } catch { /* ignore */ }
          }
        }
        evictedBase = ring.droppedBytes

        const backlog = ring.drain()
        for (const buf of backlog) {
          try { client.send(buf); sentBytes += buf.length } catch { /* ignore */ }
        }
        notify()
      } catch (e) {
        handleDrop(e?.message || '连接失败')
      } finally {
        connecting = null
      }
    })()
    return connecting
  }

  function handleDrop(reason) {
    if (stopped) return
    try { client?.finish?.()?.catch?.(() => {}) } catch { /* ignore */ }
    client = null
    evictedBase = ring.droppedBytes

    const r = state.dropped(reason)
    notify()
    if (!r.retry) {
      logger?.warn?.('[soulmirror] ASR 重连次数用尽：' + reason)
      try { onError?.(new Error('语音识别连接中断：' + reason)) } catch { /* ignore */ }
      return
    }
    logger?.info?.(
      '[soulmirror] ASR 断开（' + reason + '），' + Math.round(r.delayMs / 1000) +
      ' 秒后第 ' + r.attempt + ' 次重连',
    )

    clearTimeout(timer)
    timer = setTimeout(() => { connect() }, r.delayMs)
    timer.unref?.()
  }

  return {
    get online() { return state.isOnline && !!client },
    // session 的内层循环用这个判断"识别还能不能继续"
    get closed() { return stopped || state.isFailed },

    async start() {
      stopped = false
      await connect()
      return snapshot()
    },

    feed(pcm) {
      if (stopped || !pcm || !pcm.length) return
      if (client && state.isOnline) {
        try {
          client.send(pcm)
          sentBytes += pcm.length
          // 每 500ms 刷新一次快照：否则面板看到的 sentMs 永远停在 0
          const now = Date.now()
          if (now - lastNotifyAt >= 500) { lastNotifyAt = now; notify() }
          return
        } catch (e) {
          handleDrop(e?.message || '发送失败')
        }
      }
      ring.push(pcm) // 离线时留缓冲，溢出部分由 ring 记入 droppedBytes
      const now2 = Date.now()
      if (now2 - lastNotifyAt >= 500) { lastNotifyAt = now2; notify() }
    },

    async stop() {
      stopped = true
      clearTimeout(timer)
      try { await client?.finish?.() } catch { /* ignore */ }
      client = null
      ring.clear()
      notify()
    },

    snapshot,
  }
}
