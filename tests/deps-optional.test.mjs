import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  checkOptionalDeps, featureAllowed, featureGateMessage, packageInstalled,
  installPlugin, OPTIONAL_DEPS,
} from '../lib/deps-optional.js'

const dir = mkdtempSync(join(tmpdir(), 'sm-deps-'))

function fakeInstall(pkg, version = '1.0.0') {
  const p = join(dir, 'node_modules', pkg)
  mkdirSync(p, { recursive: true })
  writeFileSync(join(p, 'package.json'), JSON.stringify({ name: pkg, version }), 'utf8')
}

test('没装任何可选插件时，两个能力都判为未安装', () => {
  const deps = checkOptionalDeps({ profileDir: dir })
  assert.equal(deps.length, OPTIONAL_DEPS.length)
  assert.equal(deps.every((d) => d.installed === false), true)
  assert.equal(featureAllowed('pet', deps), false)
  assert.equal(featureAllowed('knowledge', deps), false)
})

test('装了 dsh-pet 后，只有 pet 放行', () => {
  fakeInstall('dsh-pet')
  const deps = checkOptionalDeps({ profileDir: dir })
  assert.equal(featureAllowed('pet', deps), true)
  assert.equal(featureAllowed('knowledge', deps), false)
})

test('拒绝对应的功能时给出可操作的原因', () => {
  const deps = checkOptionalDeps({ profileDir: dir })
  const gate = featureGateMessage('knowledge', deps)
  assert.equal(gate.allowed, false)
  assert.match(gate.message, /知识库未安装/)
  assert.match(gate.message, /dsh-knowledge/)
  // 已装的返回放行且无文案
  assert.equal(featureGateMessage('pet', deps).allowed, true)
  assert.equal(featureGateMessage('pet', deps).message, '')
})

test('空路径与未知 key 不炸', () => {
  assert.equal(packageInstalled('', 'dsh-pet'), false)
  assert.equal(packageInstalled(dir, ''), false)
  assert.equal(featureAllowed('nope', checkOptionalDeps({ profileDir: dir })), false)
  assert.deepEqual(featureGateMessage('nope', []), { allowed: true, message: '' })
})

test('包含包名（scoped）也能识别', () => {
  fakeInstall('@scope/thing')
  assert.equal(packageInstalled(dir, '@scope/thing'), true)
})

test('安装前先校验参数，非法包名/profile 不发命令', async () => {
  const bad1 = await installPlugin({ pkg: 'dsh-pet; rm -rf /', profile: 'web' })
  assert.equal(bad1.ok, false)
  assert.match(bad1.error, /包名不合法/)
  const bad2 = await installPlugin({ pkg: 'dsh-pet', profile: '../evil' })
  assert.equal(bad2.ok, false)
  assert.match(bad2.error, /profile 名不合法/)
})

test('安装失败时把 stderr 带回（命令不存在也是一种失败）', async () => {
  const r = await installPlugin({ pkg: 'dsh-pet', profile: 'web', dshBin: 'definitely-not-a-real-binary-xyz', timeoutMs: 5000 })
  assert.equal(r.ok, false)
  assert.ok(r.error.length > 0)
})

test.after(() => { try { rmSync(dir, { recursive: true, force: true }) } catch { /* ignore */ } })
