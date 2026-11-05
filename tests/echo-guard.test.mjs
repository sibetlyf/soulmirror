import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isModelCommentary, isSelfEcho, sanitizeCorrection, normalizeForCompare } from '../lib/echo-guard.js'

// 真实事故里混进转写的原文
const REAL_LEAKS = [
  'The input is "Hello, 你在吗？" — no names to fix, no errors. Output as-is.',
  'Fix ASR errors: "工作日期" likely "工作日志". Hmm — "昨天的工作日期" is odd; likely "工作日志".',
  'The current utterance is asking if I\'m here. Reply briefly. No task needed. Confidence high.',
  'Echo again — my own internal reasoning text captured. Don\'t speak.',
]

test('事故里的四条泄漏都能认出来', () => {
  for (const t of REAL_LEAKS) assert.equal(isModelCommentary(t), true, '没认出: ' + t.slice(0, 30))
})

test('人说的话不会被误判', () => {
  const human = [
    '各位好，我们开始今天的周会。',
    '前端这边完成了会议字幕模块，剩下移动端适配。',
    '帮我确认一下下周三的评审会时间有没有冲突。',
    'OK, let us start the meeting.',
    '嗯。',
  ]
  for (const t of human) assert.equal(isModelCommentary(t), false, '误判: ' + t)
})

test('回声判定：包含关系也算（回声常被识别残缺）', () => {
  const said = ['在的，我在听，亚峰你说。']
  assert.equal(isSelfEcho('在的，我在听，亚峰你说。', said), true)
  assert.equal(isSelfEcho('在的我在听', said), true, '残缺回声应命中')
  assert.equal(isSelfEcho('我们开始今天的周会', said), false)
})

test('短句不参与回声判定（避免把"好""嗯"误杀）', () => {
  assert.equal(isSelfEcho('好', ['好']), false)
  assert.equal(isSelfEcho('嗯嗯', ['嗯嗯']), false)
})

test('归一化忽略空白与标点', () => {
  assert.equal(normalizeForCompare('在的，我在听！'), normalizeForCompare('在的 我在听'))
})

test('纠错输出只接受"改好的那句话"', () => {
  // 正常纠错：只改人名
  assert.equal(sanitizeCorrection('亚风你来了吗', '亚峰你来了吗'), '亚峰你来了吗')
  // 思考过程：丢掉
  assert.equal(sanitizeCorrection('亚风你来了吗', 'Fix ASR errors: 亚风 → 亚峰. Hmm — maybe.'), '')
  // 长度失控：丢掉
  assert.equal(sanitizeCorrection('嗯', 'x'.repeat(200)), '')
  // 多行列表：丢掉
  assert.equal(sanitizeCorrection('一句话', '第一行\n第二行\n第三行'), '')
  // 空：返回空
  assert.equal(sanitizeCorrection('原文', ''), '')
})

test('长度上限允许小幅增补（不要把正常纠错也砍掉）', () => {
  const src = '把会议纪要发给我'
  const fixed = '把会议的纪要发给我一下' // 多两个字，属于正常
  assert.equal(sanitizeCorrection(src, fixed), fixed)
})
