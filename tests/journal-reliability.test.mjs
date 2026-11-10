import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, renameSync, rmSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createJournal, readJournalFile, recoverRun, recoverJournal, findInterrupted } from '../lib/journal.js'
function fixture(t, opts = {}) {
  const root = mkdtempSync(join(tmpdir(), 'sm-journal-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const run = join(root, 'meeting'); mkdirSync(run)
  const j = createJournal({ root, ...opts }); j.load()
  return { root, run, j }
}

test('append failure cannot publish or advance projection / sequence', (t) => {
  const { root, j } = fixture(t)
  j.append('plugin.enabled', { enabled: true })
  let calls = 0; j.subscribe(() => calls++)
  const file = join(root, 'journal.jsonl'), saved = file + '.saved'
  renameSync(file, saved); mkdirSync(file)
  assert.throws(() => j.append('plugin.enabled', { enabled: false }))
  assert.equal(j.projection().enabled, true); assert.equal(j.projection().lastSeq, 1); assert.equal(calls, 0)
  rmSync(file, { recursive: true }); renameSync(saved, file)
  assert.equal(j.append('plugin.enabled', { enabled: false }).seq, 2)
})

test('corrupt or complete unterminated tail cannot swallow next event in either log', (t) => {
  const { root, run, j } = fixture(t)
  writeFileSync(j.file, '{"type":"broken"')
  writeFileSync(join(run, 'events.jsonl'), '{"type":"broken"')
  j.append('capture.start', { run })
  assert.equal(readJournalFile(j.file).at(-1).type, 'capture.start')
  assert.equal(recoverRun(run).phase, 'recording')
  writeFileSync(j.file, JSON.stringify({ seq: 2, type: 'plugin.enabled', enabled: false }))
  j.load(); j.append('plugin.enabled', { enabled: true })
  assert.equal(readJournalFile(j.file).length, 2)
  assert.equal(j.projection().enabled, true)
})

test('reserved event fields and external references cannot mutate committed state', (t) => {
  const { j } = fixture(t)
  const e = j.append('plugin.enabled', { type: 'host.boot', seq: 99, enabled: true })
  e.enabled = false; const all = j.events(); all[0].enabled = false
  assert.equal(j.projection().enabled, true); assert.equal(j.projection().lastSeq, 1)
})

test('rotation preserves complete projection and sequence across cold reload', (t) => {
  const { root, run, j } = fixture(t, { maxBytes: 1 })
  j.append('plugin.enabled', { enabled: true })
  j.append('issue.raise', { key: 'disk', text: 'warning' })
  j.append('pipeline.start', { run })
  j.append('pipeline.stepDone', { run, step: 'offline', result: '3 sentences', output: { sentences: 3 } })
  j.append('pipeline.error', { run, step: 'minutes', error: 'network' })
  const before = j.projection()
  const cold = createJournal({ root }); cold.load()
  assert.deepEqual(cold.projection(), before)
  assert.equal(cold.append('issue.clear', { key: 'disk' }).seq, 6)
  assert.ok(readdirSync(root).some((f) => f.startsWith('journal-')))
  assert.equal(JSON.parse(readFileSync(j.file, 'utf8').split('\n')[0]).type, 'journal.checkpoint')
  assert.equal(readJournalFile(j.file).at(-1).type, 'issue.clear')
})

test('runtime.asr projects and replays safe metrics without credentials', (t) => {
  const { root, run, j } = fixture(t)
  j.append('runtime.asr', { run, apiKey: 'top-secret', state: {
    online: false, failed: true, phase: 'reconnecting', attempt: 3, reconnects: 2,
    sentMs: 1000, droppedMs: 20, bufferedMs: 200,
    apiKey: 'nested-secret', config: { token: 'hidden' },
    lastError: 'api_key=private-value Bearer private-bearer sk-private123',
  } })
  const p = j.projection()
  assert.equal(p.asr.attempt, 3); assert.equal(p.runs[run].asr.droppedMs, 20)
  const raw = readFileSync(j.file, 'utf8') + readFileSync(join(run, 'events.jsonl'), 'utf8')
  for (const secret of ['top-secret', 'nested-secret', 'hidden', 'private-value', 'private-bearer', 'sk-private123']) assert.equal(raw.includes(secret), false)
  const cold = createJournal({ root }); cold.load()
  assert.deepEqual(cold.projection(), p)
})

test('bootstrap merges moved per-run logs without retrying uncertain knowledge', (t) => {
  const { root, run } = fixture(t)
  const second = join(root, 'second'); mkdirSync(second)
  const ev = (type, seq, data = {}) => JSON.stringify({ type, seq, at: '2026-11-10T01:00:00Z', run: 'old-machine/path', ...data })
  writeFileSync(join(run, 'events.jsonl'), [ev('pipeline.start', 1), ev('pipeline.stepDone', 2, { step: 'offline' }), ev('pipeline.step', 3, { step: 'knowledge' })].join('\n'))
  writeFileSync(join(second, 'events.jsonl'), [ev('pipeline.start', 1), ev('pipeline.stepDone', 2, { step: 'offline' }), ev('pipeline.stepDone', 3, { step: 'knowledge', output: { result: 'receipt' } })].join('\n'))
  const result = recoverJournal(root, [run, second])
  assert.equal(result.recovered, true); assert.deepEqual(result.uncertain, [run])
  const cold = createJournal({ root }); cold.load()
  const p = cold.projection()
  assert.equal(p.runs[run].phase, 'error'); assert.match(p.runs[run].error, /核对/)
  assert.equal(p.runs[second].steps.knowledge.state, 'done')
  assert.equal(p.runs['old-machine/path'], undefined)
  assert.equal(findInterrupted(p, { maxAgeMs: Infinity }).some((r) => r.run === run), false)
  assert.equal(recoverJournal(root, [run, second]).recovered, false)
  assert.deepEqual(readJournalFile(cold.file).map((e) => e.seq), Array.from({ length: result.eventCount }, (_, i) => i + 1))
})

test('runtime.model durable selection is whitelisted and survives rotation/recovery', (t) => {
  const {root,run,j}=fixture(t,{maxBytes:1})
  const selection={provider:'test-provider',model:'test-model',reasoningEffort:'high',sourceSessionId:'test-session',source:'session',apiKey:'model-secret',token:'hidden-token'}
  j.append('runtime.model',{run,selection,apiKey:'outer-secret'})
  const expected={provider:'test-provider',model:'test-model',reasoningEffort:'high',sourceSessionId:'test-session',source:'session'}
  assert.deepEqual(j.projection().models,expected)
  assert.deepEqual(j.projection().runs[run].model,expected)
  const raw=readFileSync(j.file,'utf8')+readFileSync(join(run,'events.jsonl'),'utf8')
  for(const secret of ['model-secret','hidden-token','outer-secret'])assert.equal(raw.includes(secret),false)
  const cold=createJournal({root});cold.load();assert.deepEqual(cold.projection().models,expected)
  rmSync(j.file);recoverJournal(root,[run]);cold.load();assert.deepEqual(cold.projection().runs[run].model,expected)
})

test('artifact inference never fabricates missing audio', (t) => {
  const { run } = fixture(t)
  writeFileSync(join(run, 'transcript.jsonl'), '{"text":"diagnostic transcript"}\n')
  const r = recoverRun(run)
  assert.equal(r.result.audio, false)
  assert.equal(r.steps.offline.state, 'skipped')
})
