import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildReplyPrompt, extractReplyJson, parseReply, shouldStartTask, REPLY_LIMITS,
} from '../lib/reply-candidates.js'

test('提示词强调"说出口的短句"，并带上称谓', () => {
  const msgs = buildReplyPrompt({ line: 'DSH 你觉得呢', names: ['DSH', '助手'] })
  assert.match(msgs[0].content, /说出/)
  assert.match(msgs[0].content, /DSH、助手/)
  assert.match(msgs[1].content, /当前这句：DSH 你觉得呢/)
})

test('候选词被裁剪、去重、限量', () => {
  const r = parseReply({
    candidates: ['好的。', '好的', '这个我确认一下', '我看下', '第四条'],
    needsTask: false,
    task: '',
  })
  assert.ok(r.candidates.length <= REPLY_LIMITS.maxCandidates)
  assert.equal(r.candidates[0], '好的。')
  assert.ok(!r.candidates.some((c) => c === '好的'), '去标点后重复的应被去掉')
})

test('超长候选被截断（口播不能太长）', () => {
  const r = parseReply({ candidates: ['长'.repeat(200)] })
  assert.ok(r.candidates[0].length <= REPLY_LIMITS.maxChars)
})

test('needsTask 必须同时有 task，否则不算需要执行', () => {
  assert.equal(parseReply({ candidates: ['a'], needsTask: true, task: '去查一下' }).needsTask, true)
  assert.equal(parseReply({ candidates: ['a'], needsTask: true, task: '' }).needsTask, false)
})

test('非 JSON 抛错（上层显示原因）', () => {
  assert.throws(() => extractReplyJson('我觉得可以'), /没有返回 JSON/)
  assert.throws(() => extractReplyJson(''), /空内容/)
})

test('带代码围栏也能解析', () => {
  const raw = '结果：\n```json\n{"candidates":["我在"],"needsTask":false,"task":""}\n```'
  assert.deepEqual(parseReply(raw).candidates, ['我在'])
})

test('该启动 DSH 任务：模型判断需要 / 被点名 / 被交代事情', () => {
  assert.equal(shouldStartTask({ needsTask: true }).start, true)
  assert.equal(shouldStartTask({ line: 'DSH，帮我记一下', names: ['DSH'] }).start, true)
  assert.equal(shouldStartTask({ line: '帮我查一下评审时间' }).start, true)
})

test('不该启动任务：普通闲聊', () => {
  const r = shouldStartTask({ line: '今天我们讨论一下上线时间', names: ['DSH'] })
  assert.equal(r.start, false)
  assert.equal(r.why, '')
})
