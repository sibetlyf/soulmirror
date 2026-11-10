import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkScope } from '../scripts/check-scope.mjs'

/**
 * Former regex scanner misread parameter/local scopes and comments as bare fs calls.
 * Use the same real TypeScript scope gate as CI, including missing imports, instead.
 * recTimer and missing mkdir regressions are additionally reproduced in development-rules.
 */
test('所有产品 JS 的名字来源和块作用域通过真实 TS gate', () => {
  const r = checkScope()
  assert.equal(r.unavailable, undefined, r.error || 'TypeScript gate must not silently skip')
  assert.equal(r.ok, true, r.problems.map((p) => `${p.file}:${p.line} ${p.message}`).join('\n'))
})
