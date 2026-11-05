import { test } from 'node:test'
import assert from 'node:assert/strict'
import { extractActionItems, isDueSoon, cleanLine } from '../lib/action-items.js'

const MINUTES = `# 周会纪要

## 结论
- 前端完成了字幕模块，讨论很充分
- 方案通过了

## 待办
- 张三：下周五前提交评审材料
- 整理本次结论并同步给老板
- [ ] 明天确认预算
1. 李四跟进 CI 稳定性

## 讨论
- 需要补充测试用例
- 接口文档还没更新
`

test('只在待办小节里收条目，讨论里的回顾不算', () => {
  const items = extractActionItems(MINUTES)
  const texts = items.map((i) => i.text)
  assert.ok(texts.some((t) => t.includes('提交评审材料')))
  assert.ok(texts.some((t) => t.includes('同步给老板')))
  assert.ok(texts.some((t) => t.includes('确认预算')))
  assert.ok(texts.some((t) => t.includes('CI 稳定性')))
  // 过去式不进清单
  assert.ok(!texts.some((t) => t.includes('字幕模块')), '已完成的事不该成为待办')
  assert.ok(!texts.some((t) => t.includes('方案通过了')))
})

test('抽取负责人与截止时间', () => {
  const items = extractActionItems(MINUTES)
  const submit = items.find((i) => i.text.includes('提交评审材料'))
  assert.equal(submit.owner, '张三')
  assert.equal(submit.due, '下周五')
  const budget = items.find((i) => i.text.includes('确认预算'))
  assert.equal(budget.due, '明天')
})

test('同一件事不重复入清单', () => {
  const md = '## 待办\n- 整理结论\n- 整理结论\n- 整理结论。\n'
  assert.equal(extractActionItems(md).length, 1)
})

test('去 Markdown 标记与编号', () => {
  assert.equal(cleanLine('- [ ] 明天确认预算'), '明天确认预算')
  assert.equal(cleanLine('2. 整理结论'), '整理结论')
  assert.equal(cleanLine('**加粗** `代码`'), '加粗 代码')
})

test('空纪要返回空数组', () => {
  assert.deepEqual(extractActionItems(''), [])
  assert.deepEqual(extractActionItems('   '), [])
  assert.deepEqual(extractActionItems(null), [])
})

test('数量上限生效', () => {
  const md = '## 待办\n' + Array.from({ length: 30 }, (_, i) => `- 任务${i} 提交`).join('\n')
  assert.ok(extractActionItems(md, { max: 5 }).length <= 5)
})

test('到期判定：今天、明天算临近，下个月不算', () => {
  const now = new Date(2026, 10, 5) // 2026-11-05
  assert.equal(isDueSoon({ due: '今天' }, { now }), true)
  assert.equal(isDueSoon({ due: '明天' }, { now }), true)
  assert.equal(isDueSoon({ due: '11月6日' }, { now }), true)
  assert.equal(isDueSoon({ due: '12月30日' }, { now }), false)
  assert.equal(isDueSoon({ due: '下个月' }, { now }), false)
  assert.equal(isDueSoon({ due: '' }, { now }), false)
  assert.equal(isDueSoon({ due: '2026-11-06' }, { now }), true)
  assert.equal(isDueSoon({ due: '2027-01-01' }, { now }), false)
})
