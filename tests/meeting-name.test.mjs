import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildMeetingDirName, safePart, stamp, topicFromTitle, shouldReuseDir } from '../lib/meeting-name.js'

/**
 * 会议目录命名：软件 · 时间 · 主题
 * 以及"一场会只留一条记录"的复用判定。
 */

const AT = new Date('2026-11-05T16:07:00')

test('三段齐全时按「软件 · 时间 · 主题」拼接', () => {
  const n = buildMeetingDirName({ app: '腾讯会议', at: AT, topic: '周会' })
  assert.equal(n, '腾讯会议 · 2026-11-05 16-07 · 周会')
})

test('没有主题时用会议号兜底', () => {
  const n = buildMeetingDirName({ app: '腾讯会议', at: AT, code: '123-456-789' })
  assert.equal(n, '腾讯会议 · 2026-11-05 16-07 · 123-456-789')
})

test('缺软件或缺时间时不留连续分隔符', () => {
  const a = buildMeetingDirName({ at: AT, topic: '周会' })
  assert.equal(a, '2026-11-05 16-07 · 周会')
  const b = buildMeetingDirName({ app: '腾讯会议', topic: '周会' })
  assert.equal(/·\s*·/.test(b), false, '不该出现连续的分隔符：' + b)
})

test('什么都没有时也能给出可读名字', () => {
  const n = buildMeetingDirName({ at: AT })
  assert.match(n, /^会议 · 2026-11-05 16-07$/)
})

test('Windows 非法字符被替换，且不以点或空格结尾', () => {
  const n = buildMeetingDirName({ app: 'Zoom', at: AT, topic: 'A/B:C*D?"E<F>G|H' })
  assert.equal(/[\\/:*?"<>|]/.test(n), false, '不应残留非法字符：' + n)
  assert.equal(/[.\s]$/.test(n), false, '不能以点或空格结尾')
})

test('超长主题被截断，总长受限', () => {
  const n = buildMeetingDirName({ app: '腾讯会议', at: AT, topic: '很'.repeat(200) })
  assert.ok(n.length <= 90, '总长应受限，实际 ' + n.length)
})

test('safePart 处理空白与控制字符', () => {
  assert.equal(safePart('  a  b  '), 'a b')
  assert.equal(safePart('a\u0000b'), 'a-b')
  assert.equal(safePart(''), '')
})

test('stamp 用本地时间且补零', () => {
  assert.equal(stamp(new Date('2026-01-02T03:04:00')), '2026-01-02 03-04')
  assert.equal(stamp('不是时间'), '')
})

test('从窗口标题里去掉软件名与会议号，得到主题', () => {
  assert.equal(topicFromTitle({ title: '腾讯会议 - 123-456-789 周会', app: '腾讯会议', code: '123-456-789' }), '周会')
  assert.equal(topicFromTitle({ title: '腾讯会议 123456789', app: '腾讯会议', code: '123456789' }), '')
  assert.equal(topicFromTitle({ title: '移动会议 - 产品评审', app: '移动会议' }), '产品评审')
})

test('纯会议号的标题不算主题', () => {
  assert.equal(topicFromTitle({ title: '123-456-789' }), '')
  assert.equal(topicFromTitle({ title: '   ' }), '')
})

test('同一场会（同键 + 未结束 + 在窗口内）才复用目录', () => {
  assert.equal(shouldReuseDir({ sameKey: true, sinceLastMs: 5 * 60 * 1000 }), true)
  assert.equal(shouldReuseDir({ sameKey: false, sinceLastMs: 1000 }), false, '不同会议不能复用')
  assert.equal(shouldReuseDir({ sameKey: true, sinceLastMs: 3 * 3600 * 1000 }), false, '隔太久算两场')
  assert.equal(shouldReuseDir({ sameKey: true, sinceLastMs: 1000, previousEnded: true }), false, '上一场已结束就要新目录')
})
