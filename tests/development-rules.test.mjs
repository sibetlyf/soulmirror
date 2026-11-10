import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkScope, loadTypeScript } from '../scripts/check-scope.mjs'

function fixture(t, text) {
  const root = mkdtempSync(join(tmpdir(), 'soulmirror-scope-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const file = join(root, 'scope.js')
  writeFileSync(file, text, 'utf8')
  return file
}

test('scope gate reproduces recTimer finally scope regression', (t) => {
  const f = fixture(t, 'export function fail() { try { const recTimer = setInterval(() => {}, 2) } finally { clearInterval(recTimer) } }')
  const r = checkScope([f])
  assert.equal(r.unavailable, undefined, r.error)
  assert.equal(r.ok, false)
  assert.ok(r.problems.some((p) => p.name === 'recTimer'))
})

test('scope gate accepts timer declared in cleanup-visible scope', (t) => {
  const f = fixture(t, 'export function pass() { let recTimer; try { recTimer = setInterval(() => {}, 2) } finally { clearInterval(recTimer) } }')
  assert.equal(checkScope([f]).ok, true)
})

test('scope gate rejects a missing import and malformed syntax', (t) => {
  const f = fixture(t, 'export function fail() { return missingImport() }')
  assert.ok(checkScope([f]).problems.some((p) => p.name === 'missingImport'))
  writeFileSync(f, 'export function fail( {', 'utf8')
  assert.equal(checkScope([f]).ok, false)
})

test('missing compiler and missing input fail closed', (t) => {
  const f = fixture(t, 'export const fine = true')
  const r = checkScope([f], { loadCompiler: () => null })
  assert.equal(r.ok, false)
  assert.equal(r.unavailable, true)
  assert.match(r.error, /未执行/)
  assert.equal(checkScope([join(f, 'does-not-exist')]).unavailable, true)
  assert.equal(loadTypeScript({ requireFn: () => { throw new Error('not installed') } }), null)
})

test('checker never shells out to discover global npm and scripts do not force exit', () => {
  const src = readFileSync(new URL('../scripts/check-scope.mjs', import.meta.url), 'utf8')
  assert.doesNotMatch(src, /import .*child_process|execSync\(|spawn\(/)
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  assert.doesNotMatch(JSON.stringify(pkg.scripts), /--test-force-exit/)
  assert.equal(pkg.scripts['check:scope'], 'node scripts/check-scope.mjs')
})

test('development rules require persistence, isolated tests, model inheritance and release proof', () => {
  const rules = readFileSync(new URL('../AGENTS.md', import.meta.url), 'utf8')
  for (const text of ['先复现', 'mkdtemp', '先落盘', '不静默回退', 'DSH 会话模型', '禁止自动入会', '发布读回证据']) {
    assert.ok(rules.includes(text), text)
  }
  const keyTest = readFileSync(new URL('./key-consistency.test.mjs', import.meta.url), 'utf8')
  assert.match(keyTest, /mkdtempSync/)
  assert.match(keyTest, /s\._streamLoop = async/)
  assert.doesNotMatch(keyTest, /dataDir:\s*''/)
})
