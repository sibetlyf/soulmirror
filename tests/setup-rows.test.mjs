import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildSetupRows, summarizeSetup, setupHint } from '../lib/setup-rows.js'

const ALL_OK = {
  config: true, bridge: true, key: true, keySource: 'config',
  captureDevice: '扬声器', captureAuto: false, virtualMic: true, calibrated: true,
}

test('全部亲自配好时 ok=true 且没有缺项', () => {
  const rows = buildSetupRows(ALL_OK)
  const s = summarizeSetup(rows)
  assert.equal(s.ok, true)
  assert.equal(s.auto, 0)
  assert.match(setupHint(rows), /配置齐全/)
})

test('密钥只来自环境变量时，不算"你配过"（不打勾）', () => {
  const rows = buildSetupRows({ ...ALL_OK, keySource: 'env' })
  const key = rows.find((r) => r.id === 'key')
  assert.equal(key.state, 'auto')
  assert.equal(key.ok, false, '环境变量接管不应显示为已配置')
  assert.match(key.detail, /环境变量/)
})

test('设备是自动跟随时，也不算"你选过"', () => {
  const rows = buildSetupRows({ ...ALL_OK, captureAuto: true })
  const dev = rows.find((r) => r.id === 'device')
  assert.equal(dev.state, 'auto')
  assert.equal(dev.ok, false)
  assert.match(dev.detail, /自动跟随/)
})

test('没配置就显示 missing + 说明怎么补', () => {
  const rows = buildSetupRows({})
  const key = rows.find((r) => r.id === 'key')
  const dev = rows.find((r) => r.id === 'device')
  assert.equal(key.state, 'missing')
  assert.equal(dev.state, 'missing')
  assert.ok(key.fix && dev.fix)
  assert.match(setupHint(rows), /还差/)
})

test('每项都带 id / what / fix / action / detail', () => {
  for (const r of buildSetupRows({})) {
    assert.ok(r.id && r.what && r.fix, '字段不全：' + JSON.stringify(r))
    assert.ok(r.action, r.id + ' 缺少动作')
    assert.equal(typeof r.detail, 'string')
    assert.ok(['ok', 'auto', 'missing'].includes(r.state))
  }
})

test('虚拟声卡标记为必须人工（UAC）', () => {
  const vm = buildSetupRows({}).find((r) => r.id === 'vm')
  assert.equal(vm.manual, true)
  assert.match(vm.fix, /UAC/)
})

test('采集设备为空白字符串也算缺', () => {
  const rows = buildSetupRows({ captureDevice: '   ' })
  assert.equal(rows.find((r) => r.id === 'device').state, 'missing')
})

test('标定状态 unknown 不误报', () => {
  assert.equal(buildSetupRows({}).find((r) => r.id === 'calib').state, 'ok')
  assert.equal(buildSetupRows({ calibrated: false }).find((r) => r.id === 'calib').state, 'missing')
})

test('全部自动接管时提示"可以用了"并列出是哪几项', () => {
  const rows = buildSetupRows({
    config: true, bridge: true, key: true, keySource: 'env',
    captureDevice: '扬声器', captureAuto: true, virtualMic: true, calibrated: true,
  })
  const s = summarizeSetup(rows)
  assert.equal(s.ok, true)
  assert.equal(s.auto, 2)
  const hint = setupHint(rows)
  assert.match(hint, /可以用了/)
  assert.match(hint, /语音识别密钥/)
  assert.match(hint, /采集设备/)
})
