import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  fmtClock, fmtStamp, renderExport, exportFileName, matchRecord, searchRecords,
} from '../lib/record-export.js'

const rec = {
  dir: 'x',
  source: 'offline',
  speakers: 2,
  preparation: { invite: '周会', goal: '确定上线时间', background: '' },
  meta: { startedAt: '2026-11-04T07:20:00.000Z', durationMin: 32 },
  minutes: '## 决议\n- 下周一上线',
  lines: [
    { speaker: '说话人1', begin: 1200, text: '前端已经完成' },
    { speaker: '说话人2', begin: 65000, text: '移动端还差适配' },
  ],
}

test('fmtClock 支持分钟与小时', () => {
  assert.equal(fmtClock(1200), '00:01')
  assert.equal(fmtClock(65000), '01:05')
  assert.equal(fmtClock(3725000), '1:02:05')
  assert.equal(fmtClock(-5), '')
  assert.equal(fmtClock(undefined), '')
})

test('fmtStamp 输出本地时间格式', () => {
  assert.match(fmtStamp('2026-11-04T07:20:00.000Z'), /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)
  assert.equal(fmtStamp('坏数据'), '')
})

test('markdown 导出含标题、元信息、纪要与带说话人的转写', () => {
  const md = renderExport(rec, { format: 'markdown' })
  assert.match(md, /^# 确定上线时间/m)
  assert.match(md, /会邀：周会/)
  assert.match(md, /32 分钟/)
  assert.match(md, /说话人：2 位/)
  assert.match(md, /会后重转写/)
  assert.match(md, /## 纪要/)
  assert.match(md, /下周一上线/)
  assert.match(md, /\[00:01\] 说话人1：前端已经完成/)
})

test('text 导出是纯文本，不含 Markdown 标题符号', () => {
  const txt = renderExport(rec, { format: 'text' })
  assert.ok(!txt.startsWith('# '))
  assert.match(txt, /—— 纪要 ——/)
  assert.match(txt, /移动端还差适配/)
})

test('没有转写/纪要时不崩，写"无"', () => {
  const md = renderExport({ preparation: {}, meta: {}, minutes: '', lines: [] })
  assert.match(md, /（无）/)
})

test('导出文件名安全（去掉路径分隔符与非法字符）', () => {
  const name = exportFileName({ ...rec, preparation: { goal: 'a/b:c*d?e' } }, 'markdown')
  assert.ok(!/[/:*?]/.test(name))
  assert.match(name, /\.md$/)
  assert.match(exportFileName(rec, 'text'), /\.txt$/)
})

test('matchRecord 能在目标/纪要/转写里找到并给出片段', () => {
  const a = matchRecord(rec, '上线')
  assert.equal(a.hit, true)
  assert.ok(a.where.includes('目标') || a.where.includes('纪要'))

  const b = matchRecord(rec, '移动端')
  assert.equal(b.hit, true)
  assert.ok(b.where.includes('转写'))
  assert.match(b.snippet, /移动端/)

  const c = matchRecord(rec, '不存在的词')
  assert.equal(c.hit, false)
  assert.deepEqual(c.where, [])
})

test('searchRecords 过滤并保留命中原因', () => {
  const list = [
    { id: '1', dir: 'a', title: 'A' },
    { id: '2', dir: 'b', title: 'B' },
  ]
  const data = { a: rec, b: { ...rec, preparation: { goal: '别的事' }, minutes: '', lines: [] } }
  const hit = searchRecords(list, '上线', (dir) => data[dir])
  assert.equal(hit.length, 1)
  assert.equal(hit[0].id, '1')
  assert.ok(hit[0].match.where.length > 0)
})

test('searchRecords 空查询返回原列表', () => {
  const list = [{ id: '1', dir: 'a' }]
  assert.equal(searchRecords(list, '  ', () => null).length, 1)
})
