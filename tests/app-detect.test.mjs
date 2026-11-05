import { test } from 'node:test'
import assert from 'node:assert/strict'
import { rankApps, pickApp, appIsActive, BIG_WINDOW_AREA } from '../lib/app-detect.js'

const APPS = [
  { name: '腾讯会议', proc: 'wemeetapp', title: '腾讯会议' },
  { name: '移动会议', proc: 'CloudVideo', title: '移动会议' },
]

// 真实事故现场：腾讯会议主窗口开着（BaseDialog），但用户在用移动会议
const WEMEET_HOME = { proc: 'wemeetapp', cls: 'BaseDialog', title: '腾讯会议', w: 937, h: 637 }
const CLOUD_IN_MEETING = { proc: 'CloudVideo', cls: 'VideoMainWindow', title: '移动会议', w: 1440, h: 960 }

test('只开着腾讯会议首页、在移动会议里开会 → 选移动会议', () => {
  const got = pickApp({ apps: APPS, windows: [WEMEET_HOME, CLOUD_IN_MEETING] })
  assert.equal(got.app.name, '移动会议')
  assert.ok(got.reasons.includes('有会议中窗口'))
})

test('两个都只是首页 → 前台决定，不再按配置顺序硬取腾讯会议', () => {
  const a = { proc: 'wemeetapp', cls: 'BaseDialog', title: '腾讯会议', w: 937, h: 637 }
  const b = { proc: 'CloudVideo', cls: 'MainWindow', title: '移动会议', w: 1440, h: 960 }
  const got = pickApp({ apps: APPS, windows: [a, b], foregroundProc: 'CloudVideo.exe' })
  assert.equal(got.app.name, '移动会议')
  assert.ok(got.reasons.includes('在前台'))
})

test('占着麦克风是强信号（比"窗口开着"更可信）', () => {
  const got = pickApp({ apps: APPS, windows: [WEMEET_HOME, { proc: 'CloudVideo', cls: 'MainWindow', title: '移动会议', w: 1440, h: 960 }], micProcs: ['cloudvideo'] })
  assert.equal(got.app.name, '移动会议')
  assert.ok(got.reasons.includes('占着麦克风'))
})

test('proc 带不带 .exe 都能对上（Windows 两种写法都见过）', () => {
  const got = pickApp({ apps: APPS, windows: [{ proc: 'CloudVideo.exe', cls: 'VideoMainWindow', title: '移动会议', w: 1440, h: 960 }] })
  assert.equal(got.app.name, '移动会议')
})

test('没有任何证据时返回 null，让调用方按旧规则兜底（不瞎选）', () => {
  assert.equal(pickApp({ apps: APPS, windows: [] }), null)
  assert.equal(pickApp({ apps: APPS, windows: [{ proc: 'notepad', cls: 'Notepad', title: '无标题', w: 400, h: 300 }] }), null)
})

test('托盘小窗不算"正常可见"', () => {
  const small = { proc: 'CloudVideo', cls: 'MainWindow', title: '移动会议', w: 200, h: 120 }
  const ranked = rankApps({ apps: APPS, windows: [small] })
  assert.equal(ranked[0].reasons.includes('窗口正常可见'), false)
  assert.equal(200 * 120 >= BIG_WINDOW_AREA, false, '这个面积本来就该判为小窗')
})

test('界面上的 active 标记和选择结果一致', () => {
  const ctx = { windows: [WEMEET_HOME, CLOUD_IN_MEETING] }
  assert.equal(appIsActive(APPS[1], ctx), true, '移动会议应标为在用')
  assert.equal(appIsActive({ name: 'Zoom', proc: 'zoom' }, ctx), false)
})

test('同分时保持配置顺序（结果稳定，不抖动）', () => {
  const ranked = rankApps({ apps: APPS, windows: [{ proc: 'wemeetapp', title: '腾讯会议', w: 1440, h: 960 }, { proc: 'CloudVideo', title: '移动会议', w: 1440, h: 960 }] })
  assert.equal(ranked[0].score, ranked[1].score)
  assert.equal(ranked[0].app.name, '腾讯会议', '同分应按配置顺序')
})
