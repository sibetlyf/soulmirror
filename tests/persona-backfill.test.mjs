import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  pickBackfillMeetings, slimMeetingText, buildBackfillPrompt, summarizeBackfill, BACKFILL_DEFAULTS,
} from '../lib/persona-backfill.js'

/**
 * 画像回填：用历史账本补出画像。
 *
 * 动机：刚装上新版本时画像是空的，但机器上已经躺着几十场会议的账本。
 * 要求：只读账本（不重转写）、控制 token、选择逻辑可测、明确告诉用户花几次模型调用。
 */

const NOW = Date.parse('2026-11-06T10:00:00Z')
const dayAgo = (n) => NOW - n * 86400000

test('挑选：只留账本够大的、不太旧的，且最近的优先', () => {
  const stat = (dir) => ({
    '/m/recent': { mtimeMs: dayAgo(1), size: 5000 },
    '/m/old': { mtimeMs: dayAgo(200), size: 5000 },
    '/m/tiny': { mtimeMs: dayAgo(1), size: 50 },
    '/m/mid': { mtimeMs: dayAgo(10), size: 8000 },
  }[dir] || null)

  const r = pickBackfillMeetings({
    dirs: ['/m/recent', '/m/old', '/m/tiny', '/m/mid'],
    now: NOW, stat, options: { limit: 5 },
  })
  assert.deepEqual(r.picked.map((x) => x.dir), ['/m/recent', '/m/mid'], '最近的在前，太旧/太小被排除')
  assert.ok(r.skipped.some((s) => /超过/.test(s.why)))
  assert.ok(r.skipped.some((s) => /太小/.test(s.why)))
})

test('挑选：limit 生效，超出部分进 skipped 并说明原因', () => {
  const stat = () => ({ mtimeMs: dayAgo(1), size: 5000 })
  const dirs = Array.from({ length: 8 }, (_, i) => '/m/' + i)
  const r = pickBackfillMeetings({ dirs, now: NOW, stat, options: { limit: 3 } })
  assert.equal(r.picked.length, 3)
  assert.equal(r.skipped.filter((s) => /上限/.test(s.why)).length, 5)
})

test('短会议不裁剪，长会议取首尾并标注省略', () => {
  const short = Array.from({ length: 10 }, (_, i) => '第' + i + '句')
  const a = slimMeetingText(short)
  assert.equal(a.omitted, 0)
  assert.match(a.text, /第0句/)
  assert.match(a.text, /第9句/)

  const long = Array.from({ length: 200 }, (_, i) => '第' + i + '句')
  const b = slimMeetingText(long)
  assert.ok(b.omitted > 0, '长会议应省略中间')
  assert.match(b.text, /中间省略 \d+ 句/)
  assert.match(b.text, /第0句/, '开头要保留（背景/目标）')
  assert.match(b.text, /第199句/, '结尾要保留（结论/待办）')
  assert.ok(b.text.length <= BACKFILL_DEFAULTS.maxCharsPerMeeting, '总长受限')
})

test('裁剪后不超过字数上限（即使单句很长）', () => {
  const lines = Array.from({ length: 50 }, () => '很'.repeat(200))
  const r = slimMeetingText(lines, { maxCharsPerMeeting: 500 })
  assert.ok(r.text.length <= 500, '实际 ' + r.text.length)
})

test('提示词要求"关于她本人"，并明确历史信息可能过时', () => {
  const msgs = buildBackfillPrompt({ meetingText: '讨论上线节奏', knownText: '- 角色：产品负责人', title: '周会' })
  const all = msgs.map((m) => m.content).join('\n')
  assert.match(all, /关于用户本人/)
  assert.match(all, /identity.*style.*stance.*facts.*state/s, '应列出五个分区')
  assert.match(all, /历史会议的信息可能已过时/)
  assert.match(all, /已知画像/, '应把已有画像喂进去避免重复')
  assert.match(all, /会议：周会/)
})

test('没有已知画像时不塞空块', () => {
  const msgs = buildBackfillPrompt({ meetingText: 'x' })
  assert.equal(/已知画像/.test(msgs.map((m) => m.content).join('\n')), false)
})

test('汇总文案包含读了几个会、增/强化/取代与收敛度', () => {
  const s = summarizeBackfill({ meetings: 3, added: 5, reinforced: 2, superseded: 1, convergence: { score: 0.31, label: '略有印象' } })
  assert.match(s, /读了 3 场会/)
  assert.match(s, /新增 5 条/)
  assert.match(s, /相似程度 31%/)
})

test('什么都没选中时给出明确说明', () => {
  assert.equal(summarizeBackfill({}), '没有可回填的会议')
})
