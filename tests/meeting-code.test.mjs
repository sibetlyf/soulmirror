import { test } from 'node:test'
import assert from 'node:assert/strict'
import { extractMeetingCode, isJunkNumber, looksLikeDate } from '../lib/meeting-code.js'

// 这些用例全部走真实实现（lib/meeting-code.js），
// 不在测试里复制一份正则——否则实现改了测试还是绿的。

test('能从悬浮小窗的文本里读出会议号（983 593 253）', () => {
  const flat = '腾讯会议\tText\t李亚峰的快速会议\tText\t17:14-18:14\tText\t983 593 253\tText\tdot'
  assert.equal(extractMeetingCode(flat).code, '983593253')
})

test('带标签的会议号（腾讯会议）', () => {
  assert.equal(extractMeetingCode('会议号 206 275 219').code, '206275219')
  assert.equal(extractMeetingCode('会议号：206-275-219').code, '206275219')
  assert.equal(extractMeetingCode('Meeting ID: 206 275 219').code, '206275219')
})

test('九位连写也认', () => {
  assert.equal(extractMeetingCode('会议号 206275219').code, '206275219')
})

test('十位号码也认（部分会议号是 10 位）', () => {
  assert.equal(extractMeetingCode('123 456 7890').code, '1234567890')
})

test('移动会议的邀请文案', () => {
  assert.equal(extractMeetingCode('移动会议：379422987').code, '379422987')
})

test('邀请链接里的号', () => {
  assert.equal(extractMeetingCode('https://meeting.tencent.com/share/379422987').code, '379422987')
  assert.equal(extractMeetingCode('https://x.cn/j/206275219').code, '206275219')
})

test('时间不会被误认成会议号', () => {
  assert.equal(extractMeetingCode('17:14-18:14').code, '')
})

test('普通短数字不认', () => {
  assert.equal(extractMeetingCode('共有 4 条记录').code, '')
})

test('UI 自动化 ID 不会被当成会议号（真实踩过的坑）', () => {
  const dump = [
    '0\tGroup\tNXViewRoot\tQApplication.wemeet://page/inmeeting_revision.DialogWidget.MainWidget.NXQtViewRoot:2190091415664\t2098x1011\t1155,544',
    '3\tGroup\t\tQApplication.wemeet://...NXQtWindow:2190262382768\t2098x1011\t1155,544',
  ].join('\n')
  assert.equal(extractMeetingCode(dump).code, '')
  assert.equal(isJunkNumber('21900914156'), true, '11 位 widget id 应判为垃圾')
})

test('邀请文案：优先取「移动会议：」后面的号，不取日期', () => {
  const clip = [
    '李亚峰邀请您参加移动会议',
    '会议主题：羊威发起的快速会议',
    '会议时间：2026-11-02  16:06  (GMT+08:00) 北京、重庆',
    '移动会议：379422987',
    '参会链接：https://yunshixun.125339.com.cn/share/379422987?xlocation=PROD',
  ].join('\n')
  assert.equal(extractMeetingCode(clip).code, '379422987')
})

test('只有日期时间时不该产出会议号', () => {
  assert.equal(extractMeetingCode('会议时间：2026-11-02  16:06  (GMT+08:00)').code, '')
  assert.equal(looksLikeDate('2026110210'), true)
})

test('宁可返回空，也不返回可疑号码', () => {
  assert.equal(extractMeetingCode('2098x1011 1155,544 258 elements').code, '')
  assert.equal(extractMeetingCode('').code, '')
  assert.equal(extractMeetingCode('12345').code, '')
})
