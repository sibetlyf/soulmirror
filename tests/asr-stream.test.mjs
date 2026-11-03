import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createResilientAsr } from '../lib/asr-stream.js'

/**
 * 用假客户端测"断线→缓冲→重连→补发→标断点"这条最容易出错的路径。
 * 全程不出网。
 */

function makeFakeClient(behavior = {}) {
  const created = []
  const makeAsr = (opts) => {
    const c = {
      sent: [],
      opened: false,
      finished: false,
      open: async () => {
        if (behavior.failOpen) throw new Error('握手失败')
        c.opened = true
        opts.onSentence?.({ text: '开场', sentenceEnd: true })
      },
      send: (buf) => {
        if (behavior.failSend) throw new Error('发送失败')
        c.sent.push(buf.length)
      },
      finish: async () => { c.finished = true },
      _opts: opts,
    }
    created.push(c)
    return c
  }
  return { makeAsr, created }
}

const baseOpts = (fake, extra = {}) => ({
  apiKey: 'x',
  onSentence: () => {},
  makeAsr: fake.makeAsr,
  maxAttempts: 3,
  ringMs: 1000,
  ...extra,
})

test('正常路径：start 后 feed 直接发送，计入 sentMs', async () => {
  const fake = makeFakeClient()
  const asr = createResilientAsr(baseOpts(fake))
  await asr.start()
  asr.feed(Buffer.alloc(3200)) // 100ms
  const s = asr.snapshot()
  assert.equal(s.online, true)
  assert.equal(s.sentMs, 100)
  assert.equal(fake.created[0].sent.length, 1)
})

test('断线期间 feed 进入缓冲，不算已发送', async () => {
  const fake = makeFakeClient()
  const asr = createResilientAsr(baseOpts(fake, { maxAttempts: 1 }))
  await asr.start()
  // 人为制造掉线：让 send 抛错
  fake.created[0].send = () => { throw new Error('网络断了') }
  asr.feed(Buffer.alloc(3200))
  const s = asr.snapshot()
  assert.ok(s.bufferedMs > 0 || s.droppedMs > 0)
  assert.equal(s.online, false)
})

test('握手失败会重试，且 attempt 递增', async () => {
  const fake = makeFakeClient({ failOpen: true })
  const asr = createResilientAsr(baseOpts(fake, { maxAttempts: 3 }))
  await asr.start()
  const s = asr.snapshot()
  assert.equal(s.online, false)
  assert.ok(s.attempt >= 1)
  assert.equal(s.phase, 'connecting')
  await asr.stop()
})

test('重试用尽后报错给调用方（不静默）', async () => {
  const errors = []
  const fake = makeFakeClient({ failOpen: true })
  // maxAttempts=0：一次都不重试，应立即上报
  const asr = createResilientAsr(baseOpts(fake, {
    maxAttempts: 0,
    onError: (e) => errors.push(e.message),
  }))
  await asr.start()
  await new Promise((r) => setTimeout(r, 50))
  assert.ok(errors.length >= 1, '应上报错误')
  assert.equal(asr.snapshot().failed, true)
  await asr.stop()
})

test('断线超过阈值会产出 gap 文案', async () => {
  const gaps = []
  const fake = makeFakeClient()
  const asr = createResilientAsr(baseOpts(fake, {
    maxAttempts: 2,
    ringMs: 4000,
    onGap: (g) => gaps.push(g),
  }))
  await asr.start()
  fake.created[0].send = () => { throw new Error('断线') }
  // ringMs=4000 → 容量 128000 字节；喂 256000 字节，必有约 128000 被挤掉（≈4000ms）
  asr.feed(Buffer.alloc(128000))
  asr.feed(Buffer.alloc(128000))
  await new Promise((r) => setTimeout(r, 1200))
  assert.ok(gaps.length >= 1, '应标记断点，实际 ' + gaps.length)
  assert.match(gaps[0].text, /中断/)
  await asr.stop()
})

test('stop 之后不再发送也不再重连', async () => {
  const fake = makeFakeClient()
  const asr = createResilientAsr(baseOpts(fake))
  await asr.start()
  await asr.stop()
  asr.feed(Buffer.alloc(3200))
  const s = asr.snapshot()
  assert.equal(s.bufferedMs, 0)
  assert.equal(fake.created[0].finished, true)
})

test('onState 会推送状态变化（供 /health 用）', async () => {
  const states = []
  const fake = makeFakeClient()
  const asr = createResilientAsr(baseOpts(fake, { onState: (s) => states.push(s) }))
  await asr.start()
  assert.ok(states.length >= 1)
  assert.ok('reconnects' in states[0])
})
