import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/**
 * 为什么"每次安装默认不打开"。
 *
 * 真因（不是安装默认值，而是被持久化的"关闭"）：
 *   ① 旧代码把「结束录音」实现成"关闭总开关"，并 savePersisted({enabled:false})
 *   ② loadPersisted() 用磁盘值覆盖运行时 → 重启/重装后仍是 false
 *   ③ 配置目录 ~/.dsh/soulmirror 不随插件重装清空，所以 false 一直被带下去
 *
 * 现在的语义：
 *   · 总开关默认开（config.enabled !== false）
 *   · 「结束录音」只停采集 + 会后整理，不动总开关
 *   · 真正的关闭用 action: 'off'（设置里的开关），会持久化 false
 */

const src = readFileSync(new URL('../index.js', import.meta.url), 'utf8')
const client = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')

test('总开关默认开（装上就能用）', () => {
  assert.match(src, /enabled: config\.enabled !== false/, '默认应为开，只有显式 false 才关')
  assert.equal(/enabled: config\.enabled === true\s*,/.test(src), false, '不能再用严格 true 当默认')
})

test('结束录音不再关闭总开关', () => {
  const at = src.indexOf("} else if (action === 'stop') {")
  assert.ok(at > 0, '应有 stop 分支')
  const seg = src.slice(at, at + 900)
  assert.equal(/cfg\.enabled = false/.test(seg), false, 'stop 分支不得修改 cfg.enabled')
  assert.equal(/armed = false/.test(seg), false, 'stop 分支不得解除 armed')
  assert.match(seg, /stopAndOrganize/, 'stop 应触发会后整理')
})

test('真正关闭走 action=off，并持久化', () => {
  const at = src.indexOf("} else if (action === 'off') {")
  assert.ok(at > 0, '应有 off 分支')
  const seg = src.slice(at, at + 400)
  assert.match(seg, /armed = false/)
  assert.match(seg, /cfg\.enabled = false/)
  assert.match(seg, /lifecycle\.stop\(\)/)
})

test('界面按钮按"是否在采集"切换，而不是总开关', () => {
  const uses = [...client.matchAll(/callAuto\((lv|capturing|s)\.?\w* ?\? 'stop' : 'start'\)/g)].length
  assert.ok(uses >= 3, '所有开始/结束按钮都应基于 capturing，实际 ' + uses + ' 处')
  assert.equal(/callAuto\(lv\.enabled \?/.test(client), false, '不应再用 enabled 判断')
  assert.equal(/callAuto\(s\.enabled \?/.test(client), false, '不应再用 enabled 判断')
})
