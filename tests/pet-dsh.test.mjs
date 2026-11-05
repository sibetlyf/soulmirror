import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  toWorkStatus, shouldPush, createPetClient, WORK_STATES,
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

test('取锁返回 lockId，broadcast 带上它', async () => {
  const fetchImpl = fakeFetch([
    { status: 200, body: { lockId: 'L1' } },
    { status: 200, body: { ok: true } },
  ])
  const c = createPetClient({ fetchImpl })
  const l = await c.lock('default')
  assert.equal(l.lockId, 'L1')
  await c.broadcast('我在，你说。', { lockId: l.lockId, pet: 'default' })
  assert.match(fetchImpl.calls[1].url, /lock=L1/)
  assert.deepEqual(fetchImpl.calls[1].body, { text: '我在，你说。' })
})

test('broadcast 缺锁时能识别 lock-required', async () => {
  const fetchImpl = fakeFetch([{ status: 409, body: { error: 'lock-required' } }])
  const c = createPetClient({ fetchImpl })
  const r = await c.broadcast('你好')
  assert.equal(r.ok, false)
  assert.equal(r.lockRequired, true)
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
