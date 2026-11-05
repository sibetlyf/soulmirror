import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { EventEmitter } from 'node:events'
import { WsClient } from '../lib/ws.js'

/**
 * 事故：语音识别连接被服务端重置（ECONNRESET），socket 的 'error' 被转发成
 * WsClient 的 'error' 事件，而那一刻**没有监听者** → EventEmitter 抛未捕获异常
 * → 整个 DSH 进程闪退（"fatal uncaught exception: read ECONNRESET"）。
 */

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')

test('WsClient 提供 emitSafeError，且无监听时不抛', () => {
  const c = new WsClient({ timeoutMs: 1000 })
  // 关键：没有任何 'error' 监听者，调用不能抛
  assert.doesNotThrow(() => c.emitSafeError(new Error('read ECONNRESET')))
})

test('有监听者时 error 正常送达', () => {
  const c = new WsClient({ timeoutMs: 1000 })
  let got = null
  c.on('error', (e) => { got = e })
  c.emitSafeError(new Error('ECONNRESET'))
  assert.ok(got)
  assert.match(got.message, /ECONNRESET/)
})

test('监听者自己抛错也不影响调用方', () => {
  const c = new WsClient({ timeoutMs: 1000 })
  c.on('error', () => { throw new Error('监听者炸了') })
  assert.doesNotThrow(() => c.emitSafeError(new Error('x')))
})

test('EventEmitter 的对照实验：直接 emit 无监听确实会抛', () => {
  const e = new EventEmitter()
  assert.throws(() => e.emit('error', new Error('ECONNRESET')), /ECONNRESET/)
})

test('socket 层用 emitSafeError 而不是 emit(\'error\')', () => {
  const src = read('../lib/ws.js')
  assert.match(src, /this\.emitSafeError\(e\)/, 'sock error 没有走安全通道')
  assert.equal(/sock\.on\('error',[\s\S]{0,120}this\.emit\('error'/.test(src), false, '不该直接 emit')
})

test('ASR 客户端监听了 ws 的 error，且会转成重连', () => {
  const src = read('../lib/dashscope.js')
  assert.match(src, /ws\.on\('error'/, 'dashscope 没监听 ws error（ECONNRESET 会打崩宿主）')
  const at = src.indexOf("ws.on('error'")
  const seg = src.slice(at, at + 400)
  assert.match(seg, /emitErr\(/, 'error 应交给 onError（resilient 层据此重连）')
  assert.match(seg, /onClose\?\./, 'error 也应触发 onClose，保持状态一致')
})
