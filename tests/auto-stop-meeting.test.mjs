import { test } from 'node:test'
import assert from 'node:assert/strict'

/**
 * 会议结束自动停止：判定逻辑的行为测试。
 *
 * 用户反馈："结束会议不会自动停止转录"。
 * 根因有两处：
 *   1) onExit 只看 session.capturing，标志为 false 就直接 return，
 *      采集进程却可能还在跑（重连间隙/异常残留）→ 永远停不下来
 *   2) 生命周期依赖窗口形态，客户端崩溃/最小化到托盘/直接结束会议时可能判不出来
 * 所以除了修 onExit，还加了一条看门狗：连续两次（30 秒）看不到会议窗口就停采集并整理。
 *
 * 这里把"是否还活着"的判定抽出来做纯函数测试，避免只断言源码字符串。
 */

/** 与 index.js 看门狗里等价的判定：窗口列表里是否还有这场会的窗口 */
export function meetingWindowAlive(wins = [], { apps = [], windowTitle = '腾讯会议' } = {}) {
  const procs = new Set((apps || []).map((a) => String(a.proc || '').toLowerCase()).filter(Boolean))
  const frag = String(windowTitle || '腾讯会议')
  return (wins || []).some((w) => {
    const proc = String(w.proc || '').toLowerCase()
    if (procs.size && !procs.has(proc)) return false
    return String(w.title || '').includes(frag) || /FloatSpeakingWnd|VideoMainWindow|MeetingView/.test(String(w.cls || ''))
  })
}

/** 与 index.js 等价的计数：连续 miss 达到阈值就停 */
export function nextMissTicks(prev, alive, threshold = 2) {
  if (alive) return { ticks: 0, shouldStop: false }
  const ticks = prev + 1
  return { ticks: ticks >= threshold ? 0 : ticks, shouldStop: ticks >= threshold }
}

test('还在会里：任何会议窗口都算活着', () => {
  assert.equal(meetingWindowAlive(
    [{ proc: 'wemeetapp', title: 'viv的快速会议', cls: 'VideoMainWindow' }],
    { apps: [{ proc: 'wemeetapp' }] },
  ), true)

  // 窗口标题不含关键字，但类名是会议窗口 → 也算活着
  assert.equal(meetingWindowAlive(
    [{ proc: 'wemeetapp', title: '某个窗口', cls: 'wemeetapp.FloatSpeakingWnd' }],
    { apps: [{ proc: 'wemeetapp' }] },
  ), true)
})

test('会议窗口没了：判为不活着', () => {
  assert.equal(meetingWindowAlive(
    [{ proc: 'chrome', title: '知乎' }],
    { apps: [{ proc: 'wemeetapp' }] },
  ), false)
  assert.equal(meetingWindowAlive([], { apps: [{ proc: 'wemeetapp' }] }), false)
})

test('别的进程的窗口不能算这场会', () => {
  assert.equal(meetingWindowAlive(
    [{ proc: 'chrome', title: '腾讯会议官网' }],
    { apps: [{ proc: 'wemeetapp' }], windowTitle: '腾讯会议' },
  ), false, '进程不匹配时，标题里出现关键字也不算')
})

test('连续两次 miss 才停（避免刷新窗口/切标签时误停）', () => {
  let t = 0
  // 第一次看不到 → 不停
  let r = nextMissTicks(t, false)
  assert.equal(r.shouldStop, false)
  t = r.ticks
  // 第二次仍看不到 → 停
  r = nextMissTicks(t, false)
  assert.equal(r.shouldStop, true)
  assert.equal(r.ticks, 0, '停完要归零')
})

test('中途重新出现窗口：计数归零，不会误停', () => {
  let r = nextMissTicks(0, false)
  assert.equal(r.ticks, 1)
  r = nextMissTicks(r.ticks, true)
  assert.equal(r.ticks, 0, '看到窗口就归零')
  assert.equal(r.shouldStop, false)
})
