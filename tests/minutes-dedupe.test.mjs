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

test('收尾交给持久化队列去重，不再依赖会误伤下一场的全局60秒防抖', () => {
  const at = src.indexOf('async function stopAndOrganize(')
  assert.ok(at > 0)
  const body = src.slice(at, src.indexOf('const pipeline = createPostMeeting',at))
  assert.match(body, /pipeline\.enqueue\(dir/)
  assert.doesNotMatch(body, /lastFinalizedAt/)
  // 并发重复/失败释放/跨会议隔离由 finalize-isolation-wiring 行为测试覆盖。
})

test('每次生成纪要都会留下带次数的日志', () => {
  assert.match(src, /minutesRuns \+= 1/)
  assert.match(src, /生成纪要（第 ' \+ minutesRuns/)
  assert.match(src, /跳过重复的纪要生成/)
})
