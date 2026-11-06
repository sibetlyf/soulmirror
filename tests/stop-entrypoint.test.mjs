import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/**
 * 停止入口的接线断言 + 关键回归。
 *
 * 审查 P1-3：两个工具先 `session.stopCapture()`，再调 `stopAndOrganize()`，
 * 后者读 `session.capturing` 已是 false → 整理被跳过。
 * 修复后：统一由 stopAndOrganize 负责停采，调用方用 wasCapturing 声明前态。
 *
 * 说明：这几条是接线断言（工具体内无法直接单测），
 * 但配套的行为测试见 transcript-pipeline / minutes-save-behavior。
 */

const src = readFileSync(new URL('../index.js', import.meta.url), 'utf8')

test('stopAndOrganize 接受 wasCapturing，并由它负责停采', () => {
  const at = src.indexOf('async function stopAndOrganize(')
  assert.ok(at > 0)
  const seg = src.slice(at, at + 1200)
  assert.match(seg, /opts\.wasCapturing/, '应支持调用方声明前态')
  assert.match(seg, /stopResult = await session\.stopCapture\(\)/, '停采应在它内部做')
})

test('两个停止工具不再自己先停一次', () => {
  const at1 = src.indexOf("name: 'meeting_capture_stop'")
  const captureStop = src.slice(at1, at1 + 900)
  assert.equal(/await session\.stopCapture\(\)/.test(captureStop), false, 'capture_stop 不该先停')
  assert.match(captureStop, /wasCapturing: true/, '应声明前态')

  const at2 = src.indexOf("name: 'meeting_agent_stop'")
  const agentStop = src.slice(at2, at2 + 900)
  assert.equal(/await session\.stopCapture\(\)/.test(agentStop), false, 'agent_stop 不该先停')
  assert.match(agentStop, /wasCapturing: true/)
})

test('/auto stop 与离会走同一入口（不各自复制停止+整理）', () => {
  const autoStop = src.slice(src.indexOf("stopAndOrganize('结束录音'"), src.indexOf("stopAndOrganize('结束录音'") + 400)
  assert.match(autoStop, /wasCapturing: hadAudio/)

  const atExit = src.indexOf("stopAndOrganize('离开会议'")
  assert.ok(atExit > 0, 'onExit 应走统一入口')
})

test('saveMinutes 不再被同名函数遮蔽（内部已改名）', () => {
  assert.equal(/async function saveMinutes\(/.test(src), false, '不该再有同名内部函数')
  assert.match(src, /import \{ saveMinutes as persistMinutesFile \}/, '导入应改用别名')
  assert.match(src, /persistMinutesFile\(/, '调用应用别名')
})
