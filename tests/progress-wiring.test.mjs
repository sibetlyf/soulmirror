import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/**
 * 进度展示接线（离线转写 + 纪要）。
 *
 * 用户要求：离线转写要能看到进度，纪要也要能看到进度，
 * 否则不知道进行到哪个阶段。
 */

const src = readFileSync(new URL('../index.js', import.meta.url), 'utf8')
const client = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')

test('离线转写按阶段上报（检查录音 → 上传 → 云端识别 → 落盘）', () => {
  const at = src.indexOf('const offProgress = createProgress({ pipeline: ')
  assert.ok(at > 0, '应创建离线进度对象')
  const seg = src.slice(at, at + 9000)
  assert.match(seg, /stage\('prepare'/, '应有检查录音阶段')
  assert.match(seg, /stage\('upload'/, '应有上传阶段')
  assert.match(seg, /stage\('recognize'/, '应有云端识别阶段')
  assert.match(seg, /setInterval\(/, '识别期间应持续刷新已等秒数')
  assert.match(seg, /clearInterval\(recTimer\)/, '结束后必须清掉定时器')
})

test('纪要按阶段上报（准备 → 起任务 → 写纪要 → 读回）', () => {
  const at = src.indexOf('const mnProgress = createProgress({ pipeline: ')
  assert.ok(at > 0, '应创建纪要进度对象')
  const seg = src.slice(at, at + 3000)
  assert.match(seg, /stage\('prepare'/, '应有准备阶段')
  assert.match(seg, /stage\('spawn'/, '应有启动后台任务阶段')
  assert.match(seg, /stage\('generate'/, '应有模型写纪要阶段')
  assert.match(seg, /stage\('read'/, '应有读回阶段')
  assert.match(seg, /clearInterval\(mnTimer\)/, '结束后必须清掉定时器')
})

test('进度进入 /status 的 postMeeting（界面才能拿到）', () => {
  const at = src.indexOf('progressText: describeProgress(snap)')
  assert.ok(at > 0, '应把进度文本一起写进状态')
  assert.match(src, /setPostMeeting\(\{ phase: 'offline', error: '', dir, \.\.\.snap/, '离线阶段应合并进度快照')
  assert.match(src, /setPostMeeting\(\{ phase: 'minutes', \.\.\.snap/, '纪要阶段应合并进度快照')
})

test('前端显示服务端阶段与明细，仅显示真实测量进度', async () => {
  const { check } = await import('./ui-shared-contract.mjs')
  check('progress')
  assert.match(client, /s\.stateLabel/)
  assert.match(client, /s\.detail/)
})

test('完成/失败时不残留伪进度（避免完成了还显示80%）', async () => {
  const { buildViewModel } = await import('../lib/view-model.js')
  for (const phase of ['done', 'error']) {
    const v = buildViewModel({ journal: { runs: { x: { run: 'x', phase, step: 'offline', percent: 80, steps: { offline: { state: phase } } } } } })
    assert.equal(v.steps[0].progress, null)
  }
})
