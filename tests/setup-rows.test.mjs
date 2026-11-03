import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildSetupRows, summarizeSetup, setupHint } from '../lib/setup-rows.js'

test('全部就绪时 ok=true 且没有缺项', () => {
  const rows = buildSetupRows({
    config: true, bridge: true, key: true, captureDevice: '扬声器', virtualMic: true, calibrated: true,
  })
  assert.equal(summarizeSetup(rows).ok, true)
  assert.match(setupHint(rows), /配置齐全/)
})

test('缺项时逐条列出，并给出按钮动作', () => {
  const rows = buildSetupRows({ config: true, bridge: true, key: false, captureDevice: '', virtualMic: false })
  const s = summarizeSetup(rows)
  assert.equal(s.ok, false)
  assert.deepEqual(s.ids, ['key', 'device', 'vm'], '顺序应与展示一致')
  const hint = setupHint(rows)
  assert.match(hint, /还差 3 项/)
  assert.match(hint, /密钥可以留空/, '必须明确告诉用户密钥可留空')
})

test('每项都带 id / what / fix / action', () => {
  const rows = buildSetupRows({})
  for (const r of rows) {
    assert.ok(r.id && r.what && r.fix, '字段不全：' + JSON.stringify(r))
    assert.ok(r.action, r.id + ' 缺少可执行动作')
  }
})

test('虚拟声卡标记为必须人工（UAC）', () => {
  const vm = buildSetupRows({}).find((r) => r.id === 'vm')
  assert.equal(vm.manual, true)
  assert.match(vm.fix, /UAC/)
})

test('密钥项文案说明可留空，避免被当成必填阻断', () => {
  const key = buildSetupRows({ key: false }).find((r) => r.id === 'key')
  assert.match(key.fix, /可以不填/)
  assert.equal(key.ok, false)
})

test('采集设备为空白字符串也算缺', () => {
  const rows = buildSetupRows({ captureDevice: '   ' })
  assert.equal(rows.find((r) => r.id === 'device').ok, false)
})

test('标定状态 unknown 不误报（calibrated 未传则视为就绪）', () => {
  const rows = buildSetupRows({})
  assert.equal(rows.find((r) => r.id === 'calib').ok, true)
  const rows2 = buildSetupRows({ calibrated: false })
  assert.equal(rows2.find((r) => r.id === 'calib').ok, false)
})
