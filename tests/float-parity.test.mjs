import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/**
 * 悬浮窗 = 大页面去掉配置。
 *
 * 用户要求："展示的也不全啊，是大页面除了配置之外的所有东西，参考之前的小页面。"
 * 所以要求它具备：控制（开始/结束录音）、状态、问题、体检、进度、
 * 转写列表、建议、会后整理、恢复补救、状态横条；唯独不放开设备/模型/密钥等配置。
 */

const client = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')

function floatBody() {
  const at = client.indexOf('function FloatPanel()')
  assert.ok(at > 0, '找不到 FloatPanel')
  const rest = client.slice(at + 10)
  const next = rest.search(/\n {4}function [A-Z]/)
  return client.slice(at, next > 0 ? at + 10 + next : client.length)
}

const REQUIRED = [
  ['开始/结束录音', /callAuto\(/],
  ['状态文案', /转录中|正在收尾|生成纪要中/],
  ['问题横幅', /h\(IssueBanner, null\)/],
  ['一键体检', /h\(HealthCheck, null\)/],
  ['进度条', /h\(ProgressBar, null\)/],
  ['转写列表', /linesAll\.map/],
  ['建议视图', /lv\.advice/],
  ['会后整理', /h\(AfterMeetingCard\)/],
  ['未整理补救', /h\(RecoveryCard\)/],
  ['状态横条', /h\(StatusStrip/],
  ['收起按钮', /store\.set\(false\)/],
]

test('悬浮窗具备大页面除配置外的全部区块', () => {
  const body = floatBody()
  for (const [label, re] of REQUIRED) {
    assert.match(body, re, '悬浮窗缺少：' + label)
  }
})

test('悬浮窗仍然不含配置项', () => {
  const body = floatBody()
  for (const forbidden of ['DevicePicker', 'apiKey', 'ConfigTab', 'SetupCard', 'switchMode', 'onChange']) {
    assert.equal(body.includes(forbidden), false, '悬浮窗不该有配置：' + forbidden)
  }
})

test('悬浮窗三个标签：转写 / 建议 / 会后', () => {
  const body = floatBody()
  assert.match(body, /tabBtn\('transcript'/, '缺少转写标签')
  assert.match(body, /tabBtn\('advice'/, '缺少建议标签')
  assert.match(body, /tabBtn\('after'/, '缺后会标签')
})
