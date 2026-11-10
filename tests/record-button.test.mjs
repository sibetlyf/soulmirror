import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fixForCaptureError } from '../lib/issues.js'

/**
 * 两件事：
 *   ① 点「开始录音」必须立刻开录，且没起来时要有即时反馈（反馈"点了没反应"）
 *   ② 错误文案要按原因给建议（缺密钥时不该叫人去查设备）
 */

const src = readFileSync(new URL('../index.js', import.meta.url), 'utf8')
const client = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')

test('后端有 action=record：立刻开始采集，而不只是 arm', () => {
  const at = src.indexOf("if (action === 'record') {")
  assert.ok(at > 0, '应有 record 动作')
  const seg = src.slice(at, at + 900)
  assert.match(seg, /session\.startCapture\(/, '必须真的启动采集')
  assert.match(seg, /armed = true/, '应同时 arm')
  assert.match(seg, /cfg\.enabled = true/, '应打开总开关')
  assert.match(seg, /capturing: !!session\.capturing/, '响应里要回采集状态，前端才能判断成功')
  assert.match(seg, /session\.lastError = ''/, '开录前清掉上次错误，避免刚开就顶着旧错误')
})

test('前端「开始录音」走 record，并把结果反馈到界面', () => {
  const at = client.indexOf('function callAuto(')
  assert.ok(at > 0)
  const seg = client.slice(at, at + 1800)
  assert.match(seg, /action === 'start' \? 'record' : action/, 'start 应映射到 record')
  assert.match(seg, /captureNotice/, '采集没起来要有可见提示')
  assert.match(seg, /live\.set\(\{ enabled: true, armed: true \}\)/, '点击后应立即反映，不等轮询')
})

test('IssueBanner 会把即时反馈合并进问题列表', () => {
  const at = client.indexOf('function IssueBanner(')
  const rest = client.slice(at + 10)
  const next = rest.search(/\n {4}function [A-Z]/)
  const body = client.slice(at, next > 0 ? at + 10 + next : client.length)
  assert.match(body, /lv\.captureNotice/, '横幅应显示 captureNotice')
})

test('错误文案按原因分类：密钥问题不再提示查设备', () => {
  const key = fixForCaptureError('缺少密钥：环境变量 DASHSCOPE_API_KEY 未设置')
  assert.match(key, /填自己的百炼 Key|DASHSCOPE_API_KEY/)
  assert.equal(/设备静音|端点选错/.test(key), false, '密钥问题不该让人去查设备')

  const bridge = fixForCaptureError('spawn mbridge.exe ENOENT')
  assert.match(bridge, /桥接|重装|soul_setup/)

  const device = fixForCaptureError('采集设备被占用')
  assert.match(device, /设备|端点/)
})

test('preflight 的"上次采集错误"也用同一套分类', () => {
  const pre = readFileSync(new URL('../lib/preflight.js', import.meta.url), 'utf8')
  // 分类函数定义在 preflight 内部，供 last-error 使用
  assert.match(pre, /function classifyCaptureFix\(/, 'preflight 应有分类函数')
  assert.match(pre, /fix: classifyCaptureFix\(/, 'last-error 的 fix 应调用它')
  assert.equal(/常见是设备静音、端点选错、桥接被杀软拦/.test(pre), false, '旧的笼统文案应移除')
  // 密钥类错误要被识别成"填 Key"，而不是设备问题
  const at = pre.indexOf('function classifyCaptureFix(')
  const seg = pre.slice(at, at + 600)
  assert.match(seg, /DASHSCOPE|密钥/, '应识别密钥类错误')
  assert.match(seg, /mbridge|桥接/, '应识别桥接类错误')
})
