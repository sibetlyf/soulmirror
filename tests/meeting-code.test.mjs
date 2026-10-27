import { test } from 'node:test'
import assert from 'node:assert/strict'

// 会议号识别的纯逻辑部分（与 index.js 里保持一致的正则/归一）
const CODE_RE = /(?<!\d)(\d{3})[\s-]?(\d{3})[\s-]?(\d{3,4})(?!\d)/

function pickCode(text) {
  const m = CODE_RE.exec(String(text || ''))
  if (!m) return ''
  return (m[1] + m[2] + m[3]).replace(/\D/g, '')
}

test('能从悬浮小窗的文本里读出会议号（983 593 253）', () => {
  const flat = '腾讯会议\tText\t李亚峰的快速会议\tText\t17:14-18:14\tText\t983 593 253\tText\tdot'
  assert.equal(pickCode(flat), '983593253')
})

test('九位连写也认', () => {
  assert.equal(pickCode('会议号 206275219'), '206275219')
})

test('十位号码也认（部分会议号是 10 位）', () => {
  assert.equal(pickCode('123 456 7890'), '1234567890')
})

test('时间不会被误认成会议号', () => {
  // 17:14-18:14 不应产出 9 位数字
  assert.equal(pickCode('17:14-18:14'), '')
})

test('普通短数字不认', () => {
  assert.equal(pickCode('共有 4 条记录'), '')
})
