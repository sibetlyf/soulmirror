import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveDefaultModel } from '../lib/model-resolve.js'

test('配置里写死 provider/model 时直接用它', async () => {
  const r = await resolveDefaultModel({ preferred: { provider: 'p', model: 'm' } })
  assert.deepEqual(r, { provider: 'p', model: 'm', source: 'config' })
})

test('用宿主默认模型', async () => {
  const r = await resolveDefaultModel({
    catalog: async () => ({ default: { provider: 'deepseek-official', model: 'deepseek-flash' } }),
  })
  assert.equal(r.source, 'catalog')
  assert.equal(r.model, 'deepseek-flash')
})

test('默认模型为空时退回到第一个可用 provider 的第一个模型（真实事故现场）', async () => {
  const r = await resolveDefaultModel({
    catalog: async () => ({ default: null }),
    listProviders: async () => [{ id: 'deepseek-official' }],
    listModels: async () => [{ id: 'deepseek-chat' }],
  })
  assert.equal(r.source, 'first-available')
  assert.equal(r.provider, 'deepseek-official')
  assert.equal(r.model, 'deepseek-chat')
})

test('catalog 抛错也能继续回退', async () => {
  const r = await resolveDefaultModel({
    catalog: async () => { throw new Error('boom') },
    listProviders: async () => [{ id: 'x' }],
    listModels: async () => ['m1'],
  })
  assert.equal(r.model, 'm1')
})

test('某个 provider 列不出模型时换下一个', async () => {
  const r = await resolveDefaultModel({
    listProviders: async () => [{ id: 'a' }, { id: 'b' }],
    listModels: async (p) => {
      if (p === 'a') throw new Error('nope')
      return [{ id: 'b-model' }]
    },
  })
  assert.equal(r.provider, 'b')
  assert.equal(r.model, 'b-model')
})

test('全都拿不到时抛错，并把看到的信息写进消息', async () => {
  await assert.rejects(
    () => resolveDefaultModel({ catalog: async () => null, listProviders: async () => [] }),
    /找不到可用模型/,
  )
  await assert.rejects(
    () => resolveDefaultModel({ catalog: async () => { throw new Error('x') }, listProviders: async () => [] }),
    /catalog 查询失败|没有任何可用 provider/,
  )
})

test('只配了 provider 没配 model 时，仍用默认模型的 model', async () => {
  const r = await resolveDefaultModel({
    preferred: { provider: 'p' },
    catalog: async () => ({ default: { provider: 'other', model: 'm9' } }),
  })
  assert.equal(r.provider, 'p')
  assert.equal(r.model, 'm9')
})
