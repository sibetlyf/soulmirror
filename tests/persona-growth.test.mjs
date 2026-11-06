import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  emptyProfile, mergeProfile, renderProfile, similarText, normKey,
  DEFAULT_LIMITS, DEFAULT_STATE_TTL_MS,
} from '../lib/persona-growth.js'

/**
 * 人格成长：从"每场会追加几行字"升级为"带置信度与冲突处理的画像"。
 *
 * 老问题：只有完全一样的文本才去重、没有置信度、没有冲突处理、
 * state 永不过期、拼接超长就砍最旧（重要的可能刚好被砍）。
 */

const item = (section, key, value, confidence = 0.6) => ({ section, key, value, confidence })
const NOW = Date.parse('2026-11-06T10:00:00Z')

test('空画像五层齐全', () => {
  const p = emptyProfile()
  for (const s of ['identity', 'style', 'stance', 'facts', 'state']) {
    assert.deepEqual(p.sections[s], [], '缺少层：' + s)
  }
})

test('新条目直接入库，带首次出现时间与计数', () => {
  const r = mergeProfile(emptyProfile(), [item('stance', '节奏偏好', '这个项目要慢一点，先验证再上线')], { now: NOW })
  const list = r.profile.sections.stance
  assert.equal(list.length, 1)
  assert.equal(list[0].seen, 1)
  assert.ok(list[0].firstAt)
  assert.equal(r.stats.added, 1)
})

test('同 key 同义 → 强化而不是重复堆积', () => {
  let p = emptyProfile()
  p = mergeProfile(p, [item('stance', '节奏偏好', '这个项目要慢一点，先验证再上线')], { now: NOW }).profile
  const r = mergeProfile(p, [item('stance', '节奏偏好', '这个项目要慢一点，先验证再上线')], { now: NOW + 1000 })
  assert.equal(r.profile.sections.stance.length, 1, '不该变成两条')
  assert.equal(r.profile.sections.stance[0].seen, 2)
  assert.ok(r.profile.sections.stance[0].confidence > 0.6, '置信度应上抬')
  assert.equal(r.stats.reinforced, 1)
})

test('同 key 冲突 → 取代，并把旧值压进 history', () => {
  let p = emptyProfile()
  p = mergeProfile(p, [item('stance', '上线节奏', '这个项目要慢一点')], { now: NOW }).profile
  const r = mergeProfile(p, [item('stance', '上线节奏', '这个项目要尽快上线，先跑起来')], { now: NOW + 1000 })
  const it0 = r.profile.sections.stance[0]
  assert.equal(r.profile.sections.stance.length, 1)
  assert.match(it0.value, /尽快上线/)
  assert.equal(it0.history.length, 1, '旧值应保留在 history')
  assert.match(it0.history[0].value, /慢一点/)
  assert.equal(r.stats.superseded, 1)
})

test('模型换了 key 但说的是同一件事 → 仍算强化（值相似度兜底）', () => {
  let p = emptyProfile()
  p = mergeProfile(p, [item('facts', '负责项目', '负责 SoulMirror 会议助手插件')], { now: NOW }).profile
  const r = mergeProfile(p, [item('facts', '项目归属', '负责 SoulMirror 会议助手插件的开发')], { now: NOW + 1000 })
  assert.equal(r.profile.sections.facts.length, 1, '近义句不应并存')
  assert.equal(r.profile.sections.facts[0].seen, 2)
})

test('state 有 TTL：过期条目自动淡出，facts 不受影响', () => {
  let p = emptyProfile()
  p = mergeProfile(p, [
    item('state', '项目进展', '知识库迁移进行到一半'),
    item('facts', '常用工具', '习惯用 DSH 管理会议'),
  ], { now: NOW }).profile

  const later = NOW + DEFAULT_STATE_TTL_MS + 86400000
  const r = mergeProfile(p, [], { now: later })
  assert.equal(r.profile.sections.state.length, 0, '过期的 state 应被清掉')
  assert.equal(r.profile.sections.facts.length, 1, 'facts 不该被清')
  assert.ok(r.stats.expired >= 1)
})

test('每层有配额，且按"置信度 × 新近度"保留而不是砍最旧', () => {
  let p = emptyProfile()
  const many = []
  for (let i = 0; i < DEFAULT_LIMITS.facts + 10; i++) {
    many.push(item('facts', '事实' + i, '第 ' + i + ' 条事实'))
  }
  let r = mergeProfile(p, many, { now: NOW })
  assert.equal(r.profile.sections.facts.length, DEFAULT_LIMITS.facts, '应被裁到配额')
})

test('高置信度条目在裁剪中更容易留下', () => {
  const items = []
  for (let i = 0; i < DEFAULT_LIMITS.facts + 5; i++) item
  for (let i = 0; i < DEFAULT_LIMITS.facts + 5; i++) {
    items.push(item('facts', 'k' + i, '普通事实 ' + i, 0.3))
  }
  items.push(item('facts', '关键事实', '她绝不在周会上承诺交付日期', 0.95))
  const r = mergeProfile(emptyProfile(), items, { now: NOW })
  const values = r.profile.sections.facts.map((x) => x.value)
  assert.ok(values.some((v) => /绝不在周会上承诺/.test(v)), '高置信度的那条必须留下')
})

test('渲染顺序：身份与口吻在前，状态在后', () => {
  const r = mergeProfile(emptyProfile(), [
    item('state', '近期', '本周在忙知识库迁移'),
    item('identity', '角色', '产品负责人，带 5 人小组'),
    item('style', '语气', '说话直接，少用敬语'),
  ], { now: NOW })
  const text = renderProfile(r.profile)
  assert.ok(text.indexOf('身份') < text.indexOf('说话方式'), '身份应在说话方式之前')
  assert.ok(text.indexOf('说话方式') < text.indexOf('近期状态'), '状态应最后')
})

test('超字数时从后往前丢块，人格底色优先保留', () => {
  const r = mergeProfile(emptyProfile(), [
    item('identity', '角色', '产品负责人'),
    item('style', '语气', '直接'),
    item('facts', '事' + '实'.repeat(1), '很长的已知事实'.repeat(60)),
    item('state', '近期', '当前在忙的一件很长的项目进展'.repeat(40)),
  ], { now: NOW })
  const text = renderProfile(r.profile, { maxChars: 600 })
  assert.ok(text.length <= 640, '应受限，实际 ' + text.length)
  assert.match(text, /身份|产品负责人/, '身份块不该被丢掉')
})

test('相似度函数能区分近义与不同', () => {
  assert.ok(similarText('这个项目要慢一点', '这个项目要慢一点吧') > 0.6)
  assert.ok(similarText('这个项目要慢一点', '这个项目要尽快上线') < 0.6)
  assert.equal(normKey('  Hello，World！ '), 'helloworld')
})
