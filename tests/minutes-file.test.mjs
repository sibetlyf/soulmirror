import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isShrinking, saveMinutes } from '../lib/minutes-file.js'

const dir = mkdtempSync(join(tmpdir(), 'sm-minutes-'))
const file = join(dir, 'minutes.md')
const wait = () => new Promise((r) => setTimeout(r, 5))

test('isShrinking：明显变短才拒绝', () => {
  const big = 'x'.repeat(2000)
  assert.equal(isShrinking(big, 'x'.repeat(100)), true, '5% 的体量应拒绝')
  assert.equal(isShrinking(big, 'x'.repeat(1500)), false, '75% 允许')
  assert.equal(isShrinking('短', 'x'), false, '旧内容本来就小，不拦')
  assert.equal(isShrinking(big, ''), true, '空内容绝不覆盖')
})

test('saveMinutes：完整内容正常覆盖，并留下历史版本', async () => {
  writeFileSync(file, '旧版本'.repeat(200), 'utf8')
  const big = '新版本'.repeat(200)
  const r = await saveMinutes(file, big)
  assert.equal(r.written, true)
  assert.equal(r.path, file)
  assert.equal(readFileSync(file, 'utf8'), big)
  assert.ok(r.archived && r.archived.includes('minutes-'), '应留历史版本')
})

test('saveMinutes：新内容过短时拒绝覆盖，另存为 -short- 版本', async () => {
  const full = '完整纪要'.repeat(300)
  writeFileSync(file, full, 'utf8')
  const tiny = '寒暄两句'
  const r = await saveMinutes(file, tiny)
  assert.equal(r.written, true)
  assert.notEqual(r.path, file, '不应写进原文件')
  assert.match(r.path, /-short-/)
  assert.equal(readFileSync(file, 'utf8'), full, '原纪要必须原样保留')
  assert.equal(readFileSync(r.path, 'utf8'), tiny)
})

test('saveMinutes：空内容不写', async () => {
  writeFileSync(file, '已有内容'.repeat(100), 'utf8')
  const r = await saveMinutes(file, '   ')
  assert.equal(r.written, false)
  assert.match(r.reason, /空/)
})

test('saveMinutes：原子写不会留下临时文件', async () => {
  writeFileSync(file, '正文'.repeat(300), 'utf8')
  await saveMinutes(file, '新正文'.repeat(300))
  await wait()
  const leftovers = readdirSync(dir).filter((f) => f.includes('.tmp-'))
  assert.deepEqual(leftovers, [])
})

test.after(() => {
  try { rmSync(dir, { recursive: true, force: true }) } catch { /* ignore */ }
})
