import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { check } from './ui-shared-contract.mjs'
test('app-source-consistency - shared contract 1 (app)', () => check('app'))
test('app-source-consistency - shared contract 2 (shared)', () => check('shared'))
test('app-source-consistency - shared contract 3 (app)', () => check('app'))
test('app-source-consistency - shared contract 4 (tabs)', () => check('tabs'))

test('显示配置里的每一项都真的被界面执行（不留骗人的开关）', () => {
  const client = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
  for (const key of ['autoOpen', 'width', 'density', 'showDiagnostics']) {
    const used = new RegExp('(?:display|disp)\\.' + key).test(client)
    assert.ok(used, 'display.' + key + ' 没有任何界面在用它')
  }
  assert.match(client, /padding: pad/, 'density 要真的影响留白')
  assert.match(client, /disp\.showDiagnostics === false \? null/, '关掉诊断就真的不渲染诊断')
})

