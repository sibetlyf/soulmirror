import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/**
 * "大页面和侧栏小窗不一致"的回归测试。
 *
 * 事故：大页面把「接入」绑 lv.meeting.app（检测结果）、「抓取」绑 lv.activeApp（手动选择），
 * 两处各说各话；侧栏小窗又是第三套。
 * 现在两侧都问 pickActiveApp()。
 *
 * 这里只做源码级断言（不加载客户端），因为加载客户端需要 React 运行时桩，
 * 在 client-render.test.mjs 里已经有专门的地方；本文件只钉"接线方式"。
 */

const src = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')

test('存在唯一的会议软件来源 pickActiveApp', () => {
  assert.match(src, /function pickActiveApp\(lv\)/, '缺少 pickActiveApp')
  assert.match(src, /var manual = String\(\(lv && lv\.activeApp\)/, '应优先读手动选择')
  assert.match(src, /var detected = String\(\(lv && lv\.meeting && lv\.meeting\.app\)/, '应回退到检测结果')
})

test('大页面「接入」用统一来源，不再直接绑 meeting.app', () => {
  const at = src.indexOf("S.metaLabel }, '接入'")
  assert.ok(at > 0, '找不到接入行')
  const seg = src.slice(at, at + 300)
  assert.match(seg, /cur\.name/, '接入应显示 cur.name')
  assert.match(seg, /cur\.source/, '接入应标出来源（手动/自动）')
  assert.equal(/lv\.meeting && lv\.meeting\.app\) \|\| '—'/.test(seg), false, '接入不该再直接用 meeting.app')
})

test('侧栏小窗也显示同一个来源', () => {
  const at = src.indexOf("已入会' : '未入会'")
  assert.ok(at > 0, '找不到小窗状态行')
  const seg = src.slice(at, at + 400)
  assert.match(seg, /pickActiveApp\(lv\)\.name/, '小窗应显示同一个软件名')
})

test('「抓取」下拉仍绑 activeApp（它就是手动选择本身）', () => {
  assert.match(src, /value: lv\.activeApp \|\| ''/, '抓取下拉应绑手动选择')
})
