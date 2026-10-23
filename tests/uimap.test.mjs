import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { UiMap, pixelToRatio, ratioToPixel, validRatio, probeOffsets, ACTIONS } from '../lib/uimap.js'

const tmp = () => mkdtempSync(join(tmpdir(), 'sm-uimap-'))

test('validRatio 只接受 0~1 之间', () => {
  assert.equal(validRatio(0.3, 0.4), true)
  assert.equal(validRatio(0, 0.4), false)
  assert.equal(validRatio(1, 0.4), false)
  assert.equal(validRatio(-0.1, 0.4), false)
  assert.equal(validRatio(NaN, 0.4), false)
  assert.equal(validRatio('a', 0.4), false)
})

test('像素换比例：换台电脑（窗口大小不同）比例一致', () => {
  const a = pixelToRatio(399, 186, 1226, 786)
  const b = pixelToRatio(798, 372, 2452, 1572)
  assert.ok(Math.abs(a.x - b.x) < 0.001)
  assert.ok(Math.abs(a.y - b.y) < 0.001)
  assert.equal(pixelToRatio(10, 10, 0, 0), null)
})

test('比例换像素：能在新窗口上还原', () => {
  const p = ratioToPixel({ x: 0.3255, y: 0.2366 }, { x: 1000, y: 200, w: 800, h: 600 })
  assert.equal(p.x, Math.round(1000 + 800 * 0.3255))
  assert.equal(p.y, Math.round(200 + 600 * 0.2366))
})

test('探测点：先正中，再向外扩，且都在合法范围', () => {
  const offs = probeOffsets(0.02, 1)
  assert.deepEqual(offs[0], { dx: 0, dy: 0 })
  assert.equal(offs.length, 9)
  assert.ok(offs.every((o) => Math.abs(o.dx) <= 0.02 && Math.abs(o.dy) <= 0.02))
})

test('UiMap：存取与持久化', () => {
  const dir = tmp()
  const f = join(dir, 'uimap.json')
  const m = new UiMap(f)
  assert.equal(m.get('腾讯会议', 'join'), null)
  m.set('腾讯会议', 'join', { x: 0.31, y: 0.21 }, { via: 'calibrate' })
  const again = new UiMap(f)
  const hit = again.get('腾讯会议', 'join')
  assert.equal(hit.x, 0.31)
  assert.equal(hit.y, 0.21)
  assert.equal(hit.via, 'calibrate')
  assert.deepEqual(again.list('腾讯会议'), ['join'])
  rmSync(dir, { recursive: true, force: true })
})

test('UiMap：拒绝非法输入与未知动作', () => {
  const dir = tmp()
  const m = new UiMap(join(dir, 'uimap.json'))
  assert.equal(m.set('腾讯会议', 'nope', { x: 0.3, y: 0.3 }), null)
  assert.equal(m.set('', 'join', { x: 0.3, y: 0.3 }), null)
  assert.equal(m.set('腾讯会议', 'join', { x: 2, y: 0.3 }), null)
  assert.equal(m.get('腾讯会议', 'join'), null)
  rmSync(dir, { recursive: true, force: true })
})

test('UiMap：不同软件各存各的', () => {
  const dir = tmp()
  const m = new UiMap(join(dir, 'uimap.json'))
  m.set('腾讯会议', 'join', { x: 0.31, y: 0.21 })
  m.set('移动会议', 'join', { x: 0.5, y: 0.6 })
  assert.notEqual(m.get('腾讯会议', 'join').x, m.get('移动会议', 'join').x)
  rmSync(dir, { recursive: true, force: true })
})

test('动作清单包含入会等常用项', () => {
  for (const a of ['join', 'quick', 'schedule', 'share', 'leave']) assert.ok(ACTIONS.includes(a))
})
