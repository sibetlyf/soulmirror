import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  APP_PRESETS, normalizeApps, mergeApp, scoreWindow, detectRunningApps,
  pickAutoApp, inferProc, listPresets,
} from '../lib/apps.js'

const WIN = (proc, title, cls = 'BaseDialog') => ({ proc, title, cls })

test('预设覆盖腾讯会议 / 移动会议 / 飞书 / 钉钉', () => {
  const names = APP_PRESETS.map((p) => p.name)
  assert.ok(names.includes('腾讯会议'))
  assert.ok(names.includes('移动会议'))
  assert.ok(names.includes('飞书会议'))
  assert.ok(names.includes('钉钉会议'))
  assert.ok(listPresets().every((p) => Array.isArray(p.procs) && p.procs.length > 0))
})

test('normalizeApps：配置项补全预设信息，去重', () => {
  const list = normalizeApps([
    { name: '腾讯会议', proc: 'wemeetapp' },
    { name: '腾讯会议', proc: 'dup' },
    { name: '我的会议', proc: 'MyMeeting' },
  ])
  assert.equal(list.length, 2)
  const wemeet = list.find((a) => a.name === '腾讯会议')
  assert.ok(wemeet.preset)
  assert.ok(wemeet.titleHints.includes('腾讯会议'))
  const custom = list.find((a) => a.name === '我的会议')
  assert.equal(custom.preset, false)
  assert.equal(custom.proc, 'MyMeeting')
})

test('normalizeApps：空配置时给默认两款', () => {
  const list = normalizeApps([])
  assert.ok(list.length >= 2)
  assert.equal(list[0].name, '腾讯会议')
})

test('scoreWindow：进程精确 > 进程相似 > 标题 > 类名', () => {
  const app = mergeApp({ name: '腾讯会议' })
  assert.equal(scoreWindow(WIN('wemeetapp', '某某会议'), app), 100)
  assert.equal(scoreWindow(WIN('TencentMeeting2', '随便'), app), 80)
  assert.equal(scoreWindow(WIN('other', '腾讯会议 - 快速会议'), app), 60)
  assert.equal(scoreWindow(WIN('other', '无关', 'FloatSpeakingWnd'), app), 40)
  assert.equal(scoreWindow(WIN('chrome', '网页'), app), 0)
})

test('detectRunningApps：识别出在跑的会议软件并给置信度', () => {
  const wins = [WIN('wemeetapp', '李亚峰的快速会议'), WIN('chrome', '其它')]
  const found = detectRunningApps(wins, [{ name: '腾讯会议', proc: 'wemeetapp' }])
  assert.equal(found.length, 1)
  assert.equal(found[0].app.name, '腾讯会议')
  assert.equal(found[0].confidence, 'exact')
})

test('detectRunningApps：进程名大小写不敏感', () => {
  const found = detectRunningApps([WIN('CloudVideo', '移动会议')], [{ name: '移动会议', proc: 'CloudVideo' }])
  assert.equal(found.length, 1)
})

test('pickAutoApp：多个在跑时选分数最高的', () => {
  const apps = [{ name: '腾讯会议', proc: 'wemeetapp' }, { name: '移动会议', proc: 'CloudVideo' }]
  const wins = [WIN('other', '移动会议 视频'), WIN('wemeetapp', '腾讯会议')]
  const best = pickAutoApp(wins, apps)
  assert.equal(best.app.name, '腾讯会议')
})

test('pickAutoApp：没有会议在跑时返回 null', () => {
  assert.equal(pickAutoApp([WIN('chrome', '浏览器')], [{ name: '腾讯会议', proc: 'wemeetapp' }]), null)
})

test('inferProc：从未配置预设的窗口反推进程名', () => {
  const preset = { name: '飞书会议', procs: ['Feishu'], titleHints: ['飞书'], classHints: [] }
  const proc = inferProc([WIN('FeishuApp', '飞书会议 - 周会')], preset)
  assert.equal(proc, 'FeishuApp')
})

test('未来接入：给飞书/钉钉补一条配置即可被识别', () => {
  const apps = [{ name: '飞书会议', proc: 'Feishu' }, { name: '钉钉会议', proc: 'DingTalk' }]
  const found = detectRunningApps([WIN('Feishu', '飞书会议'), WIN('DingTalk', '钉钉会议')], apps)
  assert.equal(found.length, 2)
  const names = found.map((f) => f.app.name)
  assert.ok(names.includes('飞书会议'))
  assert.ok(names.includes('钉钉会议'))
})
