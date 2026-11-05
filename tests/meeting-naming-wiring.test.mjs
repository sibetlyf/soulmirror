import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/**
 * 一场会议只留一条记录 + 自动命名（接入宿主的断言）。
 */

const src = readFileSync(new URL('../index.js', import.meta.url), 'utf8')

test('会议目录名走 buildMeetingDirName（软件 · 时间 · 主题）', () => {
  assert.match(src, /buildMeetingDirName\(/, '没有用新的命名函数')
  const at = src.indexOf('const friendly = buildMeetingDirName(')
  assert.ok(at > 0, '找不到命名调用')
  const seg = src.slice(at, at + 400)
  assert.match(seg, /app: appName/, '应带会议软件')
  assert.match(seg, /topic,/, '应带主题')
  assert.match(seg, /at: Date\.now\(\)/, '应带时间')
})

test('dir 使用友好名，并且重名时加序号', () => {
  assert.match(src, /dir: reuse \? prevDir : join\(workspaceRoot, uniqDirName\(friendly\)\)/, '目录赋值应走友好名 + 去重')
  assert.match(src, /function uniqDirName\(/, '缺少目录去重工具')
})

test('同一场会复用上一场目录（同键 + 未结束 + 窗口内）', () => {
  assert.match(src, /shouldReuseDir\(\{/, '缺少复用判定')
  const at = src.indexOf('const reuse = shouldReuseDir(')
  const seg = src.slice(at, at + 420)
  assert.match(seg, /sameKey: !!prevDir/, '应按会议键判断')
  assert.match(seg, /previousEnded: prevEnded/, '已结束就不能复用')
  assert.match(seg, /mergeWindowMs: Number\(cfg\.mergeWindowMinutes/, '合并窗口应可配置')
})

test('判断"上一场是否结束"看 meta.json 的 endedAt', () => {
  const at = src.indexOf('const prevEnded =')
  assert.ok(at > 0, '缺少 prevEnded')
  const seg = src.slice(at, at + 300)
  assert.match(seg, /meta\.json/, '应读 meta.json')
  assert.match(seg, /endedAt/, '应看 endedAt')
})

test('主题从窗口标题里提取（去掉软件名与会议号）', () => {
  assert.match(src, /topicFromTitle\(\{ title: winTitle, app: appName/, '应调用 topicFromTitle')
})

test('safePart 的处理保证目录名在 Windows 上合法', () => {
  // 命名模块内部已替换非法字符；这里确认接入时没有绕过它直接拼字符串
  assert.equal(/join\(workspaceRoot, winTitle/.test(src), false, '不能用原始窗口标题直接当目录名')
})
