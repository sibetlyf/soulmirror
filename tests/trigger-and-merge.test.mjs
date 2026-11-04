import { test } from 'node:test'
import assert from 'node:assert/strict'
import { detectTrigger, hitsName } from '../lib/trigger-rules.js'
import { shouldMerge, joinTexts } from '../lib/segment-merge.js'

// ── 触发判别 ──────────────────────────────────────────────
test('叫到配置里的名字 → 候选句', () => {
  const r = detectTrigger('李亚峰你在吗', { names: ['李亚峰'] })
  assert.equal(r.hit, true)
  assert.equal(r.kind, 'name')
})

test('名字被识别错一个字也能命中（现场：李亚峰 → 杨峰）', () => {
  // 严格匹配（整名/尾部 2 字）仍然有效
  assert.equal(hitsName('亚峰你在吗', ['李亚峰']), '李亚峰')
  // 弱匹配：姓被认错，靠"末字相同 + 有疑问/请求线索"兜住
  for (const text of ['杨峰你能听到吗', '严峰，你在吗', '杨峰，回我一下']) {
    const r = detectTrigger(text, { names: ['李亚峰'] })
    assert.equal(r.hit, true, '应命中：' + text)
    assert.equal(r.kind, 'name')
  }
  // 只有末字相同、但没有在问/在要求 → 不打扰
  assert.equal(detectTrigger('杨峰去开会了', { names: ['李亚峰'] }).hit, false)
})

test('没有问号也能认出疑问语气（口语常态）', () => {
  for (const text of ['你现在听到话', '能听得到吗', '你说怎么样', '这个对不对']) {
    const r = detectTrigger(text)
    assert.equal(r.hit, true, '应命中：' + text)
  }
})

test('祈使请求也算在等回应', () => {
  for (const text of ['回我一下', '你说说看', '帮我查一下评审时间', '记一下明天十点']) {
    assert.equal(detectTrigger(text).hit, true, '应命中：' + text)
  }
})

test('普通闲聊不触发（避免抢话）', () => {
  for (const text of ['我们先过一下上周的进度', '这个方案下周评审', '好，我知道了']) {
    assert.equal(detectTrigger(text).hit, false, '不该命中：' + text)
  }
})

test('通用称呼不需要配置也能命中', () => {
  assert.equal(detectTrigger('助手你在吗').hit, true)
  assert.equal(detectTrigger('DSH 说下看法').hit, true)
})

// ── 碎片合并 ─────────────────────────────────────────────
const t0 = '2026-11-04T08:32:00.000Z'
const t1 = '2026-11-04T08:32:02.000Z'

test('很短的碎片会并到上一行（现场的"你这。""回我一下。"）', () => {
  assert.equal(shouldMerge({ text: '你先加那个。', t: t0 }, { text: '你这。', t: t1 }), true)
  assert.equal(shouldMerge({ text: '嗯你现在听到话。', t: t0 }, { text: '回我一下。', t: t1 }), true)
})

test('上一行没有句末标点 → 认为没说完，继续合并', () => {
  assert.equal(shouldMerge({ text: '我们今天讨论一下上线时间安排', t: t0 }, { text: '然后再说预算', t: t1 }), true)
})

test('间隔太久或不同说话人不合并', () => {
  assert.equal(shouldMerge({ text: '你这。', t: t0 }, { text: '回我一下。', t: '2026-11-04T08:32:20.000Z' }), false)
  assert.equal(shouldMerge({ text: '你这。', t: t0, speaker: 'A' }, { text: '回我一下。', t: t1, speaker: 'B' }), false)
})

test('两个完整长句不合并', () => {
  assert.equal(
    shouldMerge({ text: '前端这边完成了会议字幕模块。', t: t0 }, { text: '剩下的是移动端适配工作。', t: t1 }),
    false,
  )
})

test('拼接时补逗号，不硬贴', () => {
  assert.equal(joinTexts('你先加那个', '你这'), '你先加那个，你这')
  assert.equal(joinTexts('你先加那个。', '你这'), '你先加那个。你这')
  assert.equal(joinTexts('', '只有右边'), '只有右边')
})
