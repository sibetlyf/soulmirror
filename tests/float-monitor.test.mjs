import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/**
 * 悬浮监视窗：要有，但不许有配置。
 *
 * 用户原话："悬浮页面还是要有的，但不要有配置之类的了。"
 * 所以：只看状态（状态/问题/进度/最近一句），配置统一在 设置 → 会议助手。
 */

const client = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')

/** 取出 FloatPanel 函数体 */
function floatBody() {
  const at = client.indexOf('function FloatPanel()')
  assert.ok(at > 0, '找不到 FloatPanel')
  // 到下一个同级 function 声明为止
  const rest = client.slice(at + 10)
  const next = rest.search(/\n {4}function [A-Z]/)
  return client.slice(at, next > 0 ? at + 10 + next : client.length)
}

test('悬浮窗存在并已注册到 shell.overlay', () => {
  assert.match(client, /function FloatPanel\(\)/, '应有悬浮窗组件')
  assert.match(client, /inject\('shell\.overlay'/, '应注册 shell.overlay')
  const seg = client.slice(client.indexOf("inject('shell.overlay'"), client.indexOf("inject('shell.overlay'") + 500)
  assert.match(seg, /FloatPanel/, 'overlay 应渲染 FloatPanel')
})

test('悬浮窗显示状态 / 句数 / 时长', () => {
  const body = floatBody()
  assert.match(body, /转录中|正在收尾|生成纪要中/, '应有状态文案')
  assert.match(body, /lines\.length \+ ' 句'/, '应显示句数')
  assert.match(body, /sentMs/, '应显示时长')
})

test('悬浮窗复用问题横幅与进度条（故障可见）', () => {
  const body = floatBody()
  assert.match(body, /h\(IssueBanner, null\)/, '应显示问题横幅')
  assert.match(body, /h\(ProgressBar, null\)/, '应显示进度条')
})

test('悬浮窗不含任何配置控件', () => {
  const body = floatBody()
  for (const forbidden of ['DevicePicker', 'apiKey', 'onChange', 'capture', '模型', '密钥输入', 'select']) {
    assert.equal(body.includes(forbidden), false, '悬浮窗不该出现配置项：' + forbidden)
  }
})

test('悬浮窗可关闭，且下一场会自动恢复', () => {
  const body = floatBody()
  assert.match(body, /setClosed\(true\)/, '应能关闭')
  assert.match(body, /if \(!capturing && !running\) setClosed\(false\)/, '结束后复位，下一场自动出现')
})

test('悬浮窗始终可见（未启用时也显示，否则用户"没看到"）', () => {
  const body = floatBody()
  // 只在用户主动关闭时不渲染，其余情况都要在
  assert.match(body, /if \(closed\) return null/, '关闭后不渲染')
  assert.equal(/if \(!capturing && !running\) return null/.test(body), false,
    '不该因为没在开会就完全消失（用户会以为插件坏了）')
})

test('未启用时显示"去设置开启"，而不是空白', () => {
  const body = floatBody()
  assert.match(body, /未启用 · 去设置开启/, '要明确说明未启用')
})

test('入口仍是 4 个（悬浮窗不是额外页面入口）', () => {
  const injects = [...client.matchAll(/slots\.inject\('([^']+)'/g)].map((m) => m[1]).sort()
  assert.deepEqual(injects, ['conversation.input.dock', 'main', 'settings.section', 'shell.overlay', 'sidebar.panellist'])
})
