import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  toWorkStatus, shouldPush, createPetClient, WORK_STATES,
  derivePetState, PET_MENU_ITEMS, menuAction,
} from '../lib/pet-dsh.js'

test('会议助手的状态映射到 dsh-pet 的合法档位', () => {
  assert.equal(toWorkStatus({ key: 'listening', text: '在听 5 句' }).state, 'working')
  assert.equal(toWorkStatus({ key: 'speaking', text: '我在' }).state, 'success')
  assert.equal(toWorkStatus({ key: 'sweeping', text: '重转写中' }).state, 'result')
  assert.equal(toWorkStatus({ key: 'error', text: '没 key' }).state, 'error')
  assert.equal(toWorkStatus({ key: 'thinking' }).state, 'thinking')
  // 待命 = 空闲，清空档位
  assert.equal(toWorkStatus({ key: 'idle' }).state, null)
})

test('映射出来的档位必须是 dsh-pet 认可的六个值之一', () => {
  for (const key of ['listening', 'speaking', 'thinking', 'sweeping', 'error', 'idle']) {
    const next = toWorkStatus({ key, text: 'x' })
    if (next.state !== null) assert.ok(WORK_STATES.includes(next.state), key + ' → ' + next.state)
  }
})

test('状态没变化就不重复推（避免每秒打接口）', () => {
  const a = { state: 'working', task: '在听 3 句' }
  assert.equal(shouldPush(null, a), true)
  assert.equal(shouldPush(a, { state: 'working', task: '在听 3 句' }), false)
  assert.equal(shouldPush(a, { state: 'working', task: '在听 4 句' }), true)
  assert.equal(shouldPush(a, { state: 'success', task: '在听 4 句' }), true)
  // 都为空时不推
  assert.equal(shouldPush(null, { state: null, task: null }), false)
})

// ── 客户端：用假的 fetch 验证请求形状 ────────────────────
function fakeFetch(responses) {
  const calls = []
  const impl = async (url, opts = {}) => {
    calls.push({ url, method: opts.method || 'GET', body: opts.body ? JSON.parse(opts.body) : null })
    const r = responses.shift() || { status: 200, body: { ok: true } }
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      text: async () => (r.body === undefined ? '' : JSON.stringify(r.body)),
    }
  }
  impl.calls = calls
  return impl
}

test('setWorkStatus 发 POST {state,task}', async () => {
  const fetchImpl = fakeFetch([{ status: 200, body: { ok: true } }])
  const c = createPetClient({ fetchImpl })
  const r = await c.setWorkStatus({ state: 'working', task: '在听会议 · 5 句' })
  assert.equal(r.ok, true)
  assert.equal(fetchImpl.calls[0].method, 'POST')
  assert.match(fetchImpl.calls[0].url, /\/work-status$/)
  assert.deepEqual(fetchImpl.calls[0].body, { state: 'working', task: '在听会议 · 5 句' })
})

test('空闲时发 DELETE 清空档位', async () => {
  const fetchImpl = fakeFetch([{ status: 204 }])
  const c = createPetClient({ fetchImpl })
  const r = await c.setWorkStatus({ state: null })
  assert.equal(fetchImpl.calls[0].method, 'DELETE')
  assert.equal(r.cleared, true)
})

test('非法档位直接抛错，不打接口', async () => {
  const fetchImpl = fakeFetch([])
  const c = createPetClient({ fetchImpl })
  await assert.rejects(() => c.setWorkStatus({ state: 'talking' }), /不认识的工作状态/)
  assert.equal(fetchImpl.calls.length, 0)
})

test('取锁返回 lockId，且 surface 是查询参数（上游必填）', async () => {
  const fetchImpl = fakeFetch([
    { status: 200, body: { lockId: 'L1' } },
    { status: 200, body: { ok: true } },
  ])
  const c = createPetClient({ fetchImpl })
  const l = await c.lock('main')
  assert.equal(l.lockId, 'L1')
  assert.match(fetchImpl.calls[0].url, /pet=main/)
  assert.match(fetchImpl.calls[0].url, /surface=web/, '缺 surface 上游会 bad-request')
})

test('broadcast 的时长字段是 duration（不是 durationMs）', async () => {
  const fetchImpl = fakeFetch([{ status: 200, body: { ok: true } }])
  const c = createPetClient({ fetchImpl })
  await c.broadcast('我在，你说。', { lockId: 'L1', pet: 'main', duration: 6000 })
  assert.match(fetchImpl.calls[0].url, /lock=L1/)
  assert.deepEqual(fetchImpl.calls[0].body, { text: '我在，你说。', duration: 6000 })
})

test('释放锁把 lockId 放在请求体里', async () => {
  const fetchImpl = fakeFetch([{ status: 200, body: { ok: true } }])
  const c = createPetClient({ fetchImpl })
  const r = await c.release('L1', 'main')
  assert.equal(r.ok, true)
  assert.match(fetchImpl.calls[0].url, /lock\/release/)
  assert.deepEqual(fetchImpl.calls[0].body, { lockId: 'L1' })
})

test('broadcast 缺锁时能识别 lock-required', async () => {
  const fetchImpl = fakeFetch([{ status: 409, body: { reason: 'lock-required', message: '需要占用锁' } }])
  const c = createPetClient({ fetchImpl })
  const r = await c.broadcast('你好')
  assert.equal(r.ok, false)
  assert.equal(r.lockRequired, true)
  assert.match(r.error, /占用锁/)
})

test('桌宠没装时 available 返回 false 而不是抛错', async () => {
  const fetchImpl = async () => ({ ok: false, status: 404, text: async () => 'not found' })
  const c = createPetClient({ fetchImpl })
  assert.equal(await c.available(), false)
})

// ── 菜单与动画协议 ────────────────────────────────────────
test('注册菜单项：owner + labels 整体覆盖', async () => {
  const fetchImpl = fakeFetch([{ status: 200, body: { ok: true } }])
  const c = createPetClient({ fetchImpl })
  const r = await c.registerMenu({ owner: 'soulmirror', labels: ['开始录音', '结束录音', '  ', ''] })
  assert.equal(r.ok, true)
  assert.equal(fetchImpl.calls[0].method, 'POST')
  assert.match(fetchImpl.calls[0].url, /\/menu\/item$/)
  assert.deepEqual(fetchImpl.calls[0].body.labels, ['开始录音', '结束录音'], '空标签要过滤掉')
})

test('轮询菜单触发：值为 target 的才算被点', async () => {
  // 形状来自上游：{ 弹弓: "main", 钓鱼: null }
  const fetchImpl = fakeFetch([{ status: 200, body: { 开始录音: 'main', 结束录音: null } }])
  const c = createPetClient({ fetchImpl })
  const r = await c.pollMenu({ owner: 'soulmirror', waitMs: 25000 })
  assert.equal(r.ok, true)
  assert.deepEqual(r.clicked, ['开始录音'])
  assert.match(fetchImpl.calls[0].url, /wait=25000/)
})

test('长轮询的超时必须比 wait 长，否则永远超时', async () => {
  const fetchImpl = fakeFetch([{ status: 200, body: {} }])
  const c = createPetClient({ fetchImpl, timeoutMs: 1000 })
  const r = await c.pollMenu({ waitMs: 30000 })
  assert.equal(r.ok, true)
})

test('点播动画：name 与 url 二选一', async () => {
  const fetchImpl = fakeFetch([
    { status: 200, body: { playbackId: 'p1' } },
    { status: 400, body: { error: 'bad' } },
  ])
  const c = createPetClient({ fetchImpl })
  const a = await c.playAnim({ name: '跳舞', lockId: 'L1', pet: 'main' })
  assert.equal(a.ok, true)
  assert.equal(a.playbackId, 'p1')
  assert.match(fetchImpl.calls[0].url, /lock=L1/)
  assert.deepEqual(fetchImpl.calls[0].body, { name: '跳舞' })

  const b = await c.playAnim({})
  assert.equal(b.ok, false, '既没 name 也没 url 时应直接失败')
})

test('清除菜单项幂等', async () => {
  const fetchImpl = fakeFetch([{ status: 200, body: { ok: true, removed: 3 } }])
  const c = createPetClient({ fetchImpl })
  const r = await c.clearMenu({ owner: 'soulmirror' })
  assert.equal(r.ok, true)
  assert.equal(r.removed, 3)
  assert.match(fetchImpl.calls[0].url, /owner=soulmirror/)
})

// ── 状态推导（替代原来的自建窗口）─────────────────────────
const NOW = Date.parse('2026-11-05T04:00:00Z')

test('采集中推导为在听，并带句数', () => {
  const r = derivePetState({ session: { capturing: true, lines: 12 }, meeting: { title: '周会' } }, { now: NOW })
  assert.equal(r.key, 'listening')
  assert.match(r.text, /12 句/)
  assert.equal(r.hint, '周会')
})

test('刚说过话推导为说话，20 秒后回到在听', () => {
  const fresh = derivePetState({ session: { capturing: true }, replyState: { spoken: '我在，你说。', at: NOW - 2000 } }, { now: NOW })
  assert.equal(fresh.key, 'speaking')
  const stale = derivePetState({ session: { capturing: true }, replyState: { spoken: '我在', at: NOW - 60000 } }, { now: NOW })
  assert.equal(stale.key, 'listening')
})

test('会后整理优先于采集，且分阶段', () => {
  assert.equal(derivePetState({ session: { capturing: true }, postMeeting: { phase: 'offline' } }, { now: NOW }).text, '重转写中')
  const done = derivePetState({ postMeeting: { phase: 'done', sentences: 42, speakers: 3 } }, { now: NOW })
  assert.equal(done.key, 'idle')
  assert.match(done.text, /42 句/)
  assert.match(done.text, /3 位/)
  assert.equal(derivePetState({ postMeeting: { phase: 'error', error: '识别失败' } }, { now: NOW }).key, 'error')
})

test('出错会盖过安静状态', () => {
  const r = derivePetState({ lastSpeakError: { message: '未配置语音合成 Key' } }, { now: NOW })
  assert.equal(r.key, 'error')
  assert.match(r.text, /语音合成/)
})

test('空状态推导为待命', () => {
  assert.equal(derivePetState({}, { now: NOW }).key, 'idle')
})

test('推导结果能直接喂给 toWorkStatus', () => {
  for (const status of [
    { session: { capturing: true, lines: 3 } },
    { replyState: { spoken: 'x', at: NOW } },
    { postMeeting: { phase: 'offline' } },
    { lastLlmError: { message: 'boom' } },
    {},
  ]) {
    const st = derivePetState(status, { now: NOW })
    const ws = toWorkStatus(st)
    assert.ok(ws.state === null || WORK_STATES.includes(ws.state))
  }
})

// ── 菜单 ────────────────────────────────────────────────
test('菜单项都是唯一的，且都能翻译成动作', () => {
  assert.equal(new Set(PET_MENU_ITEMS).size, PET_MENU_ITEMS.length)
  for (const label of PET_MENU_ITEMS) {
    assert.notEqual(menuAction(label).type, 'unknown', label + ' 没有对应动作')
  }
})

test('菜单动作映射正确', () => {
  assert.deepEqual(menuAction('开始录音'), { type: 'auto', action: 'start' })
  assert.deepEqual(menuAction('结束录音（会后整理）'), { type: 'auto', action: 'stop' })
  assert.deepEqual(menuAction('切换 Agent 发言'), { type: 'toggle', target: 'reply' })
  assert.deepEqual(menuAction('切换 建议卡片'), { type: 'toggle', target: 'advice' })
  assert.equal(menuAction('不存在的项').type, 'unknown')
})
