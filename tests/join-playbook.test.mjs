/**
 * 入会经验库（join-playbook）单测。
 *
 * 用户要求：每次 computer-use 入会成功后把过程简要落盘、及时更新，以便下次更快。
 * 这里只测纯逻辑：去重/置顶/上限/提示词/回报解析/坏文件兜底。不碰真实桌面。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  emptyPlaybook, loadPlaybook, savePlaybook, upsertEntry, findEntry,
  buildPlaybookHint, parseVisualReport, playbookKey, PLAYBOOK_MAX,
} from '../lib/join-playbook.js'

function tmp() {
  const dir = mkdtempSync(join(tmpdir(), 'sm-playbook-'))
  return { dir, file: join(dir, 'join-playbook.json'), clean: () => rmSync(dir, { recursive: true, force: true }) }
}

test('坏文件/空文件都退回空库，不抛', () => {
  const t = tmp()
  try {
    assert.deepEqual(loadPlaybook(t.file), emptyPlaybook(), '文件不存在')
    writeFileSync(t.file, '{ 不是 JSON')
    assert.deepEqual(loadPlaybook(t.file), emptyPlaybook(), '损坏 JSON 不应抛')
    writeFileSync(t.file, '{"version":1}')
    assert.deepEqual(loadPlaybook(t.file), emptyPlaybook(), '缺 entries 退回空库')
  } finally { t.clean() }
})

test('同客户端同窗口尺寸覆盖并置顶，成功次数累加', () => {
  const win = { w: 1516, h: 988 }
  let store = upsertEntry(emptyPlaybook(), { app: '腾讯会议', win, steps: ['点「加入会议」'], at: '2026-11-19T06:00:00Z' })
  assert.equal(store.entries.length, 1)
  assert.equal(store.entries[0].successes, 1)

  store = upsertEntry(store, { app: '腾讯会议', win, steps: ['点「加入会议」', '输入会议号'], at: '2026-11-19T07:00:00Z' })
  assert.equal(store.entries.length, 1, '同键必须覆盖而不是新增')
  assert.equal(store.entries[0].successes, 2, '成功次数要累加')
  assert.deepEqual(store.entries[0].steps, ['点「加入会议」', '输入会议号'], '步骤要更新为最新')
  assert.equal(store.entries[0].at, '2026-11-19T07:00:00Z', '时间要更新')

  // 不同窗口尺寸 = 另一条经验
  store = upsertEntry(store, { app: '腾讯会议', win: { w: 1280, h: 720 }, steps: ['点「加入」'] })
  assert.equal(store.entries.length, 2)
  assert.equal(store.entries[0].win.w, 1280, '新条目置顶')
})

test('条数上限：超出丢最旧', () => {
  let store = emptyPlaybook()
  for (let i = 0; i < PLAYBOOK_MAX + 5; i++) {
    store = upsertEntry(store, { app: '腾讯会议', win: { w: 1000 + i, h: 700 }, steps: ['第 ' + i + ' 次'] })
  }
  assert.equal(store.entries.length, PLAYBOOK_MAX)
  assert.equal(store.entries[0].win.w, 1000 + PLAYBOOK_MAX + 4, '最新的在最前')
})

test('写入-读取往返，且是带缩进的可读 JSON', () => {
  const t = tmp()
  try {
    const win = { w: 1516, h: 988 }
    let store = upsertEntry(emptyPlaybook(), { app: '腾讯会议', win, steps: ['点「加入会议」'], note: '一次成功' })
    savePlaybook(t.file, store)
    const raw = readFileSync(t.file, 'utf8')
    assert.match(raw, /\n  "entries"/, '应为缩进 JSON（便于人看）')
    const back = loadPlaybook(t.file)
    assert.equal(back.entries.length, 1)
    assert.deepEqual(back.entries[0].win, win)
  } finally { t.clean() }
})

test('提示词：只给匹配窗口尺寸的经验，并强调"对不上以截图为准"', () => {
  const win = { w: 1516, h: 988 }
  let store = emptyPlaybook()
  store = upsertEntry(store, { app: '腾讯会议', win, steps: ['点「加入会议」（约 x=0.25, y=0.26）', '输入会议号'], note: '首页 → 对话框' })
  const hint = buildPlaybookHint(store, { app: '腾讯会议', win })
  assert.match(hint, /1516x988/)
  assert.match(hint, /点「加入会议」/)
  assert.match(hint, /以截图为准/)
  assert.ok(findEntry(store, { app: '腾讯会议', win }))

  // 窗口尺寸不同 → 不套用这条经验
  assert.equal(buildPlaybookHint(store, { app: '腾讯会议', win: { w: 1280, h: 720 } }), '')
  // 别的客户端 → 也不套用
  assert.equal(buildPlaybookHint(store, { app: '移动会议', win }), '')

  const key = playbookKey('腾讯会议', win)
  assert.equal(key, '腾讯会议@1516x988')
})

test('回报解析：RESULT/WIN/STEPS 都能抽出来', () => {
  const text = [
    'RESULT: joined',
    'DETAIL: 点加入后进入会议',
    'EVIDENCE: 亚峰-init 会议 00:12',
    'WIN: 1516x988',
    'STEPS:',
    '- 点「加入会议」（约 x=0.25, y=0.26）',
    '- 输入会议号 969861763',
    '- 点「加入」',
  ].join('\n')
  const r = parseVisualReport(text)
  assert.equal(r.result, 'joined')
  assert.equal(r.detail, '点加入后进入会议')
  assert.equal(r.win.w, 1516)
  assert.equal(r.win.h, 988)
  assert.equal(r.steps.length, 3)
  assert.match(r.steps[0], /加入会议/)

  // 失败回报没有 WIN/STEPS 时也要安全
  const f = parseVisualReport('RESULT: failed\nDETAIL: 找不到按钮')
  assert.equal(f.result, 'failed')
  assert.equal(f.win, null)
  assert.deepEqual(f.steps, [])
})
