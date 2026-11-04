import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildSnapshot, renderLine } from '../lib/context-snapshot.js'

const lines = [
  { t: '2026-11-04T07:36:00.000Z', speaker: '李亚峰', text: '喂，hello。' },
  { t: '2026-11-04T07:36:30.000Z', speaker: 'lyf', text: 'Hello 可以听到吗？' },
  { t: '2026-11-04T07:37:00.000Z', speaker: 'lyf', text: '我们现在来测试一下 Agent 模式。' },
]

test('快照包含时间、说话人与原话', () => {
  const s = buildSnapshot(lines)
  assert.match(s, /会议转写片段/)
  assert.match(s, /李亚峰: 喂，hello。/)
  assert.match(s, /lyf: 我们现在来测试一下 Agent 模式。/)
})

test('快照明确标注"不是指令"，避免模型把会议内容当任务', () => {
  const s = buildSnapshot(lines)
  assert.match(s, /不是对你下的指令/)
})

test('只取最近 N 句，并说明省略了多少', () => {
  const s = buildSnapshot(lines, { maxLines: 2 })
  assert.ok(!s.includes('喂，hello。'), '最早那句应被省略')
  assert.match(s, /更早有 1 句未包含/)
})

test('超过字符预算时截断（保留最新的）', () => {
  const many = Array.from({ length: 50 }, (_, i) => ({
    t: '2026-11-04T07:36:00.000Z',
    speaker: 'A',
    text: '第' + i + '句话' + '内容'.repeat(20),
  }))
  const s = buildSnapshot(many, { maxChars: 600 })
  assert.ok(s.length <= 700, '总长度要受控，实际 ' + s.length)
  assert.match(s, /第49句/, '最新的必须在')
  assert.ok(!s.includes('第0句'), '最早的应被裁掉')
})

test('空转写返回空串（调用方据此跳过发送）', () => {
  assert.equal(buildSnapshot([]), '')
  assert.equal(buildSnapshot([{ text: '   ' }]), '')
  assert.equal(buildSnapshot(null), '')
})

test('会邀与目标会带上，便于模型理解上下文', () => {
  const s = buildSnapshot(lines, { invite: '周会', goal: '确定上线时间' })
  assert.match(s, /会邀：周会/)
  assert.match(s, /会议目标：确定上线时间/)
})

test('renderLine 去掉时间时只保留说话人与内容', () => {
  assert.equal(renderLine({ t: '', speaker: 'A', text: '你好' }), 'A: 你好')
  assert.equal(renderLine({ t: '2026-11-04T07:36:00.000Z', text: '你好' }), '[07:36] 你好')
})
