import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/**
 * 进度必须在**大页面和小窗**都显示。
 *
 * 用户反馈："大小页面都没显示转录进度"——之前进度只放在「会后整理」卡片里，
 * 而那张卡片在大页面的某个标签页内，小窗完全看不到。
 */

const client = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')

test('存在共用的 ProgressBar 组件（两处复用同一份逻辑）', () => {
  assert.match(client, /function ProgressBar\(props\)/, '应有共用进度条组件')
})

test('大页面渲染 ProgressBar', () => {
  const at = client.indexOf('function MeetingPage(')
  const seg = client.slice(at, at + 20000)
  assert.match(seg, /h\(ProgressBar, null\)/, '大页面必须显示进度条')
})

test('进度条只出现在主页面与悬浮监视窗（没有第三套 UI）', () => {
  const count = (client.match(/h\(ProgressBar, null\)/g) || []).length
  // 主页面 1 处 + 悬浮窗 1 处；多出来就说明又长了第三套 UI
  assert.equal(count, 2, '进度条应只有主页面与悬浮窗两处，实际 ' + count + ' 处')

  const page = client.slice(client.indexOf('function MeetingPage('), client.indexOf('function MeetingPage(') + 20000)
  assert.match(page, /h\(ProgressBar, null\)/, '主页面应有进度条')

  const floatAt = client.indexOf('function FloatPanel()')
  assert.ok(floatAt > 0, '应有悬浮监视窗')
  // 悬浮窗函数体：到下一个同级 function 声明为止（固定长度会截断）
  const rest = client.slice(floatAt + 10)
  const next = rest.search(/\n {4}function [A-Z]/)
  const floatSeg = client.slice(floatAt, next > 0 ? floatAt + 10 + next : client.length)
  assert.match(floatSeg, /h\(ProgressBar, null\)/, '悬浮窗应有进度条')
})

test('会后整理进行中时显示阶段/百分比/耗时', () => {
  const at = client.indexOf('function ProgressBar(')
  const seg = client.slice(at, at + 2600)
  assert.match(seg, /postMeeting/, '应读会后整理状态')
  assert.match(seg, /percent/, '应显示百分比')
  assert.match(seg, /elapsedSec/, '应显示耗时')
  assert.match(seg, /stageLabel/, '应显示阶段')
  assert.match(seg, /height: 4/, '应有进度条')
})

test('未在整理时显示会中转录活动（有动感，不是空白）', () => {
  const at = client.indexOf('function ProgressBar(')
  const seg = client.slice(at, at + 4200)
  assert.match(seg, /句/, '应显示句数')
  assert.match(seg, /已识别/, '应显示已识别时长')
  assert.match(seg, /秒前有过转写|最近一句/, '应显示最后一句时间')
})
