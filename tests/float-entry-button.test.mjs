import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/**
 * 侧栏入口按钮。
 *
 * 用户要求："就像之前一样，加入按钮啊"——重构时把 footer 那个 🎙 会议 按钮一起删了，
 * 于是关掉侧栏后就再也打不开。现在按钮回来，负责展开/收起。
 */

const client = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')

test('入口按钮已注册在 sidebar.footer.action', () => {
  assert.match(client, /inject\('sidebar\.footer\.action'/, '应重新注册 footer 入口')
  const at = client.indexOf("inject('sidebar.footer.action'")
  const seg = client.slice(at, at + 420)
  assert.match(seg, /EntryButton/, 'footer 应渲染入口按钮')
})

test('按钮切换侧栏开合（store.set）', () => {
  const at = client.indexOf('function EntryButton()')
  assert.ok(at > 0, '应有 EntryButton 组件')
  const seg = client.slice(at, at + 1600)
  assert.match(seg, /store\.set\(!s\.open\)/, '点一下应切换开合')
  assert.match(seg, /🎙/, '带图标，能认出来')
  assert.match(seg, /会议/, '带文字')
})

test('按钮上有状态点（未采集灰、采集中绿、整理中橙）', () => {
  const at = client.indexOf('function EntryButton()')
  const seg = client.slice(at, at + 1600)
  assert.match(seg, /S\.dot/, '应有状态点')
  assert.match(seg, /stopping\|offline\|minutes|pm\.phase === 'stopping'/, '要能反映整理中')
})

test('侧栏可见性由按钮控制，且采集开始时自动展开', () => {
  const at = client.indexOf('function FloatPanel()')
  const rest = client.slice(at + 10)
  const next = rest.search(/\n {4}function [A-Z]/)
  const body = client.slice(at, next > 0 ? at + 10 + next : client.length)
  assert.match(body, /if \(!ui\.open\) return null/, '未打开时不渲染')
  assert.match(body, /store\.set\(true\)/, '采集开始时自动展开')
  assert.match(body, /store\.set\(false\)/, '✕ 可收起')
})
