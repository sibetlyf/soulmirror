import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isJoinUrl, isBareCode, extractJoinUrl, looksLikeDmLink, joinedAfterOpening } from '../lib/join-url.js'

test('isJoinUrl：认会议链接与 wemeet 协议', () => {
  assert.equal(isJoinUrl('https://meeting.tencent.com/dm/AbCdEf123'), true)
  assert.equal(isJoinUrl('https://meeting.tencent.com/dm/x?rs=1'), true)
  assert.equal(isJoinUrl('wemeet://page/home'), true)
  assert.equal(isJoinUrl('https://example.com/join'), false)
  assert.equal(isJoinUrl('随便一句话'), false)
  assert.equal(isJoinUrl(''), false)
})

test('isBareCode：9~12 位，允许横线与空格', () => {
  assert.equal(isBareCode('206275219'), true)
  assert.equal(isBareCode('206-275-219'), true)
  assert.equal(isBareCode('206 275 219'), true)
  assert.equal(isBareCode('12345'), false)
  assert.equal(isBareCode('https://meeting.tencent.com/dm/x'), false)
})

test('extractJoinUrl：从整段邀请文案里抠出链接', () => {
  const text = '李亚峰 邀请你加入腾讯会议\n点击链接入会：https://meeting.tencent.com/dm/AbC123 ，或输入会议号 206-275-219'
  assert.equal(extractJoinUrl(text), 'https://meeting.tencent.com/dm/AbC123')
  assert.equal(extractJoinUrl('会议号 206-275-219'), '')
  assert.equal(extractJoinUrl('https://evil.com/x'), '')
})

test('looksLikeDmLink：识别 dm 短链', () => {
  assert.equal(looksLikeDmLink('https://meeting.tencent.com/dm/abc'), true)
  assert.equal(looksLikeDmLink('https://meeting.tencent.com/w/abc'), false)
})

test('joinedAfterOpening：标题不再是软件名就算入会', () => {
  const app = { name: '腾讯会议', title: '腾讯会议', proc: 'wemeetapp' }
  assert.equal(joinedAfterOpening([{ proc: 'wemeetapp', title: '腾讯会议', cls: 'BaseDialog' }], app), false)
  assert.equal(joinedAfterOpening([{ proc: 'wemeetapp', title: '临时沟通', cls: 'BaseDialog' }], app), true)
  assert.equal(joinedAfterOpening([{ proc: 'wemeetapp', title: 'x', cls: 'ParticipantWnd' }], app), true)
  assert.equal(joinedAfterOpening([{ proc: 'chrome', title: '腾讯会议官网' }], app), false)
})

test('joinedAfterOpening：多进程变体也能识别', () => {
  const app = { name: '腾讯会议', proc: 'wemeetapp' }
  assert.equal(joinedAfterOpening([{ proc: 'WeMeet', title: '周会' }], app), false)
  const app2 = { name: '腾讯会议', proc: 'WeMeet' }
  assert.equal(joinedAfterOpening([{ proc: 'wemeetapp', title: '周会' }], app2), false)
})

test('首页与内部窗口不能判成已入会（真实事故：链接"成功"但没进会）', () => {
  const app = { name: '腾讯会议', title: '腾讯会议', proc: 'wemeetapp' }
  const home = [
    { proc: 'wemeetapp', title: '腾讯会议', cls: 'BaseDialog' },
    { proc: 'wemeetapp', title: 'wemeetapp', cls: 'BaseDialog' },
  ]
  assert.equal(joinedAfterOpening(home, app), false, '首页 + wemeetapp 内部窗不是会中')
  assert.equal(joinedAfterOpening([{ proc: 'wemeetapp', title: '加入会议', cls: 'join_meeting::JoinMeetingDialog' }], app), false, '入会对话框不是会中')
  assert.equal(joinedAfterOpening([{ proc: 'wemeetapp', title: '预定会议', cls: 'BaseDialog' }], app), false, '预定会议不是会中')
  // 真正的会中信号要认
  assert.equal(joinedAfterOpening([{ proc: 'wemeetapp', title: '临时会议', cls: 'BaseDialog' }], app), true, '标题变成会议主题 = 会中')
  assert.equal(joinedAfterOpening([{ proc: 'wemeetapp', title: '', cls: 'VideoMainWindow' }], app), true, '强证据类名 = 会中')
})
