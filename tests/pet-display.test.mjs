import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  formatTranscriptBubble, formatAdviceBubble, pickBubble,
  shouldPushTranscript, bumpOpenRequest, shouldOpenPanel, BUBBLE_LIMITS,
} from '../lib/pet-display.js'

test('转写气泡带说话人，超长保留尾部', () => {
  assert.equal(formatTranscriptBubble({ speaker: '张三', text: '我们先过一下进度' }), '张三：我们先过一下进度')
  const long = formatTranscriptBubble({ text: '一'.repeat(80) })
  assert.ok(Array.from(long).length <= BUBBLE_LIMITS.transcriptChars + 1)
  assert.ok(long.startsWith('…'), '超长时应保留尾部，前面用省略号')
})

test('空内容不产出气泡', () => {
  assert.equal(formatTranscriptBubble({ text: '   ' }), '')
  assert.equal(formatTranscriptBubble(null), '')
})

test('建议气泡只取第一条问题', () => {
  const b = formatAdviceBubble({ questions: [{ question: '预算怎么算？' }, { question: '谁负责？' }] })
  assert.equal(b, '预算怎么算？')
  assert.equal(formatAdviceBubble({}), '')
  assert.equal(formatAdviceBubble({ questions: [] }), '')
})

test('建议过长会截断', () => {
  const b = formatAdviceBubble({ questions: [{ question: '问'.repeat(200) }] })
  assert.ok(Array.from(b).length <= BUBBLE_LIMITS.adviceChars)
  assert.ok(b.endsWith('…'))
})

test('优先级：发言 > 建议 > 转写', () => {
  assert.deepEqual(pickBubble({ speaking: '我在', advice: 'A', transcript: 'T' }), { text: '我在', kind: 'speaking' })
  assert.deepEqual(pickBubble({ advice: 'A', transcript: 'T' }), { text: 'A', kind: 'advice' })
  assert.deepEqual(pickBubble({ transcript: 'T' }), { text: 'T', kind: 'transcript' })
  assert.deepEqual(pickBubble({}), { text: '', kind: '' })
})

test('转写节流：太短、没变化、间隔太近都不推', () => {
  const now = Date.parse('2026-11-05T05:00:00Z')
  assert.equal(shouldPushTranscript(null, '这是一句话'), true)
  assert.equal(shouldPushTranscript(null, '嗯'), false, '太短的碎片不推')
  assert.equal(shouldPushTranscript({ text: '这是一句话', at: now - 1000 }, '这是一句话', { now }), false, '没变化不推')
  assert.equal(shouldPushTranscript({ text: '旧的那句话', at: now - 1000 }, '新的那句话', { now }), false, '间隔太近不推')
  assert.equal(shouldPushTranscript({ text: '旧的那句话', at: now - 9000 }, '新的那句话', { now }), true)
})

test('打开面板：计数递增才算请求', () => {
  const a = bumpOpenRequest({ count: 0 })
  assert.equal(a.count, 1)
  assert.equal(bumpOpenRequest(a).count, 2)
  assert.equal(shouldOpenPanel(0, 1), true)
  assert.equal(shouldOpenPanel(1, 1), false)
  assert.equal(shouldOpenPanel(2, 1), false)
})
