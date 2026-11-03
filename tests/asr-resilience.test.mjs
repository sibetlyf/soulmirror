import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  BACKOFF_MS, nextDelay, PcmRing, shouldMarkGap, gapText, ReconnectState,
} from '../lib/asr-resilience.js'

/**
 * 这些是 ASR 断线时最容易出错的逻辑：
 * 退避会不会无限快重试、断线缓冲会不会吞掉音频、gap 标记该不该写。
 */

test('退避递增并封顶在 15s', () => {
  assert.equal(nextDelay(1), BACKOFF_MS[0])
  assert.equal(nextDelay(2), BACKOFF_MS[1])
  assert.equal(nextDelay(3), BACKOFF_MS[2])
  assert.equal(nextDelay(4), BACKOFF_MS[3])
  assert.equal(nextDelay(5), 15000)
  assert.equal(nextDelay(99), 15000)
})

test('非法 attempt 当作第 1 次，不会返回 0', () => {
  for (const v of [0, -3, NaN, undefined, 'abc']) {
    assert.equal(nextDelay(v), BACKOFF_MS[0])
  }
})

test('抖动只会提前、不会延后，且落在 0..base 区间', () => {
  const base = 4000
  assert.equal(nextDelay(3, 0.2, () => 0), base)
  assert.equal(nextDelay(3, 0.2, () => 1), Math.round(base * 0.8))
  const d = nextDelay(3, 0.2, () => 0.5)
  assert.ok(d > 0 && d <= base)
})

test('环形缓冲按毫秒容量裁剪，丢最旧', () => {
  const ring = new PcmRing(100) // 100ms = 3200 B
  ring.push(Buffer.alloc(2000))
  ring.push(Buffer.alloc(2000))
  assert.ok(ring.size <= 3200, '不应超过容量，实际 ' + ring.size)
  assert.ok(ring.droppedBytes > 0, '应有被丢弃的字节')
})

test('环形缓冲：小数据不丢，drain 后清空', () => {
  const ring = new PcmRing(1000)
  ring.push(Buffer.alloc(640))
  assert.equal(ring.drain().length, 1)
  assert.equal(ring.size, 0)
  assert.equal(ring.bufferedMs, 0)
})

test('gap 判定：低于阈值不打扰，达到阈值才标', () => {
  assert.equal(shouldMarkGap(0), false)
  assert.equal(shouldMarkGap(1200), false)
  assert.equal(shouldMarkGap(1500), true)
  assert.equal(shouldMarkGap(9000), true)
  assert.equal(shouldMarkGap(1200, 1000), true)
})

test('gap 文案说明"约 N 秒"，不会露内部术语', () => {
  assert.match(gapText(2400), /约 2 秒/)
  assert.match(gapText(200), /约 1 秒/, '不足 1 秒也说 1 秒，不显示 0')
})

test('重连状态机：在线后掉线 → 退避重试 → 成功回到 online', () => {
  const st = new ReconnectState({ rand: () => 1 })
  st.opened()
  assert.equal(st.isOnline, true)

  const r1 = st.dropped('网络错误')
  assert.equal(r1.retry, true)
  assert.equal(r1.attempt, 1)
  assert.ok(r1.delayMs > 0)
  assert.equal(st.phase, 'connecting')

  st.opened()
  assert.equal(st.phase, 'online')
  assert.equal(st.attempt, 0, '成功后计数应清零')
  assert.equal(st.reconnects, 1)
})

test('重连状态机：连续失败到上限后进入 failed，不再重试', () => {
  const st = new ReconnectState({ maxAttempts: 2, rand: () => 1 })
  st.opened()
  assert.equal(st.dropped('e1').retry, true)
  assert.equal(st.dropped('e2').retry, true)
  const last = st.dropped('e3')
  assert.equal(last.retry, false)
  assert.equal(st.isFailed, true)
  assert.equal(st.snapshot().failed, true)
})

test('重连计数用于健康指标', () => {
  const st = new ReconnectState({ rand: () => 1 })
  st.opened()
  st.dropped('a'); st.opened()
  st.dropped('b'); st.opened()
  assert.equal(st.snapshot().reconnects, 2)
})
