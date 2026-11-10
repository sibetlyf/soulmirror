import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createJournal } from '../lib/journal.js'
import { createPostMeeting } from '../lib/postmeeting.js'

// Registry implementation was replaced by a durable per-directory queue.
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'sm-isolation-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const journal = createJournal({ root }); journal.load()
  return { root, journal }
}

test('同一目录排队/执行期间去重；第二场不会被第一场去抖误杀', async t => {
  const { root, journal } = fixture(t)
  const a = join(root, 'a'), b = join(root, 'b'); mkdirSync(a); mkdirSync(b)
  let release; const blocked = new Promise(r => { release = r })
  const calls = []
  const runner = createPostMeeting({ journal, steps: { offline: async ({dir}) => { calls.push(dir); if (dir === a) await blocked } } })
  runner.enqueue(a); runner.enqueue(a); runner.enqueue(b); runner.enqueue(b)
  await new Promise(r => setImmediate(r))
  assert.equal(runner.enqueue(a).busy, true)
  release(); await runner.idle()
  assert.deepEqual(calls, [a, b])
})

test('每个步骤使用排队时捕获的目录，不读取可变会议 session.dir', async t => {
  const { root, journal } = fixture(t)
  const session = {dir: join(root, 'first')}; const expected = session.dir
  const calls = []
  const runner = createPostMeeting({journal, steps: Object.fromEntries(['offline','minutes','knowledge','persona'].map(step => [step, async ({dir}) => { calls.push(dir); session.dir = join(root,'new-meeting') }]))})
  runner.enqueue(session.dir); await runner.idle()
  assert.deepEqual(calls, [expected,expected,expected,expected])
})

test('步骤异常释放执行槽；新会议仍能整理，失败会议可重试', async t => {
  const {root,journal} = fixture(t); const bad=join(root,'bad'), good=join(root,'good')
  let fail = true
  const runner=createPostMeeting({journal,steps:{offline:async ({dir})=>{if(dir===bad && fail) throw new Error('failed')}}})
  runner.enqueue(bad); runner.enqueue(good); await runner.idle()
  assert.equal(journal.projection().runs[bad].phase,'error')
  assert.equal(journal.projection().runs[good].phase,'done')
  assert.equal(runner.status().current,null)
  fail=false; runner.enqueue(bad); await runner.idle()
  assert.equal(journal.projection().runs[bad].phase,'done')
})
