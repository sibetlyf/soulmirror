import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deriveMeetingKey, safeName, SessionMap } from '../lib/meeting-id.js'
import { ensurePersona, loadPersona, personaBlock, readPersonaFile, writePersonaFile, appendPersonaSection } from '../lib/persona.js'
import { MemoryStore } from '../lib/memory.js'

const tmp = () => mkdtempSync(join(tmpdir(), 'sm-core-'))

test('会议身份：显式号 > 标题里的号 > 标题', () => {
  assert.equal(deriveMeetingKey({ explicit: '206-275-219' }).key, '206275219')
  assert.equal(deriveMeetingKey({ title: '206 275 219' }).key, '206275219')
  assert.equal(deriveMeetingKey({ title: '206275219' }).source, 'title-id')
  assert.equal(deriveMeetingKey({ title: '产品周会' }).key, 'topic:产品周会')
  assert.equal(deriveMeetingKey({}).source, 'none')
  assert.equal(deriveMeetingKey({ explicit: '腾讯会议:206275219' }).key, '206275219')
})

test('sesafeName 去非法字符', () => {
  assert.equal(safeName('腾讯会议:206275219'), '腾讯会议_206275219')
  assert.ok(safeName('a/b\\c:d*e?f"g<h>i|j').indexOf('/') < 0)
})

test('会话映射持久化：同一会议复用同一 session', () => {
  const dir = tmp()
  const f = join(dir, 'sessions.json')
  const a = new SessionMap(f)
  a.set('206275219', { dshSessionId: 'session-1', title: '周会' })
  const b = new SessionMap(f)
  assert.equal(b.get('206275219').dshSessionId, 'session-1')
  b.set('206275219', { dshSessionId: 'session-2' })
  assert.equal(b.get('206275219').dshSessionId, 'session-2')
  assert.equal(b.list(5).length, 1)
  rmSync(dir, { recursive: true, force: true })
})

test('人格：缺失自动补种子，不覆盖已有内容', () => {
  const dir = tmp()
  ensurePersona(dir)
  const p1 = loadPersona(dir)
  assert.ok(p1.soul.includes('SOUL'))
  writePersonaFile(dir, 'identity', '# IDENTITY\n\n名字：测试')
  const p2 = loadPersona(dir, { cacheMs: 0 })
  assert.match(p2.identity, /测试/)
  assert.ok(personaBlock(p2).includes('测试'))
  rmSync(dir, { recursive: true, force: true })
})

test('人格：append 去重且带日期小节', () => {
  const dir = tmp()
  ensurePersona(dir)
  const r1 = appendPersonaSection(dir, 'user', ['喜欢简洁', '结论先行'], { stamp: '2026-10-23 08:00' })
  assert.equal(r1.added, 2)
  const r2 = appendPersonaSection(dir, 'user', ['喜欢简洁'], { stamp: '2026-10-23 09:00' })
  assert.equal(r2.added, 0)
  assert.equal(r2.skipped, 1)
  const body = readPersonaFile(dir, 'user')
  assert.equal((body.match(/喜欢简洁/g) || []).length, 1)
  assert.match(body, /自动积累 · 2026-10-23 08:00/)
  rmSync(dir, { recursive: true, force: true })
})

test('长期记忆：add / recent / digest', () => {
  const dir = tmp()
  const m = new MemoryStore(join(dir, 'memory.json'))
  m.add({ role: 'user', text: '预算周三确认' })
  m.add({ role: 'assistant', text: '记下了' })
  assert.equal(m.recent(5).length, 2)
  assert.equal(m.digest(5), '')
  rmSync(dir, { recursive: true, force: true })
})

test('长期记忆：蒸馏用 completer 抽取三类记忆', async () => {
  const dir = tmp()
  const m = new MemoryStore(join(dir, 'memory.json'))
  for (let i = 0; i < 8; i++) m.add({ role: 'user', text: '第 ' + i + ' 句' })
  const fakeCompleter = async () => '{"persona":["喜欢简洁"],"episodic":["周三确认预算"],"instruction":["先给结论"]}'
  const r = await m.distill(fakeCompleter, { minEntries: 4 })
  assert.equal(r.persona[0], '喜欢简洁')
  assert.match(m.digest(5), /先给结论/)
  rmSync(dir, { recursive: true, force: true })
})

test('长期记忆：样本不足时跳过蒸馏', async () => {
  const dir = tmp()
  const m = new MemoryStore(join(dir, 'memory.json'))
  m.add({ role: 'user', text: '一句' })
  const r = await m.distill(async () => '{}', { minEntries: 4 })
  assert.equal(r.skipped, true)
  rmSync(dir, { recursive: true, force: true })
})
