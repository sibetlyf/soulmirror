import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createJournal } from '../lib/journal.js'
import { createPostMeeting } from '../lib/postmeeting.js'
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'sm-postmeeting-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const run = join(root, 'meeting'); mkdirSync(run)
  const journal = createJournal({ root }); journal.load()
  return { root, run, journal }
}
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r }); return { promise, resolve } }
const tick = () => new Promise((r) => setImmediate(r))

test('waiting queue is durable before return and cold restart resumes it', async (t) => {
  const { root, run, journal } = fixture(t)
  const blocked = deferred()
  const runner = createPostMeeting({ journal, steps: { offline: async () => { await blocked.promise } } })
  runner.enqueue(run); await tick()
  const second = run + '-waiting'
  journal.append('pipeline.start', { run: second })
  journal.append('pipeline.stepDone', { run: second, step: 'offline', output: { sentences: 5 } })
  runner.enqueue(second)
  const cold = createJournal({ root }); cold.load()
  const queued = cold.projection().runs[second]
  assert.equal(queued.phase, 'queued')
  assert.equal(queued.steps.offline.state, 'done')
  const called = []
  const restored = createPostMeeting({ journal: cold, steps: { offline: async () => { called.push('offline') }, minutes: async () => { called.push('minutes') } } })
  restored.resume([queued]); await restored.idle()
  assert.deepEqual(called, ['minutes'])
  assert.equal(cold.projection().runs[second].phase, 'done')
  runner.cancelCurrent(); blocked.resolve(); await runner.idle()
})

test('queue drains then accepts reentry; reentrant enqueue remains serial', async (t) => {
  const { run, journal } = fixture(t)
  const visited = []; let runner
  runner = createPostMeeting({ journal, steps: { offline: async ({ dir }) => {
    visited.push(dir)
    if (dir === run) runner.enqueue(run + '-2')
  } } })
  runner.enqueue(run); await runner.idle()
  assert.deepEqual(visited, [run, run + '-2'])
  runner.enqueue(run + '-3'); await runner.idle()
  assert.equal(visited.length, 3); assert.equal(runner.status().current, null)
})

test('cancel blocks late progress, commits, success and downstream steps', async (t) => {
  const { run, journal } = fixture(t)
  const d = deferred(); let ctx; let writes = 0, downstream = 0
  const runner = createPostMeeting({ journal, steps: {
    offline: async (c) => { ctx = c; await d.promise; c.progress('late', 100); c.commit(() => writes++); return { status: 'done' } },
    minutes: async () => { downstream++ },
  } })
  runner.enqueue(run); await tick()
  assert.equal(runner.cancelCurrent(), true); await runner.idle()
  assert.equal(ctx.isCancelled(), true); assert.equal(ctx.signal.aborted, true)
  d.resolve(); await tick()
  assert.equal(writes, 0); assert.equal(downstream, 0)
  const ev = journal.events()
  assert.equal(ev.some((e) => e.type === 'pipeline.done'), false)
  assert.equal(ev.some((e) => e.type === 'pipeline.progress' && e.detail === 'late'), false)
  assert.equal(journal.projection().runs[run].phase, 'error')
})

test('timeout aborts stable task token, next job runs, old task cannot affect it', async (t) => {
  const { run, journal } = fixture(t)
  const d = deferred(); let old; const calls = []
  const runner = createPostMeeting({ journal, timeouts: { offline: 10 }, steps: {
    offline: async (c) => {
      calls.push(c.dir)
      if (c.dir === run) { old = c; await d.promise; c.progress('late', 100); c.assertActive() }
      return { result: 'ok' }
    },
  } })
  runner.enqueue(run); runner.enqueue(run + '-2'); await runner.idle()
  assert.deepEqual(calls, [run, run + '-2'])
  assert.equal(old.isCancelled(), true)
  d.resolve(); await tick()
  const p = journal.projection()
  assert.equal(p.runs[run].phase, 'error'); assert.match(p.runs[run].error, /超时/)
  assert.equal(p.runs[run + '-2'].phase, 'done')
})

test('resume skips ALL confirmed steps, including noncontiguous later receipts', async (t) => {
  const { root, run, journal } = fixture(t)
  journal.append('pipeline.start', { run })
  journal.append('pipeline.stepDone', { run, step: 'offline', output: { sentences: 8, speakers: 2 } })
  journal.append('pipeline.stepDone', { run, step: 'knowledge', result: 'receipt', output: { result: 'receipt' } })
  const cold = createJournal({ root }); cold.load()
  const calls = []
  const steps = Object.fromEntries(['offline', 'minutes', 'knowledge', 'persona'].map((s) => [s, async () => { calls.push(s); return { path: s === 'minutes' ? 'minutes.md' : undefined } }]))
  const runner = createPostMeeting({ journal: cold, steps })
  runner.resume([cold.projection().runs[run]]); await runner.idle()
  assert.deepEqual(calls, ['minutes', 'persona'])
  const result = cold.projection().runs[run].result
  assert.equal(result.sentences, 8); assert.equal(result.knowledge, 'receipt')
})

test('crash after final step receipt closes pipeline without repeating side effects', async (t) => {
  const { run, journal } = fixture(t)
  journal.append('pipeline.start', { run })
  for (const step of ['offline', 'minutes', 'knowledge', 'persona']) journal.append('pipeline.stepDone', { run, step })
  let called = 0
  const runner = createPostMeeting({ journal, steps: { offline: async () => { called++ } } })
  runner.resume([journal.projection().runs[run]]); await runner.idle()
  assert.equal(called, 0); assert.equal(journal.projection().runs[run].phase, 'done')
})
