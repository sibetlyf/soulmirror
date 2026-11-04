import { test } from 'node:test'
import assert from 'node:assert/strict'
import { automaticReason, countCharacters, DEFAULT_ADVICE_RULE } from '../lib/advice-trigger.js'

const base = { throughLine: 0, failedThroughLine: -1, lastAttemptAt: 0, lastSuccessAt: 0, running: false }
const now = 1_000_000

test('新增 500 字触发（字数原因）', () => {
  assert.equal(automaticReason(base, { latestLine: 10, newChars: 500, now }), 'characters')
  // lastSuccessAt 要贴近当前时间（真实实现里初始值 = 会议开始时间），
  // 否则时间规则会先命中，测不到字数规则
  const recent = { ...base, lastSuccessAt: now - 1000 }
  assert.equal(automaticReason(recent, { latestLine: 10, newChars: 499, now }), null)
})

test('满 5 分钟且有新增触发（时间原因）', () => {
  const st = { ...base, lastSuccessAt: now - 5 * 60 * 1000 }
  assert.equal(automaticReason(st, { latestLine: 5, newChars: 10, now }), 'time')
  // 没有新增就不触发
  assert.equal(automaticReason({ ...st }, { latestLine: 5, newChars: 0, now }), null)
})

test('正在生成时不重复触发', () => {
  assert.equal(automaticReason({ ...base, running: true }, { latestLine: 10, newChars: 999, now }), null)
})

test('没有新句子不触发', () => {
  assert.equal(automaticReason({ ...base, throughLine: 10 }, { latestLine: 10, newChars: 999, now }), null)
})

test('上次失败过的同一批内容不重试（避免反复烧钱）', () => {
  const st = { ...base, failedThroughLine: 8 }
  assert.equal(automaticReason(st, { latestLine: 8, newChars: 999, now }), null)
  // 有新句子就可以再试
  assert.equal(automaticReason(st, { latestLine: 9, newChars: 999, now }), 'characters')
})

test('冷却期内不触发', () => {
  const st = { ...base, lastAttemptAt: now - 30 * 1000 }
  assert.equal(automaticReason(st, { latestLine: 10, newChars: 999, now }), null)
  const st2 = { ...base, lastAttemptAt: now - 61 * 1000 }
  assert.equal(automaticReason(st2, { latestLine: 10, newChars: 999, now }), 'characters')
})

test('字符统计口径与参考项目一致（去空白，中文一字算一）', () => {
  assert.equal(countCharacters('你好 世界'), 4)
  assert.equal(countCharacters('  \n\t '), 0)
  assert.equal(countCharacters('hello world'), 10)
  assert.equal(countCharacters('会议开始了'), 5)
})

test('规则可被配置覆盖', () => {
  const rule = { characters: 100, intervalMs: 60_000, cooldownMs: 0 }
  assert.equal(automaticReason(base, { latestLine: 1, newChars: 100, now }, rule), 'characters')
  assert.equal(DEFAULT_ADVICE_RULE.characters, 500)
})
