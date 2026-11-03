import { test } from 'node:test'
import assert from 'node:assert/strict'

/**
 * /health 的判定逻辑：哪些情况该报"不健康"。
 * 纯函数，脱离运行时也能测。
 */
function healthProblems({ enabled, capturing, asr = {}, lastAgeMs = null, droppedMs = 0, overBudget = false, budgetMinutes = 0 }) {
  const problems = []
  if (enabled && capturing && !asr.online) problems.push('语音识别未连接')
  if (enabled && capturing && asr.failed) problems.push('语音识别重连失败次数用尽')
  if (lastAgeMs !== null && lastAgeMs > 120000 && capturing) problems.push('超过 2 分钟没有新转写')
  if (droppedMs > 5000) problems.push('断线累计丢失 ' + Math.round(droppedMs / 1000) + ' 秒音频')
  if (overBudget) problems.push('已超出本次会议识别预算 ' + budgetMinutes + ' 分钟')
  return problems
}

test('一切正常时没有问题', () => {
  assert.deepEqual(healthProblems({ enabled: true, capturing: true, asr: { online: true }, lastAgeMs: 1000 }), [])
})

test('关闭插件时即使没连接也不算问题（本来就不该连）', () => {
  assert.deepEqual(healthProblems({ enabled: false, capturing: false, asr: { online: false } }), [])
})

test('开着且在采集但 ASR 没连上 → 报警', () => {
  const p = healthProblems({ enabled: true, capturing: true, asr: { online: false } })
  assert.ok(p.includes('语音识别未连接'))
})

test('重连次数用尽 → 单独报警（比"未连接"更严重）', () => {
  const p = healthProblems({ enabled: true, capturing: true, asr: { online: false, failed: true } })
  assert.ok(p.includes('语音识别重连失败次数用尽'))
})

test('超过 2 分钟没有新转写 → 报警（卡死的典型表现）', () => {
  const p = healthProblems({ enabled: true, capturing: true, asr: { online: true }, lastAgeMs: 121000 })
  assert.ok(p.some((x) => x.includes('没有新转写')))
})

test('断线累计丢失超过 5 秒 → 报警', () => {
  const p = healthProblems({ enabled: true, capturing: true, asr: { online: true }, droppedMs: 6000 })
  assert.ok(p.some((x) => x.includes('丢失 6 秒')))
})

test('丢失不足 5 秒不吵人（gap 已经写在转写里了）', () => {
  const p = healthProblems({ enabled: true, capturing: true, asr: { online: true }, droppedMs: 3000 })
  assert.equal(p.length, 0)
})

test('超预算 → 报警并带上限数值', () => {
  const p = healthProblems({ enabled: true, capturing: true, asr: { online: true }, overBudget: true, budgetMinutes: 60 })
  assert.ok(p.some((x) => x.includes('60 分钟')))
})

test('多个问题同时出现会全部列出（不掩盖）', () => {
  const p = healthProblems({
    enabled: true, capturing: true,
    asr: { online: false, failed: true }, lastAgeMs: 200000, droppedMs: 9000, overBudget: true, budgetMinutes: 30,
  })
  assert.ok(p.length >= 4)
})
