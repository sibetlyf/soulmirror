import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  modelSelection, selectionFromInspection, resolveModelRoute,
  createModelRouteStore, overrideOwnedModel,
} from '../lib/model-route.js'

const header = (config) => ({ type: 'request/header', data: { header: { config } } })
const DSH_DEFAULT = { provider: 'dsh', model: 'default-model' }

test('只接受完整的 provider+model，不接受半截配置', () => {
  assert.equal(modelSelection({ provider: '', model: 'x' }), null)
  assert.equal(modelSelection({ provider: 'p' }), null)
  assert.equal(modelSelection(null), null)
  assert.deepEqual(modelSelection({ provider: ' p ', model: ' m ', reasoningEffort: '' }), { provider: 'p', model: 'm' })
  assert.deepEqual(modelSelection({ provider: 'p', model: 'm', reasoningEffort: 'high' }), { provider: 'p', model: 'm', reasoningEffort: 'high' })
})

test('来源会话的模型必须来自已提交的 request/header，取最后一条', () => {
  assert.equal(selectionFromInspection({ events: [] }), null)
  assert.equal(selectionFromInspection(null), null)
  const events = [header({ provider: 'a', model: 'one' }), { type: 'tool/call', data: {} }, header({ provider: 'a', model: 'two' })]
  assert.deepEqual(selectionFromInspection({ events }), { provider: 'a', model: 'two' })
  // 未提交的请求（没有 header）不能当来源
  assert.equal(selectionFromInspection({ events: [{ type: 'assistant/attempt', data: {} }] }), null)
})

test('没有绑定来源时用 DSH 默认模型，并如实标来源', async () => {
  const r = await resolveModelRoute({ catalog: async () => ({ default: DSH_DEFAULT }) })
  assert.deepEqual(r, { ...DSH_DEFAULT, source: 'dsh-default' })
})

test('绑定来源会话时读该会话自己的模型，不读默认，也不读别的会话', async () => {
  const inspected = []
  const r = await resolveModelRoute({
    sourceSessionId: 'session-A',
    inspect: async (sid) => { inspected.push(sid); return { events: [header({ provider: 'bound', model: 'A-model' })] } },
    catalog: async () => ({ default: DSH_DEFAULT }),
  })
  assert.deepEqual(inspected, ['session-A'])
  assert.deepEqual(r, { provider: 'bound', model: 'A-model', source: 'session', sourceSessionId: 'session-A' })
})

test('绑定会话还没有提交过请求时明确失败，绝不偷偷退回默认模型', async () => {
  await assert.rejects(
    () => resolveModelRoute({ sourceSessionId: 'session-new', inspect: async () => ({ events: [] }), catalog: async () => ({ default: DSH_DEFAULT }) }),
    /尚无已提交的模型请求/,
  )
})

test('默认模型不可用时说清楚原因，不臆造模型', async () => {
  await assert.rejects(() => resolveModelRoute({ catalog: async () => null }), /DSH 默认模型不可用/)
})

test('快照优先：同一场会重跑用同一个模型，即使宿主默认已变', async () => {
  let catalogCalls = 0
  const r = await resolveModelRoute({
    snapshot: { provider: 'old', model: 'meeting-model' },
    catalog: async () => { catalogCalls += 1; return { default: DSH_DEFAULT } },
  })
  assert.deepEqual(r, { provider: 'old', model: 'meeting-model', source: 'snapshot' })
  assert.equal(catalogCalls, 0, '有快照时不该再去读默认模型')
})

test('并发请求同一场会只解析一次并只落一次快照', async () => {
  let resolves = 0
  const commits = []
  const store = createModelRouteStore({
    readSnapshot: () => null,
    commitSnapshot: (dir, route) => commits.push({ dir, route }),
    resolve: async () => { resolves += 1; return { provider: 'p', model: 'm' } },
  })
  const [a, b] = await Promise.all([store.forRun('dir-1'), store.forRun('dir-1')])
  assert.deepEqual(a, b)
  assert.equal(resolves, 1)
  assert.deepEqual(commits, [{ dir: 'dir-1', route: { provider: 'p', model: 'm' } }])
})

test('不同会议各自解析、各落各自快照（A/B 不串）', async () => {
  const commits = []
  const store = createModelRouteStore({
    readSnapshot: (dir) => (dir === 'A' ? { provider: 'pa', model: 'ma' } : null),
    commitSnapshot: (dir, route) => commits.push({ dir, route }),
    resolve: async (snap, ) => snap || { provider: 'pb', model: 'mb' },
  })
  const a = await store.forRun('A')
  const b = await store.forRun('B')
  assert.equal(a.model, 'ma')
  assert.equal(b.model, 'mb')
  assert.deepEqual(commits, [{ dir: 'B', route: { provider: 'pb', model: 'mb' } }], '已有快照的会议不该重复落盘')
})

test('只覆盖本插件自己的内部会话，其他会话原样返回', () => {
  const owned = new Map([['own', { provider: 'p', model: 'm', source: 'dsh-default' }]])
  const base = { provider: 'other', model: 'other-model', temperature: 0.2 }
  const mine = overrideOwnedModel('own', base, owned)
  assert.equal(mine.provider, 'p')
  assert.equal(mine.temperature, 0.2, '其它字段必须保留')
  assert.equal(overrideOwnedModel('someone-else', base, owned), base, '别人的会话不能被动模型')
})

test('宿主接线：没有"最后一次请求获胜"的全局来源，也不改宿主默认模型', () => {
  const src = readFileSync(new URL('../index.js', import.meta.url), 'utf8')
  assert.doesNotMatch(src, /sourceModel\s*=/, '不允许把任意会话的最后一次请求当来源')
  assert.doesNotMatch(src, /selectModel\(/, '不允许改宿主的默认模型选择')
  assert.match(src, /createModelRouteStore\(/)
  assert.match(src, /journal\.append\('runtime\.model'/)
  assert.match(src, /overrideOwnedModel\(agent\.id, base, ownedSelections\)/)
  // 纪要用独立内部会话，且按会议目录取自己的模型快照
  assert.match(src, /会议助手 · 纪要（内部）/)
  assert.match(src, /bindOwnedSession\(minutesSessionId, runDir\)/)
  assert.match(src, /void 0|sourceSessionId/)
})
