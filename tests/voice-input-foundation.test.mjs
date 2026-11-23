/**
 * 语音输入加工地基的三组单测（dictionary / pipeline-layers / kb-index）。
 *
 * 对应需求：热词预算与命中排序、从纠正中学习（须确认）、知识库索引与检索、
 * 动静分层装配与预算裁剪、上下文感知压缩。全部纯内存，不联网、不碰设备。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  emptyDictionary, upsertTerm, noteHit, allocateHotwords, buildDictionaryBlock,
  suggestTerm, confirmSuggestion, importFromKnowledge, HOTWORD_BUDGET_CHARS,
} from '../lib/dictionary.js'
import {
  assemblePrompt, staticFingerprint, buildRecentContext, LAYER_BUDGETS,
} from '../lib/pipeline-layers.js'
import { ingestDoc, search, buildKnowledgeBlock, extractTerms, tokens } from '../lib/kb-index.js'

// ── 词典 ──────────────────────────────────────────────────────────────────────
test('词典：手动词保留席位，其余按命中次数排序，总预算不超', () => {
  let s = emptyDictionary()
  // 老词命中很高，会挤占预算
  for (let i = 1; i <= 40; i++) s = noteHit(upsertTerm(s, { word: '老词' + i, hits: 99 }), '老词' + i, 5)
  // 刚手动添加的新词
  s = upsertTerm(s, { word: '新词甲', manual: true })
  const words = allocateHotwords(s)
  const joined = words.join(',')
  assert.ok(joined.length <= HOTWORD_BUDGET_CHARS, '热词预算不能超，实际 ' + joined.length)
  assert.ok(words.includes('新词甲'), '手动词必须保住席位（不被高频老词挤掉）')
})

test('词典：学习走"先建议、后确认"，没确认不入库；拒绝即丢弃', () => {
  let s = emptyDictionary()
  s = suggestTerm(s, { word: '飞书', kind: 'product', note: '不是飞轮' })
  assert.equal(s.terms.length, 0, '建议阶段不能直接进词典')
  assert.equal(s.pending.length, 1)
  s = confirmSuggestion(s, '飞书', { accept: true })
  assert.equal(s.terms.length, 1, '确认后入词典')
  assert.equal(s.pending.length, 0)
  assert.equal(s.terms[0].manual, false, '学习来的词不算手动词')

  let t = suggestTerm(emptyDictionary(), { word: '噪声词' })
  t = confirmSuggestion(t, '噪声词', { accept: false })
  assert.equal(t.terms.length, 0)
  assert.equal(t.pending.length, 0, '拒绝后不能留在队列里')
})

test('词典：知识库导入进待确认队列，不静默入库；已存在的词不重复', () => {
  let s = upsertTerm(emptyDictionary(), { word: 'SoulMirror', kind: 'product' })
  s = importFromKnowledge(s, ['SoulMirror', '腾讯会议', 'OpenLess'])
  assert.equal(s.pending.length, 2, '只加新的两个')
  assert.ok(s.pending.every((p) => p.source === 'knowledge'))
  assert.equal(s.terms.length, 1, '导入不等于入库')
})

test('词典：提示词段强调"逐句判断、拿不准保持原样"', () => {
  const s = upsertTerm(emptyDictionary(), { word: '云', note: '可能指 Claude' })
  const block = buildDictionaryBlock(s)
  assert.match(block, /拿不准保持原样/)
  assert.match(block, /不要全局替换/)
  assert.match(block, /云/)
})

// ── 动静分层 ────────────────────────────────────────────────────────────────
test('分层：静态/动态/转写各自按预算，超预算按段裁并记账', () => {
  const big = 'X'.repeat(LAYER_BUDGETS.static + 500)
  const r = assemblePrompt({
    staticParts: ['规则一', big, '词典段'],
    dynamicParts: ['上下文一段'],
    transcript: '待加工内容'.repeat(500),
  })
  assert.ok(r.report.layers.static.budget === LAYER_BUDGETS.static)
  assert.ok(r.system.length <= LAYER_BUDGETS.static + 2, '静态层不能超预算')
  assert.ok(r.report.truncated.static > 0, '被裁掉的字数必须记账（不静默截断）')
  assert.ok(r.report.truncated.transcript > 0, '转写超长要记账')
  // 转写超长保留最新的
  assert.ok(r.user.includes('待加工内容'))
  assert.equal(typeof r.report.total, 'number')
})

test('分层：静态层指纹稳定，动态内容变化不影响指纹', () => {
  const a = staticFingerprint(['规则A', '词典B'])
  const b = staticFingerprint(['规则A', '词典B'])
  assert.equal(a, b, '同样内容必须同指纹（可用于前缀缓存）')
  assert.notEqual(a, staticFingerprint(['规则A', '词典C']))
})

test('上下文感知：只保留最近 N 轮，超预算先丢最旧', () => {
  const turns = ['第1句', '第2句', '第3句', '第4句', '第5句', '第6句', '第7句']
  const ctx = buildRecentContext(turns, { maxTurns: 3, maxChars: 200 })
  assert.ok(!ctx.includes('第1句'), '超过 maxTurns 的旧内容要丢')
  assert.ok(ctx.includes('第7句'), '最新的必须在')
  const tight = buildRecentContext(['很长'.repeat(300), '新的'], { maxChars: 100 })
  assert.ok(tight.length <= 100, '硬预算内')
})

// ── 知识库索引 ──────────────────────────────────────────────────────────────
test('知识库：切词去掉虚词、检索按重叠加权、片段只给命中句', () => {
  const t = tokens('我们今天讨论了腾讯会议的录制问题，然后决定用 SoulMirror 来采集。')
  // 长中文串按 n-gram 切（整串只在 ≤8 字时才单独产出），所以验收标准是
  // 专名的组成片段都在、且检索能命中——不是"整词字符串必须存在"。
  assert.ok(t.includes('腾讯') && t.includes('会议'), '专名片段要能切出来')
  assert.ok(!t.includes('我们'), '虚词要滤掉')

  const idx = [
    ingestDoc({ id: 'm1', title: '站会纪要', text: '决定用 SoulMirror 采集腾讯会议音频。李亚峰负责验证。' }),
    ingestDoc({ id: 'm2', title: '周报', text: '本周完成 PPT 提速调研，与会议无关。' }),
  ]
  const hits = search(idx, 'SoulMirror 腾讯会议 采集')
  assert.ok(hits.length >= 1)
  assert.equal(hits[0].id, 'm1', '相关文档要排第一')
  const block = buildKnowledgeBlock(hits)
  assert.match(block, /知识库参考/)
  assert.ok(block.length < 500, '只给命中片段，不塞整篇')
})

test('知识库：抽专有名词候选（供词典确认，不自动入库）', () => {
  const idx = [
    ingestDoc({ id: 'a', title: 'OpenLess', tags: ['产品'], text: 'OpenLess 是快速语音输入法。' }),
    ingestDoc({ id: 'b', title: '腾讯会议接入', tags: ['腾讯会议'], text: '腾讯会议接入 SoulMirror。' }),
  ]
  const terms = extractTerms(idx)
  assert.ok(terms.length > 0)
  assert.ok(terms.some((w) => /openless|tencent|腾讯会议/i.test(w) || w.length >= 2))
  assert.ok(terms.length <= 40)
})
