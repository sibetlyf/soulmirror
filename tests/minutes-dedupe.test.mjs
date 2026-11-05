import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/**
 * 纪要重复生成的回归测试。
 *
 * 事故背景：一场会结束后 8 分钟里 buildMinutes 被调了 34 次，
 * 每次都把整段提示词投进会话 → 用户看到"不断重复写纪要"。
 * 这些断言直接在源码上钉住两道闸：快照去重 + 收尾防抖。
 */

const src = readFileSync(new URL('../index.js', import.meta.url), 'utf8')

test('buildMinutes 有"同一转写快照只生成一次"的快照键', () => {
  const i = src.indexOf('async function buildMinutes')
  assert.ok(i > 0, '找不到 buildMinutes')
  const body = src.slice(i, i + 2000)
  assert.match(body, /const key = \[/, '缺少快照键')
  assert.match(body, /key === minutesKey/, '没有拿快照键做比较')
  assert.match(body, /return lastMinutesMd/, '命中重复时没有复用上次结果')
})

test('buildMinutes 会把结果缓存起来（否则去重返回空）', () => {
  const i = src.indexOf('async function buildMinutes')
  const body = src.slice(i, i + 2000)
  assert.match(body, /lastMinutesMd = out/, '模型结果没有缓存')
  assert.match(body, /lastMinutesMd = fallback/, '抽取式结果没有缓存')
})

test('收尾防抖在入口就打时间戳（中途抛错也不会被反复触发）', () => {
  const i = src.indexOf('async function finalizeMeeting')
  assert.ok(i > 0, '找不到 finalizeMeeting')
  const body = src.slice(i, i + 700)
  const guardAt = body.indexOf("if (Date.now() - lastFinalizedAt < 60000)")
  const stampAt = body.indexOf('lastFinalizedAt = Date.now()')
  assert.ok(guardAt >= 0, '没有 60 秒防抖')
  assert.ok(stampAt > guardAt, '时间戳应在防抖判断之后立刻打上')
  // 打时间戳的位置必须在"开始干活"之前（不能还在函数末尾）
  const firstAwait = body.indexOf('await buildMinutes')
  assert.ok(stampAt < firstAwait, '时间戳打得太晚：抛错时会绕过防抖')
})

test('每次生成纪要都会留下带次数的日志', () => {
  assert.match(src, /minutesRuns \+= 1/)
  assert.match(src, /生成纪要（第 ' \+ minutesRuns/)
  assert.match(src, /跳过重复的纪要生成/)
})
