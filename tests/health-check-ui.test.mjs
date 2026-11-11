import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/**
 * 一键体检：不依赖 curl / 终端。
 *
 * 背景：用户直接跑 `curl .../preflight?net=1` 失败（宿主未重启时新路由 404；
 * 有的机器没有 curl）。所以把体检做成页面按钮，结果直接显示。
 */

const client = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
const src = readFileSync(new URL('../index.js', import.meta.url), 'utf8')

test('存在 HealthCheck 组件，且调 /preflight?net=1', () => {
  assert.match(client, /function HealthCheck\(props\)/, '应有体检组件')
  const at = client.indexOf('function HealthCheck(')
  const seg = client.slice(at, at + 1600)
  assert.match(seg, /\/api\/soulmirror\/preflight\?net=1/, '应真的请求体检接口（含连通测试）')
  assert.match(seg, /一键体检/, '按钮文案要能看懂')
})

test('体检结果直接显示在页面上（不用去翻日志）', () => {
  const at = client.indexOf('function HealthCheck(')
  const seg = client.slice(at, at + 2200)
  assert.match(seg, /verdict/, '应显示结论')
  assert.match(seg, /项通过/, '应显示通过项数')
  assert.match(seg, /体检请求失败/, '请求失败也要说人话')
})

test('页面顶部有体检入口（单一 UI，不再有第二套小窗）', () => {
  const at = client.indexOf('function MeetingPage(')
  assert.ok(at > 0, '找不到 MeetingPage')
  // 从 MeetingPage 一路到文件末尾：整棵树里必须有体检入口。
  // 不按固定字节数截断——卡片越加越多，固定窗口会误报（测试脆弱，不是功能坏了）。
  const seg = client.slice(at)
  assert.match(seg, /h\(HealthCheck\)/, '共用工作台诊断页应有体检按钮')
  assert.equal(client.includes('CompactPanel'), false, '小窗 UI 已移除')
})

test('后端 preflight 路由不因查询参数失配（?net=1 也要命中）', () => {
  // sub 取自 url.pathname（不含查询串），所以 ?net=1 不会影响匹配
  assert.match(src, /const sub = url\.pathname\.replace/, 'sub 应取自 pathname')
  const at = src.indexOf("sub === 'preflight'")
  assert.ok(at > 0, '应有 preflight 路由')
  // 连通测试通过 req.url 判断
  assert.match(src, /\[\?&\]net=1/, '应识别 ?net=1')
})
