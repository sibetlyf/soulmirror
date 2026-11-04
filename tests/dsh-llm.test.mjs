import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chunkText, finishFailure, createDshCompleter } from '../lib/dsh-llm.js'

function fakeLlm(chunks) {
  return {
    stream() {
      return (async function* () { for (const c of chunks) yield c })()
    },
  }
}

test('chunkText 兼容三种文本形态', () => {
  assert.equal(chunkText({ type: 'text-delta', text: '你' }), '你')
  assert.equal(chunkText({ type: 'delta', text: '好' }), '好')
  assert.equal(chunkText({ type: 'chunk', chunk: { type: 'text-delta', text: '呀' } }), '呀')
  assert.equal(chunkText({ type: 'block-end', block: { type: 'text', text: '整段' } }), '整段')
  assert.equal(chunkText({ type: 'usage' }), '')
  assert.equal(chunkText(null), '')
})

test('finishFailure 能取出真实失败原因（含 code/status）', () => {
  const f = finishFailure({
    type: 'finish',
    reason: { kind: 'error', failure: { message: '模型不存在', code: 'model_not_found', status: 404 } },
  })
  assert.match(f, /模型不存在/)
  assert.match(f, /code=model_not_found/)
  assert.match(f, /status=404/)
  assert.equal(finishFailure({ type: 'finish', reason: { kind: 'stop' } }), null)
})

test('正常流能拼出完整文本', async () => {
  const c = createDshCompleter({
    llm: fakeLlm([
      { type: 'text-delta', text: '{"speak":true,' },
      { type: 'text-delta', text: '"text":"好"}' },
      { type: 'finish', reason: { kind: 'stop' } },
    ]),
    provider: 'p', model: 'm',
  })
  assert.equal(await c([{ role: 'user', content: 'hi' }]), '{"speak":true,"text":"好"}')
})

test('模型报错时抛出真实原因，而不是"空内容"', async () => {
  const c = createDshCompleter({
    llm: fakeLlm([{ type: 'finish', reason: { kind: 'error', failure: { message: '余额不足', code: 'insufficient_quota' } } }]),
    provider: 'p', model: 'm',
  })
  await assert.rejects(() => c([{ role: 'user', content: 'hi' }]), /余额不足/)
})

test('没有任何 chunk 时说明是哪个模型返回空', async () => {
  const c = createDshCompleter({ llm: fakeLlm([]), provider: 'p', model: 'm' })
  await assert.rejects(() => c([{ role: 'user', content: 'hi' }]), /模型返回空内容（p\/m）/)
})

test('缺 provider/model 时会去问默认模型', async () => {
  const c = createDshCompleter({
    llm: fakeLlm([{ type: 'text-delta', text: 'ok' }]),
    resolveModel: async () => ({ provider: 'd', model: 'x' }),
  })
  assert.equal(await c([{ role: 'user', content: 'hi' }]), 'ok')
})

test('没有可用默认模型时明确报错', async () => {
  const c = createDshCompleter({ llm: fakeLlm([]), resolveModel: async () => null })
  await assert.rejects(() => c([{ role: 'user', content: 'hi' }]), /没有可用的默认模型/)
})
