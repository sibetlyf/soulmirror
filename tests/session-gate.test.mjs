import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createSessionGate, keyOf } from '../lib/session-gate.js'

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms))

test('单飞：同一时刻只有一个回合在跑', async () => {
  let concurrent = 0
  let peak = 0
  const gate = createSessionGate({
    run: async () => {
      concurrent += 1
      peak = Math.max(peak, concurrent)
      await tick(5)
      concurrent -= 1
    },
    maxPending: 5,
  })
  await Promise.all([gate.submit('a', 1), gate.submit('b', 2), gate.submit('c', 3)])
  assert.equal(peak, 1, '不该并发')
  assert.equal(gate.stats().runs, 3)
})

test('这就是用户看到的问题：一次性投 8 个，只跑 1+2 个', async () => {
  const ran = []
  const gate = createSessionGate({
    run: async (n) => { ran.push(n); await tick(1) },
    maxPending: 2,
  })
  await Promise.all(
    Array.from({ length: 8 }, (_, i) => gate.submit('k' + i, i)),
  )
  // 第 1 个在跑，队列最多 2，其余被丢
  assert.equal(ran.length, 3, '实际跑了 ' + ran.length + ' 次')
  const s = gate.stats()
  assert.equal(s.dropped, 5)
  assert.equal(s.pending, 0)
})

test('同 key 合并：最新的替换排队中的，旧的返回 skipped', async () => {
  const gate = createSessionGate({ run: async (v) => { await tick(5); return v }, maxPending: 4 })
  const first = gate.submit('same', 'old')
  const second = gate.submit('other', 'x')   // 排队
  const third = gate.submit('same', 'new')   // 应替换 first？first 已在跑
  // first 正在跑，不参与替换；second 在排队
  const r1 = await first
  assert.equal(r1, 'old')
  const r2 = await second
  assert.equal(r2, 'x')
  const r3 = await third
  assert.equal(r3, 'new')
  assert.equal(gate.stats().replaced, 0, '正在跑的不算替换')
})

test('排队中的同 key 会被替换，不重复执行', async () => {
  const ran = []
  let release
  const blocker = new Promise((r) => { release = r })
  const gate = createSessionGate({
    run: async (v) => { ran.push(v); if (v === 'hold') await blocker; return v },
    maxPending: 4,
  })
  const hold = gate.submit('hold', 'hold')        // 占住执行位
  const a1 = gate.submit('advice', 'old-advice')  // 排队
  const a2 = gate.submit('advice', 'new-advice')  // 替换 a1
  const dropped = await a1
  assert.equal(dropped.skipped, 'replaced')
  release()
  await hold
  assert.equal(await a2, 'new-advice')
  assert.deepEqual(ran, ['hold', 'new-advice'], '旧请求不该被执行')
  assert.equal(gate.stats().replaced, 1)
})

test('失败不堵队列，后续请求照跑', async () => {
  const gate = createSessionGate({
    run: async (v) => { if (v === 'boom') throw new Error('坏了'); return v },
    maxPending: 3,
  })
  const bad = gate.submit('a', 'boom')
  const good = gate.submit('b', 'ok')
  await assert.rejects(bad, /坏了/)
  assert.equal(await good, 'ok')
  assert.equal(gate.stats().failed, 1)
})

test('stats 能看清是否在忙、排了几个', async () => {
  const gate = createSessionGate({ run: async () => { await tick(10) }, maxPending: 3 })
  const p = gate.submit('a', 1)
  await tick(1)
  const s = gate.stats()
  assert.equal(s.busy, true)
  assert.equal(s.submitted, 1)
  await p
  await tick(1) // resolve 先于 finally 复位，等一拍才是"空闲"
  assert.equal(gate.stats().busy, false)
})

test('keyOf：压掉空白、截断', () => {
  assert.equal(keyOf('  你好   啊 '), '你好 啊')
  assert.ok(keyOf('x'.repeat(500)).length <= 120)
  assert.equal(keyOf(''), '')
})

test('空队列时 stats.run 不涨、也不挂', async () => {
  const gate = createSessionGate({ run: async () => 1 })
  assert.equal(gate.stats().runs, 0)
  assert.equal(gate.stats().busy, false)
  assert.equal(await gate.submit('a', 1), 1)
})
