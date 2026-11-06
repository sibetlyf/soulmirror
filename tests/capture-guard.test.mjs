import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  looksLikeVirtualDevice, normalizeDeviceName, sameDevice,
  diagnoseCapture, compareCaptureWithLoud, captureVerdict,
} from '../lib/capture-guard.js'

/**
 * 采集设备体检。
 *
 * 一次纠错（写在这里免得以后又判错）：
 *   CABLE Input 是**播放端点**，不是麦克风。App 往它播，我们从它的环回录，
 *   只要会议自己也播到它，这条路径完全成立——这是常见的"内录"做法。
 *
 *   所以规则不是"虚拟声卡不能用"，而是：
 *       采集设备 == 会议当前出声的设备
 *   不一致才会录到静音（哪怕端点本身工作正常）。
 */

test('虚拟端点只当提示，不当错误', () => {
  assert.equal(looksLikeVirtualDevice('CABLE Input (VB-Audio Virtual Cable)'), true)
  assert.equal(looksLikeVirtualDevice('扬声器 (Realtek(R) Audio)'), false)

  const d = diagnoseCapture({ capture: 'CABLE Input', speak: 'CABLE Speaker' })
  assert.equal(d.ok, true, '虚拟端点不是错误')
  assert.equal(d.level, 'warn')
  assert.match(d.suggestion, /要求会议自己也播到这个设备/, '要说清前提条件')
})

test('设备名归一化：去括号、去 input/output、去符号', () => {
  // 括号里的型号会被丢掉，只留主名——这正是比较端点想要的
  assert.equal(normalizeDeviceName('CABLE Input (VB-Audio Virtual Cable)'), 'cable')
  assert.match(normalizeDeviceName('扬声器 (Realtek(R) Audio)'), /^扬声器/)
})

test('sameDevice：同一个端点要认得出来', () => {
  assert.equal(sameDevice('CABLE Input', 'CABLE Input (VB-Audio Virtual Cable)'), true)
  assert.equal(sameDevice('扬声器 (Realtek(R) Audio)', '扬声器'), true)
  assert.equal(sameDevice('耳机 (USB Audio)', '扬声器 (Realtek)'), false)
})

test('实测：会议从扬声器出声，却采 CABLE Input → 真错误，并指名该换成谁', () => {
  const r = compareCaptureWithLoud({
    capture: 'CABLE Input',
    loud: { name: '扬声器 (Realtek(R) Audio)', level: 0.18 },
  })
  assert.equal(r.ok, false)
  assert.equal(r.level, 'error')
  assert.match(r.reason, /扬声器/)
  assert.match(r.reason, /不是同一个端点/)
  assert.match(r.suggestion, /把 devices\.capture 改成「扬声器/)
})

test('实测：会议就播到 CABLE Input（内录）→ 通过', () => {
  const r = compareCaptureWithLoud({
    capture: 'CABLE Input',
    loud: { name: 'CABLE Input (VB-Audio Virtual Cable)', level: 0.2 },
  })
  assert.equal(r.ok, true)
  assert.equal(r.level, 'ok')
})

test('实测：没人在出声时不下结论', () => {
  const r = compareCaptureWithLoud({ capture: 'CABLE Input', loud: { name: '扬声器', level: 0.001 } })
  assert.equal(r.level, 'ok')
})

test('实测：采集为空（走默认）但有设备在响 → 提示显式指定', () => {
  const r = compareCaptureWithLoud({ capture: '', loud: { name: '耳机 (USB Audio)', level: 0.2 } })
  assert.equal(r.level, 'warn')
  assert.match(r.suggestion, /耳机/)
})

test('停止时判定：全静音要能说出来', () => {
  assert.match(captureVerdict({ bytes: 0 }).verdict, /没有采到任何数据/)
  assert.match(captureVerdict({ bytes: 1000, silentSec: 1190, durationSec: 1200 }).verdict, /几乎全静音/)
  assert.equal(captureVerdict({ bytes: 1000, silentSec: 150, durationSec: 1200 }).verdict, '')
})
