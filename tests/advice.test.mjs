import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildAdvicePrompt, extractAdviceJson, parseAdvice, shouldReplaceAdvice, ADVICE_LIMITS,
} from '../lib/advice.js'

const lines = [
  { speaker: '李亚峰', text: '这周先把字幕模块收尾。' },
  { speaker: 'lyf', text: '移动端适配还差两天。' },
]

test('提示词带上会议目标与最近讨论', () => {
  const msgs = buildAdvicePrompt({ goal: '确定上线时间', invite: '周会', lines })
  assert.equal(msgs.length, 2)
  assert.match(msgs[0].content, /只输出 JSON/)
  assert.match(msgs[1].content, /会议目标：确定上线时间/)
  assert.match(msgs[1].content, /李亚峰: 这周先把字幕模块收尾。/)
})

test('没有转写时明确写"（还没有转写）"，不假装有内容', () => {
  const msgs = buildAdvicePrompt({ lines: [] })
  assert.match(msgs[1].content, /还没有转写/)
})

test('能解析正常输出', () => {
  const a = parseAdvice(JSON.stringify({
    questions: [{ q: '上线时间怎么定？', why: '目标还没落到日期' }],
    replies: [{ q: '什么时候能上线？', short: '下周三', smooth: '如果顺利，下周三可以先灰度' }],
  }))
  assert.equal(a.questions.length, 1)
  assert.equal(a.replies[0].short, '下周三')
  assert.equal(a.empty, false)
})

test('模型输出带代码围栏与废话也能解析', () => {
  const raw = '好的：\n```json\n{"questions":[{"q":"风险是什么？","why":"还没提风险"}],"replies":[]}\n```\n以上'
  const a = parseAdvice(raw)
  assert.equal(a.questions.length, 1)
})

test('超量条目被截断到上限', () => {
  const many = {
    questions: Array.from({ length: 9 }, (_, i) => ({ q: 'Q' + i, why: 'W' + i })),
    replies: Array.from({ length: 9 }, (_, i) => ({ q: 'R' + i, short: 'S' + i, smooth: 'M' + i })),
  }
  const a = parseAdvice(many)
  assert.equal(a.questions.length, ADVICE_LIMITS.maxQuestions)
  assert.equal(a.replies.length, ADVICE_LIMITS.maxReplies)
})

test('超长文本被裁剪，不会把界面撑坏', () => {
  const a = parseAdvice({ questions: [{ q: '长'.repeat(300), why: '为'.repeat(300) }], replies: [] })
  assert.ok(a.questions[0].q.length <= ADVICE_LIMITS.maxQuestionChars)
  assert.ok(a.questions[0].why.length <= ADVICE_LIMITS.maxWhyChars)
})

test('缺字段/空条目的条目被丢掉，而不是整份失败', () => {
  const a = parseAdvice({ questions: [{ q: '' }, { why: '没有 q' }, { q: '有效的问题' }], replies: [{ q: 'R' }] })
  assert.equal(a.questions.length, 1)
  assert.equal(a.replies.length, 0, 'short 与 smooth 都空的回复要丢掉')
})

test('非 JSON 输出抛错（上层据此显示错误）', () => {
  assert.throws(() => extractAdviceJson('我觉得你们应该讨论一下'), /没有返回 JSON/)
  assert.throws(() => extractAdviceJson(''), /空内容/)
})

test('全空的建议不应覆盖已有建议', () => {
  const empty = parseAdvice({ questions: [], replies: [] })
  assert.equal(empty.empty, true)
  assert.equal(shouldReplaceAdvice(empty), false)
  assert.equal(shouldReplaceAdvice(parseAdvice({ questions: [{ q: '有内容' }], replies: [] })), true)
})
