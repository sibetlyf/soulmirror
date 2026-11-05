import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { parseLog, replayLog, readLogText, linesToText } from '../lib/transcript-log.js'

/**
 * 账本回放：写入端是"只增不改"，读取端必须按 replaces 折叠，
 * 并且要容忍强杀导致的半行 JSON。
 */

const j = (o) => JSON.stringify(o)

test('普通行按顺序保留', () => {
  const text = [j({ t: 't1', text: '第一句' }), j({ t: 't2', text: '第二句' })].join('\n')
  const r = readLogText(text)
  assert.equal(r.lines.length, 2)
  assert.equal(r.lines[0].text, '第一句')
  assert.equal(r.lines[1].text, '第二句')
})

test('带 replaces 的行替换旧句，而不是追加（核心）', () => {
  const text = [
    j({ t: 't1', text: '你这。' }),            // 截断版先落地
    j({ t: 't2', text: '回我一下。' }),
    j({ t: 't1b', text: '你这回我一下。', replaces: 't1' }),  // 合并成一句
  ].join('\n')
  const r = readLogText(text)
  assert.equal(r.lines.length, 2, '合并后应只剩两句，不能出现截断版+完整版')
  assert.equal(r.lines[0].text, '你这回我一下。')
  assert.equal(r.lines[1].text, '回我一下。')
  assert.equal(r.replaced, 1)
})

test('替换保留原位置与原始时间（同一句话，不是新句子）', () => {
  const text = [
    j({ t: 'a', text: '短' }),
    j({ t: 'b', text: '第二' }),
    j({ t: 'a2', text: '变长了的内容', replaces: 'a' }),
  ].join('\n')
  const r = readLogText(text)
  assert.equal(r.lines[0].t, 'a', '应保留原始 t')
  assert.equal(r.lines[0].text, '变长了的内容')
  assert.equal(r.lines[0].replaces, undefined, '折叠后不应残留 replaces')
})

test('链式替换（连续升级同一句）最终取最后版本', () => {
  const text = [
    j({ t: 'x', text: '一' }),
    j({ t: 'x1', text: '一二', replaces: 'x' }),
    j({ t: 'x2', text: '一二三', replaces: 'x' }),
  ].join('\n')
  const r = readLogText(text)
  assert.equal(r.lines.length, 1)
  assert.equal(r.lines[0].text, '一二三')
})

test('目标不存在的 replaces 不丢内容（当新句收下）', () => {
  const text = [j({ t: 'z', text: '孤立升级', replaces: '不存在的t' })].join('\n')
  const r = readLogText(text)
  assert.equal(r.lines.length, 1)
  assert.equal(r.lines[0].text, '孤立升级')
  assert.equal(r.orphanReplaces, 1)
})

test('强杀导致的半行 JSON 被跳过，不抛错', () => {
  const text = [j({ t: 'a', text: '完整' }), '{"t":"b","text":"未写完'].join('\n')
  const r = readLogText(text)
  assert.equal(r.lines.length, 1)
  assert.equal(r.lines[0].text, '完整')
  assert.equal(r.badLines, 1)
})

test('空行与空白行被忽略（顺序追加时可能产生）', () => {
  const text = '\n' + j({ t: 'a', text: 'x' }) + '\n\n\n' + j({ t: 'b', text: 'y' }) + '\n'
  const r = readLogText(text)
  assert.equal(r.lines.length, 2)
})

test('断点（gap）保留成一行，不会被当成普通句子排序错乱', () => {
  const text = [j({ t: 'a', text: '前' }), j({ t: 'g', text: '〔断线约 3 秒〕', src: 'gap', gap: true }), j({ t: 'b', text: '后' })].join('\n')
  const r = readLogText(text)
  assert.equal(r.lines.length, 3)
  assert.equal(r.lines[1].gap, true)
  assert.match(linesToText(r.lines), /断线约 3 秒/)
})

test('linesToText 带上说话人', () => {
  const text = [j({ t: 'a', text: '你好', speaker: '说话人1' }), j({ t: 'b', text: '嗯' })].join('\n')
  const t = linesToText(readLogText(text).lines)
  assert.equal(t, '说话人1：你好\n嗯')
})

test('parseLog 是纯函数，不修改输入', () => {
  const text = j({ t: 'a', text: 'x' })
  const r1 = parseLog(text)
  const r2 = parseLog(text)
  assert.deepEqual(r1, r2)
})

test('真实会议账本能回放（本机有记录时）', (t) => {
  const root = join(homedir(), '.dsh', 'soulmirror')
  if (!existsSync(root)) { t.skip('没有会议数据'); return }
  const dirs = readdirSync(root).filter((d) => existsSync(join(root, d, 'transcript.jsonl')))
  if (!dirs.length) { t.skip('没有 transcript.jsonl'); return }
  const text = readFileSync(join(root, dirs[0], 'transcript.jsonl'), 'utf8')
  const r = readLogText(text)
  assert.ok(r.lines.length > 0, '真实账本应能回放出行')
  assert.equal(r.badLines, 0, '正常退出的账本不应有坏行')
  assert.ok(r.records >= r.lines.length, '账本行数应 >= 折叠后的句数（说明替换被折叠了）')
})
