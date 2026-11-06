import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/**
 * 接线回归：会后整理必须按会议隔离。
 *
 * 审查指出：全局 finalizing/lastFinalizedAt 会让 B 会被 A 的去抖误杀，
 * 且整理过程中反复读可变的 session.dir 有串场风险。
 */

const src = readFileSync(new URL('../index.js', import.meta.url), 'utf8')

test('不再有全局 finalizing / lastFinalizedAt 状态', () => {
  assert.equal(/let finalizing = false/.test(src), false, '不该再有全局 finalizing')
  assert.equal(/let lastFinalizedAt = 0/.test(src), false, '不该再有全局 lastFinalizedAt')
})

test('finalizeMeeting 用注册表按目录+修订号去重', () => {
  const at = src.indexOf('async function finalizeMeeting(')
  const seg = src.slice(at, at + 700)
  assert.match(seg, /snapshotRun\(session\)/, '应快照会议身份')
  assert.match(seg, /finalizeRegistry\.tryBegin\(run\.dir, run\.revision\)/, '应按 dir+revision 去重')
  assert.match(seg, /if \(!claim\.ok\)/, '拿不到令牌要跳过')
})

test('整理内部改用不可变的 runDir（不再读 session.dir）', () => {
  const at = src.indexOf('async function finalizeMeeting(')
  const nextFn = src.indexOf('\n  async function ', at + 10)
  const body = src.slice(at, nextFn > 0 ? nextFn : at + 20000)
  assert.equal(/session\.dir/.test(body), false, '函数体内不该再直接用 session.dir')
  assert.match(body, /runDir/, '应使用快照 runDir')
})

test('令牌一定会被释放（finally）', () => {
  const at = src.indexOf('async function finalizeMeeting(')
  const nextFn = src.indexOf('\n  async function ', at + 10)
  const body = src.slice(at, nextFn > 0 ? nextFn : at + 20000)
  assert.match(body, /finally \{[\s\S]{0,120}finalizeRegistry\.end\(claim\.token\)/, '应在 finally 释放')
})

test('stopAndOrganize 不再自己判断"刚刚整理过"（交给注册表）', () => {
  const at = src.indexOf('async function stopAndOrganize(')
  const seg = src.slice(at, at + 900)
  assert.equal(/lastFinalizedAt < 60000/.test(seg), false, '旧去抖应已删除')
})
