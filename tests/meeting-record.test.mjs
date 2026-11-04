import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  savePreparation, loadPreparation, saveMeta, loadMeta, listRecords, loadRecord,
} from '../lib/meeting-record.js'

const root = mkdtempSync(join(tmpdir(), 'sm-rec-'))

test('准备信息能存能读', () => {
  const dir = join(root, '2026-01-01T00-00-00')
  mkdirSync(dir, { recursive: true })
  savePreparation(dir, { invite: '周会', goal: '确定上线时间', background: '角色：PM' })
  const p = loadPreparation(dir)
  assert.equal(p.invite, '周会')
  assert.equal(p.goal, '确定上线时间')
  assert.equal(p.background, '角色：PM')
})

test('准备信息只存文字，不扫描项目', () => {
  const dir = join(root, 'prep2')
  mkdirSync(dir, { recursive: true })
  savePreparation(dir, { goal: 'x', projectDir: 'G:/proj' })
  const p = loadPreparation(dir)
  assert.equal(p.projectDir, 'G:/proj', '只记路径本身')
})

test('meta 支持增量更新', () => {
  const dir = join(root, 'meta1')
  mkdirSync(dir, { recursive: true })
  saveMeta(dir, { startedAt: '2026-01-01T00:00:00Z' })
  saveMeta(dir, { endedAt: '2026-01-01T01:00:00Z', durationMin: 60 })
  const m = loadMeta(dir)
  assert.equal(m.startedAt, '2026-01-01T00:00:00Z', '旧字段保留')
  assert.equal(m.durationMin, 60)
})

test('listRecords 按时间倒序，带摘要字段', () => {
  const a = join(root, '2026-01-02T10-00-00')
  const b = join(root, '2026-01-03T10-00-00')
  for (const d of [a, b]) mkdirSync(d, { recursive: true })
  savePreparation(a, { goal: '旧会议' })
  savePreparation(b, { goal: '新会议', invite: '评审' })
  saveMeta(b, { durationMin: 30, speakers: 2 })
  writeFileSync(join(b, 'minutes.md'), '# 纪要')
  writeFileSync(join(b, 'transcript.jsonl'), '{"text":"a"}\n{"text":"b"}\n')

  const list = listRecords(root, 10)
  assert.ok(list.length >= 2)
  assert.equal(list[0].id, '2026-01-03T10-00-00', '最新的在前')
  assert.equal(list[0].title, '新会议')
  assert.equal(list[0].hasMinutes, true)
  assert.equal(list[0].lines, 2)
  assert.equal(list[0].speakers, 2)
})

test('loadRecord 优先用会后重转写（带说话人）', () => {
  const dir = join(root, '2026-01-04T10-00-00')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'transcript.jsonl'), JSON.stringify({ text: '实时版' }) + '\n')
  writeFileSync(join(dir, 'transcript-offline.jsonl'),
    JSON.stringify({ speaker: '说话人1', text: '会后版1' }) + '\n' +
    JSON.stringify({ speaker: '说话人2', text: '会后版2' }) + '\n')
  writeFileSync(join(dir, 'minutes.md'), '## 决议\n无')

  const r = loadRecord(dir)
  assert.equal(r.source, 'offline')
  assert.equal(r.speakers, 2)
  assert.equal(r.lines.length, 2)
  assert.match(r.minutes, /决议/)
})

test('loadRecord 没有会后版本时用实时版', () => {
  const dir = join(root, '2026-01-05T10-00-00')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'transcript.jsonl'), JSON.stringify({ text: '只有实时' }) + '\n')
  const r = loadRecord(dir)
  assert.equal(r.source, 'live')
  assert.equal(r.lines[0].text, '只有实时')
})

test('空目录/不存在目录不抛错', () => {
  assert.deepEqual(listRecords(join(root, 'nope')), [])
  assert.equal(loadRecord(''), null)
  assert.deepEqual(loadPreparation(''), { invite: '', goal: '', background: '', projectDir: '' })
})

test.after(() => { try { rmSync(root, { recursive: true, force: true }) } catch { /* ignore */ } })
