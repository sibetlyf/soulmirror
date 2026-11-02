import { test } from 'node:test'
import assert from 'node:assert/strict'

/**
 * "在会中"的判定，除了看窗口，还要看麦克风被谁占用。
 * 移动会议的会中窗口标题仍然叫「移动会议」，单看标题永远认不出来。
 */

function micHeldBy(rows, app) {
  const proc = String((app && app.proc) || '').toLowerCase()
  for (const r of rows || []) {
    if (Number(r.state) !== 1) continue
    if (proc && String(r.proc || '').toLowerCase() === proc) return r.proc
  }
  const appName = String((app && app.name) || '')
  for (const r of rows || []) {
    if (Number(r.state) !== 1) continue
    const label = String((r.proc || '') + ' ' + (r.device || ''))
    if (appName && label.includes(appName)) return label
  }
  return ''
}

test('移动会议占着麦克风 → 判定在会中', () => {
  const rows = [{ device: '麦克风阵列', pid: 33672, proc: 'CloudVideo', state: 1 }]
  assert.equal(micHeldBy(rows, { name: '移动会议', proc: 'CloudVideo' }), 'CloudVideo')
})

test('腾讯会议占着麦克风 → 判定在会中', () => {
  const rows = [{ device: '麦克风阵列', pid: 50068, proc: 'wemeetapp', state: 1 }]
  assert.ok(micHeldBy(rows, { name: '腾讯会议', proc: 'wemeetapp' }))
})

test('进程名对不上但设备名带软件名 → 也算', () => {
  const rows = [{ device: '移动会议虚拟设备', pid: 999, proc: 'other', state: 1 }]
  assert.ok(micHeldBy(rows, { name: '移动会议', proc: 'CloudVideo' }))
})

test('state 不是 1（未占用/未激活）不算', () => {
  const rows = [{ device: 'x', pid: 1, proc: 'CloudVideo', state: 0 }]
  assert.equal(micHeldBy(rows, { name: '移动会议', proc: 'CloudVideo' }), '')
})

test('别的软件占麦克风不会误判', () => {
  const rows = [{ device: 'x', pid: 2, proc: 'chrome', state: 1 }]
  assert.equal(micHeldBy(rows, { name: '移动会议', proc: 'CloudVideo' }), '')
})

test('没有麦克风占用记录时返回空', () => {
  assert.equal(micHeldBy([], { name: '移动会议', proc: 'CloudVideo' }), '')
  assert.equal(micHeldBy(null, { name: '移动会议' }), '')
})
