import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/**
 * 对齐 DSH 的设计：会话即日志，会话是一本只增不改的账。
 *
 * 会议要求：
 *  1) 转写每来一句就**追加**到 transcript.jsonl，绝不重写整个文件
 *  2) 合并/升级也是"新行 + replaces 指向旧行"，同样是追加
 *  3) 哪怕进程被强杀，最后一句之前的都在盘上
 */

const src = readFileSync(new URL('../lib/session.js', import.meta.url), 'utf8')

test('转写落盘走统一的 _appendTranscript（只此一处写 transcript.jsonl）', () => {
  assert.match(src, /_appendTranscript\(item\) \{/, '缺少统一落盘方法')
  // helper 内部用 appendFile（追加），不是 writeFile（重写）
  const at = src.indexOf('_appendTranscript(item) {')
  const seg = src.slice(at, at + 400)
  assert.match(seg, /appendFile\(join\(this\.dir, 'transcript\.jsonl'\)/, '应使用 appendFile 追加')
  assert.equal(/writeFile\(join\(this\.dir, 'transcript\.jsonl'/.test(seg), false, '不能用 writeFile 重写账本')
})

test('合并与升级也写成追加行，并带 replaces 指回旧行', () => {
  assert.match(src, /_appendTranscript\(\{ \.\.\.last, replaces: last\.t \}\)/, '合并/升级应追加带 replaces 的行')
  // 两处（碎片合并 + 完整版升级）都要如此
  const count = (src.match(/replaces: last\.t/g) || []).length
  assert.ok(count >= 2, '至少两处合并/升级要标 replaces，实际 ' + count)
})

test('每句都会触发落盘（不会只在结束时写一次）', () => {
  // _pushLine 的三个出口都应落盘：合并、升级、新增
  const at = src.indexOf('_pushLine(item, { force = false } = {}) {')
  assert.ok(at > 0, '找不到 _pushLine')
  const seg = src.slice(at, at + 1800)
  const calls = (seg.match(/_appendTranscript\(/g) || []).length
  assert.ok(calls >= 3, '三个分支都要落盘，实际 ' + calls + ' 处')
})

test('断点（gap）也写进同一本账', () => {
  const at = src.indexOf('onGap:')
  const seg = src.slice(at, at + 400)
  assert.match(seg, /_appendTranscript\(item\)/, 'gap 也应追加到 transcript.jsonl')
})
