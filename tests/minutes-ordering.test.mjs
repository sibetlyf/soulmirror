import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createJournal } from '../lib/journal.js'
import { createPostMeeting } from '../lib/postmeeting.js'
function fixture(t) {
  const root=mkdtempSync(join(tmpdir(),'sm-order-')); t.after(()=>rmSync(root,{recursive:true,force:true}))
  const journal=createJournal({root}); journal.load(); return {root,journal}
}
test('必须等非流式转写完成后才生成纪要，之后才写库',async t=>{
  const {root,journal}=fixture(t); const calls=[]; let release
  const pending=new Promise(r=>{release=r})
  const runner=createPostMeeting({journal,steps:{offline:async()=>{calls.push('offline:start');await pending;calls.push('offline:done')},minutes:async()=>{calls.push('minutes')},knowledge:async()=>{calls.push('knowledge')}}})
  runner.enqueue(root); await new Promise(r=>setImmediate(r))
  assert.deepEqual(calls,['offline:start'])
  release(); await runner.idle()
  assert.deepEqual(calls,['offline:start','offline:done','minutes','knowledge'])
})
test('非流式失败必须可见，不回退实时稿冒充正式纪要、不写知识库',async t=>{
  const {root,journal}=fixture(t); let generated=0,written=0
  const runner=createPostMeeting({journal,steps:{offline:async()=>{throw new Error('云端非流式不可用')},minutes:async()=>{generated++},knowledge:async()=>{written++}}})
  runner.enqueue(root); await runner.idle()
  const run=journal.projection().runs[root]
  assert.equal(run.phase,'error'); assert.equal(run.errorStep,'offline'); assert.match(run.error,/非流式不可用/)
  assert.equal(generated,0);assert.equal(written,0)
})
test('正式纪要步骤只读落盘非流式稿并记录来源，不能读session实时稿',()=>{
  const src=readFileSync(new URL('../index.js',import.meta.url),'utf8')
  const start=src.indexOf('minutes: async task =>'); const end=src.indexOf('knowledge: async task =>',start)
  assert.ok(start>0 && end>start)
  const body=src.slice(start,end)
  assert.match(body,/transcript-offline\.jsonl/);assert.match(body,/source:'dsh-session'/)
  assert.doesNotMatch(body,/session\.transcript|buildMinutes\(/)
  assert.match(body,/persistMinutesFile\(join\(task\.dir,'minutes.md'\)/)
})
