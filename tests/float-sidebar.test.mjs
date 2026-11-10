import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/**
 * 悬浮窗必须是"右侧侧边栏"，不是右下角浮卡。
 *
 * 用户反馈："挡住了，改为那种侧边栏。"
 * 浮卡（right+bottom 定位、圆角、限高）会压住会议客户端底部的按钮；
 * 侧边栏贴右缘整列高度，不挡中间操作区。
 */

const client = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')

function floatBody() {
  const at = client.indexOf('function FloatPanel()')
  assert.ok(at > 0, '找不到 FloatPanel')
  const rest = client.slice(at + 10)
  const next = rest.search(/\n {4}function [A-Z]/)
  return client.slice(at, next > 0 ? at + 10 + next : client.length)
}

test('悬浮窗用侧边栏定位（贴右缘、整列高度）', () => {
  const body = floatBody()
  assert.match(body, /position: 'fixed', top: 0, right: 0, bottom: 0/, '应是贴右缘的整列侧边栏')
  assert.match(body, /borderLeft:/, '侧边栏用左边框分隔')
})

test('不再是右下角浮卡（不再有 bottom: 16 / 圆角卡片）', () => {
  const body = floatBody()
  assert.equal(/bottom: 16, width/.test(body), false, '不该再有右下角浮卡定位')
  assert.equal(/borderRadius: 12/.test(body), false, '不该再有浮卡圆角')
  assert.equal(/maxHeight: '78vh'/.test(body), false, '侧边栏不需要限高')
})

test('侧边栏宽度合理（≤ 420px，避免挤压主内容）', () => {
  const body = floatBody()
  const m = /width: (\d+)/.exec(body)
  assert.ok(m, '应有固定宽度')
  const w = Number(m[1])
  assert.ok(w >= 300 && w <= 420, '宽度应在 300~420，实际 ' + w)
})

test('保持可关闭 + 阴影朝左（贴在右侧的视觉暗示）', () => {
  const body = floatBody()
  assert.match(body, /setClosed\(true\)/, '应能关闭')
  assert.match(body, /boxShadow: '-8px 0 24px/, '阴影应朝左')
})
