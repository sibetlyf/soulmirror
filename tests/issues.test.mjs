import { test } from 'node:test'
import assert from 'node:assert/strict'
import { issue, collectIssues, topIssue, describeIssues } from '../lib/issues.js'

/**
 * 问题清单：把散落各处的失败汇总成"第一条就是最该处理的"。
 *
 * 动机：用户要求"及时提示目前转录插件出现的问题，以便排查"。
 * 之前失败信息散在 session.lastError / asr.failed / keyErrors / postMeeting.error 里，
 * 用户要挨个看，远程协助时更是无从下手。
 */

test('单条问题：形状合法，未知级别降为 info', () => {
  const a = issue('x', 'error', '标题', { detail: 'd', fix: 'f' })
  assert.equal(a.level, 'error')
  assert.equal(a.detail, 'd')
  assert.equal(issue('y', 'weird', 't').level, 'info')
})

test('采集了却零转写：立刻报 error 并给排查方向', () => {
  const list = collectIssues({ capturing: true, transcriptLines: 0, lastLineAgeSec: 90 })
  const it = list.find((x) => x.id === 'no-transcript')
  assert.ok(it, '应报"没有转写内容"')
  assert.equal(it.level, 'error')
  assert.match(it.fix, /端点|静音|密钥|网络/)
})

test('有转写内容就不报这条', () => {
  const list = collectIssues({ capturing: true, transcriptLines: 12, lastLineAgeSec: 3 })
  assert.equal(list.some((x) => x.id === 'no-transcript'), false)
})

test('ASR 断线 / 未连接：级别区分（断线 error，未连上 warn）', () => {
  const down = collectIssues({ capturing: true, asr: { failed: true, error: '401' } })
  assert.equal(down.find((x) => x.id === 'asr').level, 'error')

  const offline = collectIssues({ capturing: true, asr: { online: false } })
  assert.equal(offline.find((x) => x.id === 'asr-offline').level, 'warn')
})

test('密钥读取失败：逐个槽位报出来（不静默）', () => {
  const list = collectIssues({ keyErrors: { asr: '权限不足', tts: '' } })
  const it = list.find((x) => x.id === 'key-asr')
  assert.ok(it)
  assert.match(it.detail, /权限不足/)
  assert.equal(list.some((x) => x.id === 'key-tts'), false, '空错误不该报')
})

test('会后整理失败 / 采集错误 / 长静音 都能进清单', () => {
  const list = collectIssues({
    postMeeting: { phase: 'error', error: '纪要模型调用失败' },
    captureError: 'spawn mbridge.exe ENOENT',
    capturing: true,
    silentSec: 45,
    captureDevice: 'CABLE Input',
  })
  assert.ok(list.find((x) => x.id === 'post-meeting'))
  assert.ok(list.find((x) => x.id === 'capture'))
  const silent = list.find((x) => x.id === 'silent')
  assert.ok(silent)
  assert.match(silent.detail, /CABLE Input/)
})

test('排序：error 在前，warn 次之，info 最后', () => {
  const list = collectIssues({
    preflight: { ok: true, verdict: '链路就绪，但会议窗口：当前没检测到会议窗口' },
    capturing: true,
    asr: { online: false },
    captureError: 'x',
  })
  assert.equal(list[0].level, 'error')
  assert.equal(list[list.length - 1].level, 'info')
})

test('preflight 致命失败会占据第一条，并带上修法', () => {
  const list = collectIssues({
    preflight: { ok: false, blocked: { label: '音频桥接 mbridge.exe', detail: '文件不存在', fix: '重装插件' } },
    capturing: true,
    asr: { online: false },
  })
  const top = topIssue(list)
  assert.equal(top.id, 'preflight')
  assert.match(top.title, /音频桥接/)
  assert.match(top.fix, /重装/)
})

test('topIssue 优先 error，再 warn；空清单返回 null', () => {
  assert.equal(topIssue([]), null)
  // 注意：要给"已有转写"，否则会同时命中 no-transcript（那也是 error，符合预期）
  const list = collectIssues({ capturing: true, transcriptLines: 8, lastLineAgeSec: 5, asr: { online: false } })
  assert.equal(topIssue(list).level, 'warn')
})

test('describeIssues 输出可直接粘贴的排查文本（含环境）', () => {
  const list = collectIssues({ capturing: true, transcriptLines: 0, lastLineAgeSec: 120 })
  const text = describeIssues(list, { 版本: '1.0.0', 平台: 'win32', 目录: 'C:/m/1' })
  assert.match(text, /版本: 1\.0\.0/)
  assert.match(text, /平台: win32/)
  assert.match(text, /1\. \[error\]/)
  assert.match(text, /→/)
})

test('没有问题时不编造，明确说"没检测到问题"', () => {
  assert.match(describeIssues([], { 版本: '1.0.0' }), /当前没有检测到问题/)
})
