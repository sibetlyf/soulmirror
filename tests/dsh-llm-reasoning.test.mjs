import { test } from 'node:test'
import assert from 'assert/strict'
import { createDshCompleter, isUnsupportedReasoningError, REASONING_FALLBACKS } from '../lib/dsh-llm.js'

function fakeLlm({ rejectEffortOff = true, rejectAll = false } = {}) {
  const calls = []
  return {
    calls,
    stream(opts) {
      calls.push(opts.reasoningEffort || '(none)')
      const err = () => {
        const e = new Error('provider "volcengine" model "deepseek-v4.1-flash" does not support reasoning effort "' + (opts.reasoningEffort || 'off') + '"')
        e.code = 'UNSUPPORTED_REASONING_EFFORT'
        return e
      }
      return (async function* () {
        if (rejectAll) { yield { type: 'finish', reason: { kind: 'error', failure: { message: 'provider "x" model "y" does not support reasoning effort "off"', code: 'UNSUPPORTED_REASONING_EFFORT' } } }; return }
        const eff = opts.reasoningEffort
        if (eff === 'off' || eff === undefined) { yield { type: 'finish', reason: { kind: 'error', failure: { message: 'provider "volcengine" model "deepseek-v4.1-flash" does not support reasoning effort "off"', code: 'UNSUPPORTED_REASONING_EFFORT' } } }; return }
        yield { type: 'text-delta', text: '纪要正文' }
        yield { type: 'finish', reason: { kind: 'stop' } }
      })()
    },
  }
}

test('识别"档位不支持"错误', () => {
  assert.equal(isUnsupportedReasoningError('does not support reasoning effort "off"'), true)
  assert.equal(isUnsupportedReasoningError('UNSUPPORTED_REASONING_EFFORT'), true)
  assert.equal(isUnsupportedReasoningError('模型不存在'), false)
})

test('会话带 off 时自动换档并成功', async () => {
  const llm = fakeLlm()
  const c = createDshCompleter({ llm, provider: 'volcengine', model: 'deepseek-v4.1-flash' })
  const out = await c([{ role: 'user', content: '写个纪要' }])
  assert.match(out, /纪要正文/)
  assert.ok(llm.calls.length >= 2, '第一次失败后必须换档重试')
  console.log('[换档序列]', llm.calls.join(' → '))
})

test('非档位错误（模型不存在）不重试、直接抛', async () => {
  const llm = {
    calls: [],
    stream(opts) {
      llm.calls.push('x')
      return (async function* () {
        yield { type: 'finish', reason: { kind: 'error', failure: { message: '模型不存在', code: 'MODEL_NOT_FOUND' } } }
      })()
    },
  }
  const c = createDshCompleter({ llm, provider: 'p', model: 'm' })
  await assert.rejects(() => c([{ role: 'user', content: 'x' }]), /模型不存在/)
  assert.equal(llm.calls.length, 1, '不该为了别类错误反复重试')
})
