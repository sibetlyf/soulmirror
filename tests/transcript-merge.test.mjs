import { test } from 'node:test'
import assert from 'node:assert/strict'
import { similarText, normalizeText } from '../lib/dedupe.js'

// 现场原文（用户截图里的两行）
const SHORT = 'Hello可以听'
const FULL = 'Hello可以听到吗？'
const PART = '我们现在来测试一下A的模式如'
const FINAL = '我们现在来测试一下A的模式，如果你听到的话就回复一下我。'

test('截断版与完整版认定为同一句', () => {
  assert.equal(similarText(SHORT, FULL), true)
  assert.equal(similarText(FULL, SHORT), true)
})

test('中间结果被截断且带错字也能认出来', () => {
  // 截图里的第二组：中间结果把逗号插错了位置
  assert.equal(similarText(PART, FINAL), true)
})

test('两句话不同就不合并', () => {
  assert.equal(similarText('今天讨论上线时间', '明天讨论预算'), false)
  assert.equal(similarText('喂，hello。', 'Hello可以听到吗？'), false)
})

test('太短的碎片不参与合并（避免把"好"吞掉）', () => {
  assert.equal(similarText('好', '好的我知道'), false)
  assert.equal(similarText('嗯', '嗯嗯'), false)
})

test('规范化忽略标点空白大小写', () => {
  assert.equal(normalizeText('Hello，可以 听到吗？'), 'hello可以听到吗')
  assert.equal(similarText('Hello，可以 听到吗', 'hello可以听到吗？'), true)
})
