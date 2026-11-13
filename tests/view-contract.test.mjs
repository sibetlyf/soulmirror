/**
 * 界面状态契约：primary 状态机 / elapsedSec / meetingDurationSec / issues 与 notices 分流 /
 * 工作台源码契约（act、fmtDuration、live.demo、首屏折叠、IssueBanner 顺序）。
 *
 * 这些都是"用户看到什么"的约定，所以断言值用真实文案，不做模糊匹配：
 * 文案一改，这里必须一起改，避免状态悄悄退回"完成态还给立即开始录音"那类缺陷。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildViewModel } from '../lib/view-model.js'
import { loadUI, nodes, text, source } from './ui-harness.mjs'

/** 七种状态的最小 journal/runtime 输入（不含任何 runtime 诊断噪声）。 */
const STATE_INPUTS = {
  capturing: () => ({
    journal: { capturing: true, currentRun: 'rec', runs: { rec: { run: 'rec', phase: 'recording', startedAt: '2026-11-10T08:00:00Z' } } },
    runtime: { now: Date.parse('2026-11-10T08:01:15Z') },
  }),
  done: () => ({ journal: { runs: { done: { run: 'done', phase: 'done' } } } }),
  error: () => ({ journal: { runs: { err: { run: 'err', phase: 'error', error: '401 无效 Key', step: 'offline' } } } }),
  queued: () => ({ journal: { runs: { q: { run: 'q', phase: 'queued' } } } }),
  working: () => ({ journal: { runs: { w: { run: 'w', phase: 'running', step: 'offline' } } } }),
  unconfigured: () => ({ journal: {}, runtime: { bridge: { ok: false } } }),
  idle: () => ({ journal: {}, runtime: {} }),
}

function build(name) {
  const input = STATE_INPUTS[name]()
  return buildViewModel({ journal: input.journal, runtime: input.runtime })
}

/** 用 ui-harness 真的渲染工作台（fake React 会执行组件函数，所以是行为断言而不是源码断言）。 */
function renderWorkspace(ui, view, extra = {}) {
  ui.live.set(Object.assign({ view, transcript: [{ t: '2026-11-10T08:00:00Z', text: '已保存转写' }] }, extra))
  ui.store.set(true)
  return ui.MeetingPage({})
}

// ─────────────────────── 1. primary 状态机 ───────────────────────

test('primary：采集中 → stop「结束录音并整理」', () => {
  const p = build('capturing').primary
  assert.equal(p.id, 'stop')
  assert.equal(p.action, 'stop')
  assert.equal(p.label, '结束录音并整理')
  assert.equal(p.disabled, false)
})

test('primary：run.phase=done → minutes「看纪要」', () => {
  const p = build('done').primary
  assert.equal(p.id, 'minutes')
  assert.equal(p.action, 'minutes')
  assert.equal(p.label, '看纪要')
  assert.equal(p.disabled, false)
})

test('primary：run.phase=error → offline「重试失败步骤」（restart:false）', () => {
  const v = build('error')
  assert.equal(v.primary.id, 'retry')
  assert.equal(v.primary.action, 'offline')
  assert.equal(v.primary.label, '重试失败步骤')
  assert.equal(v.primary.dir, 'err')
  assert.equal(v.primary.restart, false)
  assert.equal(v.primary.disabled, false)
})

test('primary：run.phase=queued → offline「开始整理」（restart:false）', () => {
  const v = build('queued')
  assert.equal(v.primary.id, 'organize')
  assert.equal(v.primary.action, 'offline')
  assert.equal(v.primary.label, '开始整理')
  assert.equal(v.primary.dir, 'q')
  assert.equal(v.primary.restart, false)
})

test('primary：整理中 → 可点的「开始录音」（整理在后台，不能变成死按钮）', () => {
  const v = build('working')
  assert.equal(v.working, true, '整理中状态本身要在 view 上可见（进度由步骤条展示）')
  assert.equal(v.primary.id, 'record')
  assert.equal(v.primary.label, '开始录音')
  assert.equal(v.primary.action, 'record')
  assert.equal(v.primary.disabled, false, '主按钮永远可点：整理是后台任务，不该挡住下一场录音')
  assert.equal((v.secondary || []).length, 0, '主按钮已经是开始录音时不要再重复')
})

test('primary：未配置 → settings「去配置」（三条证据任一条都算）', () => {
  const evidences = [
    { bridge: { ok: false } },
    { config: { keyErrors: { asr: '缺少 DASHSCOPE_API_KEY' } } },
    { lastPreflight: { checks: [{ id: 'asr-key', ok: false, fatal: true }] } },
  ]
  for (const runtime of evidences) {
    const v = buildViewModel({ journal: {}, runtime })
    assert.equal(v.configured, false, 'configured 必须是 false：' + JSON.stringify(runtime))
    assert.equal(v.primary.id, 'setup')
    assert.equal(v.primary.action, 'settings')
    assert.equal(v.primary.label, '去配置')
    assert.equal(v.primary.disabled, false)
  }
})

test('primary：空闲且已配置 → record「立即开始录音」', () => {
  const v = build('idle')
  assert.equal(v.configured, true)
  assert.equal(v.primary.id, 'record')
  assert.equal(v.primary.action, 'record')
  assert.equal(v.primary.label, '立即开始录音')
  assert.equal(v.primary.disabled, false)
})

test('primary：旧缓存 config.keys.asr=false 不算"未配置"（否则会把能录的人误判成去配置）', () => {
  const v = buildViewModel({
    journal: {},
    // 环境变量里的 Key 由宿主解析，这份缓存可能是旧的；只有 keyErrors / 致命体检 / 桥接失败才算证据
    runtime: { config: { keys: { asr: false, llm: false } }, bridge: { ok: true } },
  })
  assert.equal(v.configured, true)
  assert.equal(v.primary.action, 'record')
  assert.equal(v.primary.label, '立即开始录音')
})

test('primary：record 只出现在「空闲且已配置」与「后台整理中」（其余状态各有明确下一步）', () => {
  const names = Object.keys(STATE_INPUTS)
  const recordStates = names.filter((n) => build(n).primary.action === 'record')
  assert.deepEqual(recordStates.sort(), ['idle', 'working'].sort(),
    'record 只该在空闲(已配置)和后台整理中出现：完成态给看纪要、排队给开始整理、出错给重试、未配置给去配置')
  for (const name of names) {
    const p = build(name).primary
    assert.equal(!!p.disabled, false, name + ' 的主按钮不能是不可点的死按钮')
    if (p.action !== 'record') assert.notEqual(p.label, '立即开始录音', name + ' 不该再出现「立即开始录音」')
  }
})

// ─────────────────────── 2. elapsedSec 语义 ───────────────────────

test('elapsedSec：采集中是数字，等于本次录音时长（向下取整）', () => {
  const v = buildViewModel({
    journal: { capturing: true, currentRun: 'rec', runs: { rec: { run: 'rec', phase: 'recording', startedAt: '2026-11-10T08:00:00Z' } } },
    runtime: { now: Date.parse('2026-11-10T08:01:15.900Z') },
  })
  assert.equal(typeof v.elapsedSec, 'number')
  assert.equal(v.elapsedSec, 75)
})

test('elapsedSec：非采集中严格 null（没有"上一场的墙钟"可用）', () => {
  for (const name of ['done', 'error', 'queued', 'working', 'unconfigured', 'idle']) {
    assert.strictEqual(build(name).elapsedSec, null, name + ' 的 elapsedSec 必须是 null，而不是 0 或墙钟')
  }
  // 墙钟回归：排队中的上一场 startedAt 很早，也不能冒出一个越来越大的数
  const v = buildViewModel({
    journal: { capturing: false, currentRun: 'prev', runs: { prev: { run: 'prev', phase: 'queued', startedAt: '2026-11-10T07:00:00Z' } } },
    runtime: { now: Date.parse('2026-11-10T09:00:00Z') },
  })
  assert.strictEqual(v.elapsedSec, null)
})

test('elapsedSec：上一场 queued + 当前 recording，不会把上一场时间当本次（真实修过的 bug）', () => {
  const v = buildViewModel({
    journal: {
      capturing: true,
      currentRun: 'cur',
      runs: {
        // 上一场还在排队（lastSeq 更大，排序会排在前面）
        prev: { run: 'prev', phase: 'queued', startedAt: '2026-11-10T07:00:00Z', lastSeq: 9 },
        cur: { run: 'cur', phase: 'recording', startedAt: '2026-11-10T09:00:00Z', lastSeq: 2 },
      },
    },
    runtime: {
      now: Date.parse('2026-11-10T09:00:30Z'),
      pipelineQueue: { current: { dir: 'prev' }, queue: [{ dir: 'prev' }] },
      recording: { dir: 'cur', seconds: 125 },
    },
  })
  assert.equal(v.run.dir, 'cur', '采集中必须看正在录的这一场')
  assert.equal(v.primary.action, 'stop')
  assert.equal(v.elapsedSec, 30, '应该是本次录音 30 秒，而不是上一场的 7200 秒')
  assert.notEqual(v.elapsedSec, 7200)
  assert.equal(v.meetingDurationSec, 125, '这场会的时长也只认当前录音')
})

// ─────────────────────── 3. meetingDurationSec ───────────────────────

test('meetingDurationSec：优先真实录音时长，而不是开始/结束的墙钟差', () => {
  const v = buildViewModel({
    journal: { runs: { r: { run: 'r', phase: 'done', startedAt: '2026-11-10T08:00:00Z', stoppedAt: '2026-11-10T10:15:03Z' } } },
    runtime: { recording: { dir: 'r', seconds: 998 } },
  })
  assert.equal(v.meetingDurationSec, 998)
  assert.notEqual(v.meetingDurationSec, 8103, '墙钟差 8103 秒不是录音时长')
})

test('meetingDurationSec：录音属于别的目录时回退到本场 run 的起止', () => {
  const v = buildViewModel({
    journal: { runs: { r: { run: 'r', phase: 'done', startedAt: '2026-11-10T08:00:00Z', stoppedAt: '2026-11-10T10:15:03Z' } } },
    runtime: { recording: { dir: 'other', seconds: 998 } },
  })
  assert.equal(v.meetingDurationSec, 8103)
})

test('meetingDurationSec：没有录音也没有起止时间 → null（不编时长）', () => {
  assert.strictEqual(buildViewModel({}).meetingDurationSec, null)
  assert.strictEqual(buildViewModel({ journal: { runs: { r: { run: 'r', phase: 'done' } } } }).meetingDurationSec, null)
  assert.strictEqual(buildViewModel({ journal: { runs: { r: { run: 'r', phase: 'done', startedAt: '2026-11-10T08:00:00Z' } } } }).meetingDurationSec, null)
  const zero = buildViewModel({
    journal: { runs: { r: { run: 'r', phase: 'done' } } },
    runtime: { recording: { dir: 'r', seconds: 0 } },
  })
  assert.strictEqual(zero.meetingDurationSec, null, '0 秒不算真实录音时长')
})

// ─────────────────────── 4. issues / notices 分流 ───────────────────────

test('issues 只留 error/warn，notices 只留 info，tone 映射正确', () => {
  const v = buildViewModel({
    runtime: {
      issues: [
        { id: 'info-1', text: '当前没有检测到会议窗口', level: 'info' },
        { id: 'warn-1', text: '音频静音', level: 'warn' },
        { id: 'err-1', text: '密钥无效', level: 'error' },
        { id: 'sev-info', text: '用 severity 字段的提示', severity: 'info' },
        { id: 'none', text: '没有级别的默认按 warn' },
      ],
    },
  })
  assert.deepEqual(v.issues.map((x) => x.id), ['warn-1', 'err-1', 'none'])
  assert.deepEqual(v.notices.map((x) => x.id), ['info-1', 'sev-info'])
  const tone = Object.fromEntries(v.issues.concat(v.notices).map((x) => [x.id, x.tone]))
  assert.equal(tone['err-1'], 'error')
  assert.equal(tone['warn-1'], 'warning')
  assert.equal(tone['none'], 'warning')
  assert.equal(tone['info-1'], 'info')
  assert.equal(tone['sev-info'], 'info')
})

test('journal 里的 issue 仍进 issues（默认 warning），带 fix 一起带出来', () => {
  const v = buildViewModel({ journal: { issues: { capture: { text: '采集失败：设备被占用', fix: '换一个采集设备' } } } })
  const item = v.issues.find((x) => x.id === 'capture')
  assert.ok(item, 'journal issue 应出现在 issues')
  assert.equal(item.tone, 'warning')
  assert.equal(item.fix, '换一个采集设备')
  assert.equal(v.notices.length, 0)
})

// ─────────────────────── 5. client 源码/渲染契约 ───────────────────────

test('client 契约：act() 的 minutes/settings 只切页签、不发请求', async () => {
  const g = globalThis
  const prevFetch = g.fetch
  const calls = []
  g.fetch = (url) => {
    calls.push(String(url))
    return Promise.resolve({ json: async () => ({ ok: true }) })
  }
  try {
    // 「看纪要」→ 切到纪要页，不发请求
    const ui1 = loadUI()
    const view1 = buildViewModel({ journal: { runs: { d: { run: 'd', phase: 'done' } } } })
    const btn1 = nodes(renderWorkspace(ui1, view1)).find((n) => n.t === 'button' && text(n) === '看纪要')
    assert.ok(btn1, '完成态主按钮应是「看纪要」')
    btn1.p.onClick()
    await new Promise((r) => setTimeout(r, 10))
    assert.deepEqual(calls, [], '「看纪要」不应发请求')

    // 「去配置」→ 切到设置页，不发请求
    const ui2 = loadUI()
    const view2 = buildViewModel({ journal: {}, runtime: { bridge: { ok: false } } })
    const btn2 = nodes(renderWorkspace(ui2, view2)).find((n) => n.t === 'button' && text(n) === '去配置')
    assert.ok(btn2, '未配置时主按钮应是「去配置」')
    btn2.p.onClick()
    await new Promise((r) => setTimeout(r, 10))
    assert.deepEqual(calls, [], '「去配置」不应发请求')

    // 对照：offline 才发请求（否则上面的"零请求"可能是假阳性）
    const ui3 = loadUI()
    const view3 = buildViewModel({ journal: { runs: { e: { run: 'e', phase: 'error', error: '401 无效 Key' } } } })
    const btn3 = nodes(renderWorkspace(ui3, view3)).find((n) => n.t === 'button' && text(n) === '重试失败步骤')
    assert.ok(btn3)
    btn3.p.onClick()
    await new Promise((r) => setTimeout(r, 20))
    assert.deepEqual(calls, ['/api/soulmirror/offline'], 'offline 动作应打 /api/soulmirror/offline')
  } finally {
    if (prevFetch === undefined) delete g.fetch
    else g.fetch = prevFetch
  }

  // 源码层：两条早返回都在 setBusy/fetch 之前
  const actAt = source.indexOf('function act(action) {')
  assert.ok(actAt > 0, '应能找到 act(action)')
  const act = source.slice(actAt, actAt + 1600)
  assert.ok(act.includes("if (action.action === 'minutes') { setTab('minutes'); setNotice(''); return }"), 'minutes 应切到纪要页并返回')
  assert.ok(act.includes("if (action.action === 'settings') { setTab('settings'); setNotice(''); return }"), 'settings 应切到设置页并返回')
  const beforeRequest = act.slice(0, act.indexOf('var url ='))
  assert.ok(beforeRequest.length > 0)
  assert.equal(/fetch\s*\(/.test(beforeRequest), false, '切页签的早返回必须在任何 fetch 之前')
})

test('client 契约：「录音 N 分 N 秒」走 fmtDuration，采集中显示本次录音时长', () => {
  const ui = loadUI()
  const txt = text(renderWorkspace(ui, build('capturing')))
  assert.match(txt, /录音 1 分 15 秒/)
  assert.doesNotMatch(txt, /已用 \d+ 秒/, '旧的墙钟文案「已用 N 秒」必须消失')

  assert.ok(source.includes("'录音 ' + fmtDuration(v.elapsedSec)"), '采集中用 fmtDuration 格式化 elapsedSec')
  assert.ok(source.includes("'录音 ' + fmtDuration(v.meetingDurationSec)"), '非采集中用 fmtDuration 格式化 meetingDurationSec')
  assert.ok(source.includes("return m > 0 ? (m + ' 分 ' + s + ' 秒') : (s + ' 秒')"), 'fmtDuration 必须是「N 分 N 秒」')
})

test('client 契约：非采集中显示这场会真实录音时长；没有就不显示', () => {
  const ui = loadUI()
  const view = buildViewModel({
    journal: { runs: { r: { run: 'r', phase: 'done', startedAt: '2026-11-10T08:00:00Z', stoppedAt: '2026-11-10T08:10:00Z' } } },
  })
  assert.strictEqual(view.elapsedSec, null)
  assert.equal(view.meetingDurationSec, 600)
  const txt = text(renderWorkspace(ui, view))
  assert.match(txt, /录音 10 分 0 秒/)
  assert.doesNotMatch(txt, /已用/)

  // 只有开始时间、没有结束时间 → 没有真实时长，不要凑一个数出来
  const ui2 = loadUI()
  const view2 = buildViewModel({ journal: { runs: { r: { run: 'r', phase: 'done', startedAt: '2026-11-10T08:00:00Z' } } } })
  assert.strictEqual(view2.meetingDurationSec, null)
  assert.doesNotMatch(text(renderWorkspace(ui2, view2)), /录音 \d+ 分/)
})

test('client 契约：live.set 接住 demo，演练中显示横幅、转写行带「演练」标记', () => {
  const ui = loadUI()
  const tree = renderWorkspace(ui, build('capturing'), {
    demo: { running: true },
    transcript: [{ t: '2026-11-10T08:00:00Z', text: '演练转写', demo: true }],
  })
  const txt = text(tree)
  assert.match(txt, /演练中（不影响真实录音）/)
  assert.ok(nodes(tree).some((n) => n.t === 'span' && text(n) === '演练'), '转写行要有「演练」标记')

  assert.equal(ui.live.demo.running, true, 'live.demo 必须真的被 set（以前漏接导致横幅永远不显示）')
  assert.match(source, /if \(v\.demo !== undefined\) live\.demo = v\.demo/, 'live.set 必须承载 demo')
  assert.match(source, /demo: j\.demo/, '轮询 /status 时必须把 demo 传进 live.set')
})

test('client 契约：首屏只渲染第一条 issue，其余折成「还有 N 个问题」', () => {
  const ui = loadUI()
  const view = buildViewModel({
    journal: { runs: { d: { run: 'd', phase: 'done' } } },
    runtime: {
      issues: [
        { id: 'e1', text: '第一条问题：密钥无效', level: 'error', fix: '换 Key' },
        { id: 'e2', text: '第二条问题：音频静音', level: 'error' },
        { id: 'i1', text: '当前没有检测到会议窗口', level: 'info' },
      ],
    },
  })
  const tree = renderWorkspace(ui, view)
  const txt = text(tree)
  assert.match(txt, /第一条问题：密钥无效/)
  assert.doesNotMatch(txt, /第二条问题/, '首屏只渲染第一条，其余必须折叠')
  assert.match(txt, /还有 1 个问题/)
  assert.match(txt, /复制排查信息/, '折叠后仍要能复制排查信息')
  assert.match(txt, /换 Key/, '第一条的修法要显示')
  assert.ok(nodes(tree).some((n) => n.p && n.p.role === 'alert'), '有 error/warn 时外层要有 role=alert')

  const bannerAt = source.indexOf('function IssueBanner(props)')
  const banner = source.slice(bannerAt, bannerAt + 3200)
  assert.ok(bannerAt > 0)
  assert.ok(banner.includes("('还有 ' + more + ' 个问题')"), '折叠文案必须是「还有 N 个问题」')
  assert.ok(banner.includes('lv.captureNotice'), '前端即时反馈 captureNotice 仍要合并展示')
})

test('client 契约：只有 info 提示时不报警（不套 role=alert，提示单独计数）', () => {
  const ui = loadUI()
  const view = buildViewModel({
    journal: { runs: { d: { run: 'd', phase: 'done' } } },
    runtime: {
      issues: [
        { id: 'i1', text: '提示一：当前没有检测到会议窗口', level: 'info' },
        { id: 'i2', text: '提示二：实时转写使用会话模型', level: 'info' },
      ],
    },
  })
  assert.equal(view.issues.length, 0)
  assert.equal(view.notices.length, 2)
  const tree = renderWorkspace(ui, view)
  const txt = text(tree)
  assert.match(txt, /提示一/)
  assert.doesNotMatch(txt, /提示二/, '提示也只显示第一条')
  assert.match(txt, /还有 1 条提示/)
  assert.equal(nodes(tree).filter((n) => n.p && n.p.role === 'alert').length, 0, '只有 info 时不该套 role=alert')
})

test('client 契约：工作台复用 IssueBanner，且 issues → role=alert → PipelineSteps 顺序不变', () => {
  const wsAt = source.indexOf('function MeetingWorkspace(')
  const ws = source.slice(wsAt, source.indexOf('function IssueBanner('))
  assert.ok(wsAt > 0 && ws.length > 0)
  assert.ok(ws.includes('h(IssueBanner, { issues: v.issues || [], notices: v.notices || [] })'), '工作台要复用 IssueBanner 并同时传 issues/notices')
  const issuesAt = ws.indexOf('v.issues || []')
  const alertAt = ws.indexOf("role: 'alert'", issuesAt)
  const stepsAt = ws.indexOf('h(PipelineSteps', issuesAt)
  assert.ok(issuesAt > -1, '工作台应从共用 view 读取 issues')
  assert.ok(alertAt > issuesAt, 'issue 外层要有 role=alert')
  assert.ok(stepsAt > alertAt, '问题必须在管线步骤之前')
})

test('完成态仍有手动「开始录音」次级入口（用户反馈过它一度消失）', () => {
  const done = build('done')
  assert.equal(done.primary.action, 'minutes')
  const sec = done.secondary || []
  assert.ok(sec.some((b) => b.action === 'record'), '非采集状态必须保留「开始录音/再录一场」入口')
  assert.equal(sec.find((b) => b.action === 'record').label, '再录一场')

  const idle = build('idle')
  assert.equal(idle.primary.action, 'record')
  assert.equal((idle.secondary || []).length, 0, '主按钮本身就是开始录音时不要重复')

  const cap = build('capturing')
  assert.equal((cap.secondary || []).length, 0, '采集中不出现「开始录音」')
  assert.deepEqual(Object.keys(cap.secondary || {}).length, 0)
})
