import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/**
 * 问题提示的接线：后端汇总 → /status.issues → 两个页面顶部横幅。
 *
 * 用户要求："需要及时提示目前转录插件出现的问题，以便排查"。
 */

const src = readFileSync(new URL('../index.js', import.meta.url), 'utf8')
const client = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')

test('/status 返回 issues（后端汇总，不发额外网络请求）', () => {
  assert.match(src, /issues: \(\(\) => \{/, '/status 应带问题清单')
  assert.match(src, /collectIssues\(\{/, '应调用汇总函数')
})

test('汇总输入覆盖关键故障源', () => {
  const at = src.indexOf('issues: (() => {')
  const seg = src.slice(at, at + 1600)
  for (const key of ['preflight', 'capturing', 'transcriptLines', 'asr', 'keyErrors', 'postMeeting', 'captureError', 'silentSec']) {
    assert.ok(seg.includes(key), '汇总应纳入：' + key)
  }
})

test('页面显示问题横幅，且在进度条前面', () => {
  assert.match(client, /function IssueBanner\(props\)/, '应有横幅组件')
  const at = client.indexOf('function MeetingPage(')
  const big = client.slice(at, at + 20000)
  assert.match(big, /h\(IssueBanner, null\)/, '页面应有横幅')
  assert.ok(big.indexOf('h(IssueBanner, null)') < big.indexOf('h(ProgressBar, null)'), '横幅应在进度条之前')
})

test('横幅可展开全部条目并复制排查文本', () => {
  const at = client.indexOf('function IssueBanner(')
  const seg = client.slice(at, at + 3000)
  assert.match(seg, /全部 /, '应能展开看全部')
  assert.match(seg, /复制排查信息/, '应能一键复制')
  assert.match(seg, /navigator\.clipboard/, '复制走剪贴板')
  assert.match(seg, /\.fix/, '每条要带修法')
})

test('横幅只显示 error/warn 为主，不刷屏（第一条 + 可选展开）', () => {
  const at = client.indexOf('function IssueBanner(')
  const seg = client.slice(at, at + 1200)
  assert.match(seg, /var first = list\[0\]/, '默认只显示第一条')
  assert.match(seg, /expanded/, '其余靠展开')
})
