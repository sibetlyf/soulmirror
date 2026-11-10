import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildViewModel, normalizeDisplay } from '../lib/view-model.js'

test('durable state wins over contradictory runtime flags', () => {
  const v = buildViewModel({ journal: { enabled: true, capturing: false, lastSeq: 7 }, runtime: { enabled: false, session: { capturing: true } } })
  assert.equal(v.capturing, false)
  assert.equal(v.enabled, true)
  assert.equal(v.primary.action, 'record')
  assert.equal(v.durableSeq, 7)
})
test('pipeline error has stage, retry and actionable detail', () => {
  const v = buildViewModel({ journal: { runs: { x: { run: 'x', phase: 'error', error: '401 无效 Key', step: 'offline', steps: { offline: { state: 'error', detail: '401 无效 Key' } } } } } })
  assert.equal(v.tone, 'error')
  assert.match(v.detail, /401/)
  assert.equal(v.primary.action, 'offline')
  assert.equal(v.primary.restart, false)
  assert.equal(v.steps[0].stateLabel, '失败')
})
test('clock estimated percentage is never presented as measured progress', () => {
  const v = buildViewModel({ journal: { runs: { x: { run: 'x', phase: 'running', step: 'offline', percent: 79, steps: { offline: { state: 'running' } } } } } })
  assert.equal(v.steps[0].progress, null)
  assert.equal(v.primary.disabled, true)
})
test('active queue run selected before historical currentRun', () => {
  const v = buildViewModel({ journal: { currentRun: 'old', runs: { old: { run: 'old', phase: 'done' }, new: { run: 'new', phase: 'running', step: 'minutes' } } }, runtime: { pipelineQueue: { current: { dir: 'new' }, queue: [{ dir: 'other' }] } } })
  assert.equal(v.run.dir, 'new')
  assert.equal(v.queueCount, 1)
})
test('display is normalized once for every surface', () => {
  const d = normalizeDisplay({ width: 9999, activityLimit: 1, showActivity: false })
  assert.equal(d.width, 640)
  assert.equal(d.activityLimit, 5)
  assert.equal(buildViewModel({ display: d, journal: { activity: [{ text: 'secret' }] } }).activity.length, 0)
})
test('model defaults and runtime errors are visible without custom endpoint assumption', () => {
  const v = buildViewModel({ runtime: { lastLlmError: { message: '模型超时' }, host: { stale: true } } })
  assert.ok(v.diagnostics.some((d) => /DSH 会话/.test(d.value)))
  assert.ok(v.diagnostics.some((d) => d.id === 'model-error' && /超时/.test(d.value)))
  assert.ok(v.diagnostics.some((d) => d.id === 'host' && /重启/.test(d.value)))
})
test('落盘后的模型快照要显示真实来源，不能一律说"跟随当前会话"', () => {
  const sel = { provider: 'prov', model: 'meeting-model', source: 'dsh-default' }
  const v = buildViewModel({ journal: { runs: { '/m/one': { run: '/m/one', phase: 'done', steps: {}, model: sel, lastSeq: 3 } }, models: sel } })
  const row = v.diagnostics.find((d) => d.id === 'model')
  assert.match(row.value, /prov\/meeting-model/)
  assert.match(row.value, /DSH 默认/, '要说出是哪种来源')
  assert.doesNotMatch(row.value, /当前会话/)
})
