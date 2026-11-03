import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeText, TranscriptDeduper, SpeechDeduper } from '../lib/dedupe.js'

test('规范化：空白/标点/大小写差异视为同一句', () => {
  assert.equal(normalizeText('你好，世界。'), normalizeText('你好 世界'))
  assert.equal(normalizeText('Hello, World!'), normalizeText('hello world'))
  assert.equal(normalizeText('   '), '')
})

test('转写去重：窗口内同一句只放行一次', () => {
  let now = 1000
  const d = new TranscriptDeduper({ windowMs: 8000, now: () => now })
  assert.equal(d.isDuplicate('帮我确认一下评审会时间'), false)
  now += 3000
  assert.equal(d.isDuplicate('帮我确认一下评审会时间。'), true, '只差标点也算重复')
  assert.equal(d.dropped, 1)
  now += 200
  assert.equal(d.isDuplicate('帮我确认一下评审会时间'), true)
  assert.equal(d.dropped, 2)
})

test('转写去重：窗口外的同一句允许重新处理', () => {
  let now = 0
  const d = new TranscriptDeduper({ windowMs: 5000, now: () => now })
  assert.equal(d.isDuplicate('下周评审'), false)
  now = 6000
  assert.equal(d.isDuplicate('下周评审'), false, '过了窗口就该重新处理')
})

test('转写去重：空文本不参与（不误伤）', () => {
  const d = new TranscriptDeduper({ windowMs: 1000 })
  assert.equal(d.isDuplicate(''), false)
  assert.equal(d.isDuplicate('   '), false)
})

test('播报去重：5 分钟内同一段不重复说', () => {
  let now = 0
  const s = new SpeechDeduper({ windowMs: 300000, now: () => now })
  const text = '当前目录只有两个文件，last-task.json 和 minutes.md'
  assert.equal(s.recentlySpoken(text), false)
  now = 60000
  assert.equal(s.recentlySpoken(text), true)
  now = 301000
  assert.equal(s.recentlySpoken(text), false, '超过 5 分钟可以说')
})

test('播报去重：极短回复不参与，避免显得呆板', () => {
  const s = new SpeechDeduper()
  assert.equal(s.recentlySpoken('好'), false)
  assert.equal(s.recentlySpoken('好'), false)
  assert.equal(s.recentlySpoken('收到'), false)
  assert.equal(s.recentlySpoken('收到'), false)
})

test('播报去重：措辞微调也算同一段（去标点后比较）', () => {
  let now = 0
  const s = new SpeechDeduper({ windowMs: 300000, now: () => now })
  assert.equal(s.recentlySpoken('我去查一下会议纪要。'), false)
  now = 1000
  assert.equal(s.recentlySpoken('我去查一下会议纪要'), true)
})
