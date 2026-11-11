import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/**
 * 现场：会议助手面板里的主按钮变成一块"黑色方块"。
 *
 * 原因不是样式写错，而是主题变量在真实页面里不存在——
 * 在运行中的 DSH 页面控制台实测：
 *   getComputedStyle(document.documentElement)
 *     .getPropertyValue('--dsw-alias-bg-layer-1') === ''
 *     .getPropertyValue('--dsw-alias-brand-primary') === ''
 * 于是 `background: var(--dsw-alias-brand-primary)` 是无效值，
 * 浏览器退回初始背景色（黑），而文字色同样是无效值 → 黑底黑字。
 *
 * 规则：主题变量必须写成 `var(--token, 兜底色)`。
 * 宿主提供了就用宿主的，宿主没提供也不会变成黑块。
 */

const client = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')

test('任何主题变量都必须带兜底值（否则可能变成黑底黑字）', () => {
  const bare = client.match(/var\(--dsw-[a-z0-9-]+\)/g) || []
  assert.deepEqual([...new Set(bare)], [], '这些主题变量没有兜底值：' + [...new Set(bare)].join(', '))
})

test('主按钮：品牌色与文字色都有兜底，且文字色与背景色不同', () => {
  assert.match(client, /brand: 'var\(--dsw-alias-brand-primary, #[0-9a-fA-F]{3,6}\)'/, '品牌色要有兜底')
  assert.match(client, /brandText: 'var\(--dsw-alias-label-inverse, #[0-9a-fA-F]{3,6}\)'/, '主按钮文字色要有兜底')
  const style = client.slice(client.indexOf('btnPrimary: {'), client.indexOf('iconBtn: {'))
  assert.match(style, /color: T\.brandText/, '主按钮文字必须用 brandText，不能写死成无效变量')
  assert.doesNotMatch(style, /color: 'var\(--dsw-alias-label-inverse\)'/, '不能留没有兜底的文字色')
})

test('面板底色/文字色也有兜底（白底深字，不是黑底黑字）', () => {
  assert.match(client, /bg: 'var\(--dsw-alias-bg-layer-1, #ffffff\)'/)
  assert.match(client, /text: 'var\(--dsw-alias-label-primary, #1f2329\)'/)
})
