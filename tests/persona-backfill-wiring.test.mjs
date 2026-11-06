import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/**
 * 画像回填的接线。
 *
 * 用户问"所以目前我的画像呢" —— 答案是空的，而且新管线还没跑过。
 * 所以必须有办法用**已有账本**把画像补出来，而不是要求再开几十场会。
 */

const src = readFileSync(new URL('../index.js', import.meta.url), 'utf8')

test('soul_persona 支持 backfill 动作', () => {
  const at = src.indexOf("name: 'soul_persona'")
  assert.ok(at > 0, '找不到 soul_persona')
  const seg = src.slice(at, at + 3000)
  assert.match(seg, /'backfill'/, 'action 枚举应包含 backfill')
  assert.match(seg, /a\.action === 'backfill'/, '应有 backfill 分支')
  assert.match(seg, /limit/, '应可指定回填几场')
})

test('backfill 只读账本，不碰音频也不重转写', () => {
  const at = src.indexOf("a.action === 'backfill'")
  const seg = src.slice(at, at + 5000)
  assert.match(seg, /transcript\.jsonl/, '应读账本')
  assert.match(seg, /readLogText\(/, '应走回放折叠')
  assert.equal(/runOfflinePass|transcribeOffline|readFileSync\(.*audio\.wav/.test(seg), false,
    'backfill 不该碰音频或重转写')
})

test('backfill 会把结果写进画像与四层记忆', () => {
  const at = src.indexOf("a.action === 'backfill'")
  const seg = src.slice(at, at + 5000)
  assert.match(seg, /saveProfile\(/, '应落盘画像')
  assert.match(seg, /appendWarm\(/, '应写暖态')
  assert.match(seg, /consolidate\(/, '应整理晋升')
  assert.match(seg, /convergence\(/, '应报告收敛度')
})

test('backfill 会告诉用户"读了几场、增了几条、现在多像"', () => {
  const at = src.indexOf("a.action === 'backfill'")
  const seg = src.slice(at, at + 5000)
  assert.match(seg, /summarizeBackfill\(/, '应给出汇总结论文案')
  assert.match(seg, /details\.push/, '应逐场说明结果')
})

test('没有可回填的会议时给出明确原因', () => {
  const at = src.indexOf("a.action === 'backfill'")
  const seg = src.slice(at, at + 5000)
  assert.match(seg, /没有可回填的会议/, '应明确说没有可回填的')
})

test('回填每场都有失败隔离（一场坏不影响整体）', () => {
  const at = src.indexOf("a.action === 'backfill'")
  const seg = src.slice(at, at + 5000)
  assert.match(seg, /stats\.failed \+= 1/, '应统计失败场次')
  assert.match(seg, /catch \(e\)/, '单场异常应被捕获')
})
