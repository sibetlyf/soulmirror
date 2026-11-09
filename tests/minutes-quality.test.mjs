import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildOfflineMinutes, getLastMinutesError } from '../lib/offline-asr.js'

/**
 * 纪要质量事故的回归（2026-11-09 那场会）。
 *
 * 现象：纪要只有「## 会议要点（抽取式）」+ 最后 12 句原文，基本等于没内容。
 * 根因：纪要生成和"逐句判定"共用同一个 limit 闸门（maxPending=2、同内容合并、120s 超时），
 *       被合并/超时后抛错，而错误被 `catch {}` 吞掉 → 静默退化成抽取式。
 */

test('模型失败时必须带上失败原因（不再静默）', async () => {
  const md = await buildOfflineMinutes({
    sentences: Array.from({ length: 20 }, (_, i) => ({ text: '第' + i + '句会议内容' })),
    completer: async () => { throw new Error('被闸门合并') },
  })
  assert.match(md, /没有生成正式纪要/, '兜底要明说没生成正式纪要')
  assert.match(md, /被闸门合并/, '要写出具体原因')
  assert.match(md, /原文节选，不是摘要/, '要说明这不是摘要')
  assert.match(getLastMinutesError(), /被闸门合并/)
})

test('模型正常返回时不加任何兜底横幅', async () => {
  const md = await buildOfflineMinutes({
    sentences: [{ text: '一' }, { text: '二' }],
    completer: async () => '## 决议\n- 先做 A',
  })
  assert.equal(md, '## 决议\n- 先做 A')
  assert.equal(/原文节选/.test(md), false)
})

test('模型返回空内容也当失败处理', async () => {
  const md = await buildOfflineMinutes({
    sentences: [{ text: '一句话' }],
    completer: async () => '   ',
  })
  assert.match(md, /原文节选/)
})

test('接线：纪要走专用补全器，不经过逐句判定闸门', () => {
  const src = readFileSync(new URL('../index.js', import.meta.url), 'utf8')
  assert.match(src, /function makeMinutesCompleter\(\)/, '应有纪要专用补全器')
  const at = src.indexOf('function makeMinutesCompleter()')
  const seg = src.slice(at, at + 1200)
  assert.match(seg, /promptSession\(ctx, sid, prompt, \{ timeoutMs: 300000 \}\)/, '应放宽超时')
  assert.equal(/gate\.submit/.test(seg), false, '不该走闸门')
})

test('接线：纪要里要过滤掉助手自己的播报', () => {
  const src = readFileSync(new URL('../index.js', import.meta.url), 'utf8')
  const at = src.indexOf('会议纪要已写入知识库|已写入知识库|开始会后整理')
  assert.ok(at > 0, '应过滤助手播报行')
  // 过滤必须发生在拼 texts 的时候（紧邻 .map 生成句子）
  const seg = src.slice(at, at + 300)
  assert.match(seg, /\.map\(\(x\) => \(\{ text:/, '过滤后应接着拼句子')
})

test('接线：纪要优先交给 DSH 后台任务，失败才回退', () => {
  const src = readFileSync(new URL('../index.js', import.meta.url), 'utf8')
  assert.match(src, /async function minutesViaBackgroundTask\(dir, lines, title/, '应有后台任务实现')
  const at = src.indexOf('const bg = await minutesViaBackgroundTask')
  assert.ok(at > 0, '离线整理应先尝试后台任务')
  const seg = src.slice(at, at + 900)
  assert.match(seg, /if \(bg\.ok\)/, '成功就直接用后台结果')
  assert.match(seg, /minutesSource = 'background'/, '应记录来源')
  assert.match(seg, /buildOfflineMinutes\(/, '失败才回退到会话模型')
})

test('接线：后台任务用文件交接（不走命令行传长文本）', () => {
  const src = readFileSync(new URL('../index.js', import.meta.url), 'utf8')
  const at = src.indexOf('async function minutesViaBackgroundTask')
  const seg = src.slice(at, at + 4000)
  assert.match(seg, /writeMinutesSource\(/, '应把转写写文件')
  assert.match(seg, /buildMinutesTaskPrompt\(/, '应构造文件读写指令')
  assert.match(seg, /readMinutesResult\(/, '应读回结果并校验')
})
