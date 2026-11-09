import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/**
 * 顺序约束：纪要必须在**非流式转写**（会后离线重转写）返回之后才生成。
 *
 * 用户要求（2026-11-09）：转写质量应以"会议结束后非流式转写结果"为准，再据此写纪要。
 * 原因：实时流式转写是边说边猜的中间结果——断句碎、同音字多、没有说话人；
 * 用它写纪要等于用草稿写总结。这正是那场会纪要质量差的一半原因。
 */

const src = readFileSync(new URL('../index.js', import.meta.url), 'utf8')

test('finalize 里不再一进来就用实时转写生成纪要', () => {
  const at = src.indexOf('async function finalizeMeeting(')
  const head = src.slice(at, at + 1200)
  assert.equal(/let md = await buildMinutes\(\)/.test(head), false, '开头不该立即 buildMinutes')
  assert.match(head, /let md = ''/, 'md 应先留空')
  assert.match(head, /必须等非流式转写结果/, '应有明确注释说明顺序')
})

test('offline 在前，纪要生成在后，知识库最后', () => {
  const at = src.indexOf('async function finalizeMeeting(')
  const seg = src.slice(at, at + 30000)

  const iOffline = seg.indexOf('runOfflinePass(')
  const iLiveMinutes = seg.indexOf('minutesViaBackgroundTask(runDir, liveLines')
  const iPersist = seg.indexOf("persistMinutesFile(join(runDir, 'minutes.md')")
  const iKnowledge = seg.indexOf('writeViaHostApi(')

  assert.ok(iOffline > 0, '应有离线重转写调用')
  assert.ok(iLiveMinutes > iOffline, '回退生成也必须排在离线之后')
  assert.ok(iPersist > iOffline, '纪要落盘应在离线之后（否则落的是草稿）')
  assert.ok(iKnowledge > iPersist, '写知识库应在纪要落盘之后')
})

test('非流式结果优先：off.md 存在就用它，并记录来源', () => {
  const at = src.indexOf('if (off.md) {')
  assert.ok(at > 0, '应优先采用离线结果')
  const seg = src.slice(at, at + 400)
  assert.match(seg, /md = off\.md/)
  assert.match(seg, /results\.minutesSource/, '应记录来源')
})

test('没有非流式结果时才回退实时转写，并明确告知质量会差', () => {
  const at = src.indexOf('没有非流式转写结果，退回用实时转写生成纪要')
  assert.ok(at > 0, '应有回退提示')
  const seg = src.slice(at - 200, at + 800)
  assert.match(seg, /minutesViaBackgroundTask\(runDir, liveLines/, '回退也优先走后台任务')
  assert.match(seg, /buildMinutes\(\)/, '最后才用会话内生成')
})
