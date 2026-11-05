import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizeMeetingCode, validateMeetingCode, classifyJoinFailure, joinFailureResult,
} from '../lib/join-guard.js'

test('会议号归一化：横线/空格/中文标点都去掉', () => {
  assert.equal(normalizeMeetingCode('123-456-789'), '123456789')
  assert.equal(normalizeMeetingCode(' 123 456 789 '), '123456789')
  assert.equal(normalizeMeetingCode('（123）456'), '123456')
  assert.equal(normalizeMeetingCode(null), '')
})

test('合法会议号通过', () => {
  for (const c of ['123456789', '123-456-789', '123456', '12345678901']) {
    const r = validateMeetingCode(c)
    assert.equal(r.ok, true, c + ' 应该通过：' + r.error)
    assert.match(r.code, /^\d{6,11}$/)
  }
})

test('非法会议号直接拒绝，不留到 UI 阶段', () => {
  assert.equal(validateMeetingCode('').ok, false)
  assert.equal(validateMeetingCode('abc').ok, false)
  assert.equal(validateMeetingCode('12345').ok, false, '不足 6 位')
  assert.equal(validateMeetingCode('1234567890123').ok, false, '超过 11 位')
  const allZero = validateMeetingCode('000-000-000')
  assert.equal(allZero.ok, false)
  assert.match(allZero.error, /不能全是 0/)
})

test('格式错误的提示里带原输入与正确写法', () => {
  const r = validateMeetingCode('abc-def')
  assert.match(r.error, /abc-def/)
  assert.match(r.error, /123-456-789/)
})

test('超时优先于其它判断', () => {
  const msg = classifyJoinFailure('点了加入但没进会', { timedOut: true })
  assert.match(msg, /入会超时/)
})

test('客户端提示能翻译成人话', () => {
  assert.match(classifyJoinFailure('会议已结束'), /已经结束/)
  assert.match(classifyJoinFailure('会议不存在'), /会议号不存在/)
  assert.match(classifyJoinFailure('请输入入会密码'), /入会密码/)
  assert.match(classifyJoinFailure('正在等待主持人同意'), /等候室/)
})

test('自有步骤日志也能分类', () => {
  assert.match(classifyJoinFailure('没能打开入会对话框。首页可见控件：…'), /找不到入会对话框/)
  assert.match(classifyJoinFailure('没找到会议号输入框'), /重新标定/)
  assert.match(classifyJoinFailure('点了加入但没进会'), /会议号可能无效/)
  assert.equal(classifyJoinFailure('一切正常'), '')
})

test('失败结果保留已尝试步骤，便于排查', () => {
  const out = joinFailureResult('已点「加入会议」\n点了加入但没进会\n已按 Esc 关闭对话框')
  assert.match(out, /会议号可能无效/)
  assert.match(out, /已尝试/)
  assert.match(out, /已按 Esc 关闭对话框/)
})

test('没有可分类原因时原样返回步骤', () => {
  const out = joinFailureResult('无关内容')
  assert.equal(out, '无关内容')
})
