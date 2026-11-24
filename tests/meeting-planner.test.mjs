/**
 * 会议计划表（插件自己入会）单测：纯逻辑，不碰真实时钟与文件。
 */
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import {
  emptyPlanner, normalizePlan, addPlan, dueNow, planStatus,
  markJoined, markAttempt, prune, duePlans, DEFAULT_LEAD_MS,
} from '../lib/meeting-planner.js'

const T0 = Date.parse('2026-11-24T16:00:00+08:00')   // 会议开始
const MIN = 60 * 1000

test('归一化：缺开始或缺（链接+会议号）丢弃；时长默认 30 分钟', () => {
  assert.equal(normalizePlan({}), null)
  assert.equal(normalizePlan({ start: '2026-11-24T16:00:00+08:00' }), null, '没有链接也没有会议号要丢弃')
  const p = normalizePlan({ title: '临时会议', code: '808 401 537', url: 'https://meeting.tencent.com/dm/x', start: '2026-11-24T16:00:00+08:00' })
  assert.equal(p.code, '808401537', '会议号只留数字')
  assert.equal(p.startMs, T0)
  assert.equal(p.durationMin, 30)
  assert.equal(p.endMs, T0 + 30 * MIN, '默认 30 分钟')
  assert.equal(p.leadMs, DEFAULT_LEAD_MS, '默认提前 60 秒')
})

test('去重：同会议号+同开始时间只保留一条，新值覆盖', () => {
  const url = 'https://meeting.tencent.com/dm/abc'
  let r = addPlan(emptyPlanner(), { code: '808401537', url, start: T0, title: '旧标题' })
  assert.equal(r.added, true)
  r = addPlan(r.planner, { code: '808401537', url, start: T0, title: '新标题' })
  assert.equal(r.planner.plans.length, 1, '不能重复堆积')
  assert.equal(r.planner.plans[0].title, '新标题')
})

test('触发窗口：提前 leadMs 才 due；太早/已结束/已入会都不 due', () => {
  const plan = normalizePlan({ code: '808401537', start: T0 })
  assert.equal(dueNow(plan, T0 - 2 * MIN).why, 'too-early')
  assert.equal(dueNow(plan, T0 - MIN).due, true, '提前一分钟该入会')
  assert.equal(dueNow(plan, T0 + 5 * MIN).due, true, '会中仍可入会')
  assert.equal(dueNow(plan, T0 + 40 * MIN).why, 'already-ended', '散会后不再点链接')
  const joined = { ...plan, joinedAt: T0 - MIN }
  assert.equal(dueNow(joined, T0).why, 'already-joined')
})

test('状态机：upcoming → due → joined → ended；错过记 missed', () => {
  const plan = normalizePlan({ code: '808401537', start: T0 })
  assert.equal(planStatus(plan, T0 - 10 * MIN), 'upcoming')
  assert.equal(planStatus(plan, T0 - 30 * 1000), 'due')
  assert.equal(planStatus({ ...plan, joinedAt: T0 }, T0 + 10 * MIN), 'joined')
  assert.equal(planStatus({ ...plan, joinedAt: T0 }, T0 + 40 * MIN), 'ended')
  assert.equal(planStatus(plan, T0 + 40 * MIN), 'missed')
})

test('标记：joined 写入时间且幂等；attempt 只加次数不置 joined', () => {
  let r = addPlan(emptyPlanner(), { code: '808401537', start: T0 })
  const id = r.planner.plans[0].id
  let p = markAttempt(r.planner, id, { now: T0 - MIN })
  assert.equal(p.plans[0].joinedAt, 0, '尝试失败不能标记已入会')
  assert.equal(p.plans[0].joinTries, 1)
  p = markJoined(p, id, { now: T0 - 30 * 1000 })
  assert.equal(p.plans[0].joinedAt, T0 - 30 * 1000)
  assert.equal(dueNow(p.plans[0], T0).due, false, '入会成功后不再触发')
})

test('清理：结束 6 小时后的条目被丢弃；duePlans 只返回该入会的', () => {
  let r = addPlan(emptyPlanner(), { code: '808401537', start: T0 })
  const old = prune(r.planner, { now: T0 + 8 * 60 * MIN })
  assert.equal(old.plans.length, 0, '过期计划要清理')

  let q = addPlan(emptyPlanner(), { code: '111222333', start: Date.parse('2026-11-24T18:00:00+08:00') })
  assert.equal(duePlans(q.planner, T0 + 10 * MIN).length, 0, '还没到时间的不该 due')
  q = addPlan(q.planner, { code: '808401537', start: T0 })
  assert.equal(duePlans(q.planner, T0 - 30 * 1000).length, 1, '到点的才算 due')
})

test('wiring：插件自己有巡检定时器与入口工具，且能重复清理', () => {
  const idx = readFileSync(new URL('../index.js', import.meta.url), 'utf8')
  assert.match(idx, /function ensurePlannerTimer\(\)/, '必须有巡检函数')
  assert.match(idx, /setInterval\(async \(\) => \{/, '必须真的定时跑')
  assert.match(idx, /duePlans\(loadPlanner\(\), Date\.now\(\)\)/, '每轮要找"该入会"的计划')
  assert.match(idx, /joinFromPlan\(plan\)/, '到点要自己入会')
  assert.match(idx, /startCapture\('plan'\)/, '入会后要自己开始采集')
  assert.match(idx, /ctx\.effect\(\(\) => \(\) => \{/, '定时器必须可重复清理')
  assert.match(idx, /PLAN_FILE = join\(CONFIG_DIR, 'meetings\.json'\)/, '计划要落盘，重启仍在')
  assert.match(idx, /name: 'meeting_plan_add'/, '必须有"把会议交给插件"的工具')
  assert.match(idx, /ensurePlannerTimer\(\)/, '加计划后立刻拉起巡检')
})

test('wiring：入会成功要打标 joinedByUs，自动停止才能据此否决误判', () => {
  const idx = readFileSync(new URL('../index.js', import.meta.url), 'utf8')
  assert.match(idx, /let joinedByUsAt = 0/, '必须有"我们自己入会"的时间戳')
  assert.match(idx, /joinedByUsAt = Date\.now\(\)/, '入会成功要打标')
  assert.match(idx, /joinedByUs: joinedByUsAt > 0/, '证据要带上这个标记')
  assert.match(idx, /clientAlive:/, '证据要带窗口存活')
  const life = readFileSync(new URL('../lib/lifecycle.js', import.meta.url), 'utf8')
  assert.match(life, /joinedByUs && clientAlive/, '规则 0 要在 shouldAutoStop 里')
})

test('wiring：定时交给 DSH schedule，插件不再自己跑定时器', () => {
  const idx = readFileSync(new URL('../index.js', import.meta.url), 'utf8')
  // meeting_plan_add 必须调用 DSH 的 schedule.create（不是插件自己的 setInterval）
  const at = idx.indexOf("name: 'meeting_plan_add'")
  const seg = idx.slice(at, at + 2400)
  assert.match(seg, /scheduleService\(\)/, '必须用 DSH schedule 服务')
  assert.match(seg, /svc\.create\(sid,/, '必须把任务投进 DSH 定时任务')
  assert.match(seg, /buildAttendPrompt\(job\)/, '入会任务用现成提示词')
  assert.match(seg, /收尾/, '必须有收尾任务（停采+整理）')
  assert.match(seg, /ensureAutoAttendSession\(\)/, '要有专用投递会话')
  // 插件加载时不再自动拉起自己的巡检
  assert.equal(/巡检已启动/.test(idx), false, '插件不应自己启动定时巡检')
})
