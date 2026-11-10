import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/**
 * 取消语义与离会不阻塞（审查第二批）。
 *
 * 问题 1：withTimeout 超时只结束等待，底层重转写还在跑，之后继续写盘
 *         → "已超时"与"结果又冒出来"并存。
 * 问题 2：meeting_leave 先 await 整理再点离开，云端重转写要几分钟，
 *         用户被卡在会议里出不去。
 */

const src = readFileSync(new URL('../index.js', import.meta.url), 'utf8')

test('withTimeout 支持 onTimeout，真的通知底层取消', () => {
  const at = src.indexOf('function withTimeout(')
  assert.ok(at > 0)
  const seg = src.slice(at, at + 700)
  assert.match(seg, /onTimeout/, '应接受取消回调')
  assert.match(seg, /cancelled: true/, '超时结果应标注已取消')
  assert.match(seg, /try \{ onTimeout\?\.\(\) \}/, '回调失败不该影响返回')
})

test('离线重转写接受取消标记，写盘前检查', () => {
  const at = src.indexOf('async function runOfflinePass(')
  const seg = src.slice(at, at + 300)
  assert.match(seg, /isCancelled/, '应接受取消函数')

  const writeAt = src.indexOf('离线重转写已超时取消')
  assert.ok(writeAt > 0, '写盘前应有取消检查')
  const writeSeg = src.slice(writeAt, writeAt + 300)
  assert.match(writeSeg, /return \{ ok: false, cancelled: true/, '取消后应丢弃结果')
})

test('调用处把取消标记接起来', () => {
  assert.match(src, /isCancelled:task\.isCancelled/, '应传给 runOfflinePass')
  const runner = readFileSync(new URL('../lib/postmeeting.js',import.meta.url),'utf8')
  assert.match(runner,/new AbortController\(/, '每个任务应有独立取消令牌')
  assert.match(runner,/job\.controller\.signal\.aborted/, '取消状态必须绑定本任务，防止迟到结果影响下一任务')
})

test('离会不再等待整理', () => {
  const at = src.indexOf("name: 'meeting_leave'")
  const seg = src.slice(at, at + 1400)
  assert.equal(/await stopAndOrganize\(/.test(seg), false, '离会不该 await 整理')
  assert.match(seg, /stopAndOrganize\('离开会议', \{ wasCapturing: true \}\)/, '应后台触发整理')
})
