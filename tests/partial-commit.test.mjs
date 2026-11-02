import { test } from 'node:test'
import assert from 'node:assert/strict'

/**
 * 长时间不落句 → 把中间结果提为正式一行。
 * 这段逻辑决定了"多久能看到字"，所以单独测。
 */
function commitPartial(state, now) {
  const text = String(state.partial || '').trim()
  if (text.length < 8) return { committed: false, state }
  const last = state.transcript[state.transcript.length - 1]
  if (last && last.text === text) return { committed: false, state: { ...state, partial: '' } }
  return {
    committed: true,
    state: { ...state, transcript: [...state.transcript, { t: now, text, forced: true }], partial: '' },
  }
}

test('够长的中间结果会被落成一行', () => {
  const r = commitPartial({ transcript: [], partial: '我们现在讨论一下排期问题' }, 'T')
  assert.equal(r.committed, true)
  assert.equal(r.state.transcript.length, 1)
  assert.equal(r.state.partial, '')
})

test('太短的（<8 字）不落，避免碎片', () => {
  const r = commitPartial({ transcript: [], partial: '好的' }, 'T')
  assert.equal(r.committed, false)
})

test('和上一行完全相同 → 不重复落', () => {
  const r = commitPartial({ transcript: [{ t: 'T0', text: '我们现在讨论一下排期问题' }], partial: '我们现在讨论一下排期问题' }, 'T')
  assert.equal(r.committed, false)
  assert.equal(r.state.partial, '')
})

test('空中间结果不落', () => {
  assert.equal(commitPartial({ transcript: [], partial: '   ' }, 'T').committed, false)
})
