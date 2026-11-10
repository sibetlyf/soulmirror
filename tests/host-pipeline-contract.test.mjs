import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const src=readFileSync(new URL('../index.js',import.meta.url),'utf8')
test('host supplies one durable journal hook and unified presentation',()=>{
 assert.match(src,/onEvent: \(type,data\) => journal\.append\(type,data\)/)
 assert.match(src,/buildViewModel\(\{journal:/)
 assert.match(src,/pipeline\.resume\(findInterrupted/)
 assert.doesNotMatch(src,/async function finalizeMeeting\(/)
})
test('manual organize and tools share queue rather than transcription-only endpoint',()=>{
 const endpoint=src.slice(src.indexOf("sub === 'offline'"),src.indexOf("sub === 'setup'",src.indexOf("sub === 'offline'")))
 assert.match(endpoint,/pipeline\.enqueue/)
 const tool=src.slice(src.indexOf("name: 'meeting_offline_pass'"),src.indexOf("name: 'meeting_minutes'"))
 assert.match(tool,/pipeline\.enqueue/)
 assert.doesNotMatch(tool,/runOfflinePass\(/)
})
test('watchdog uses actual meeting detection, not home-title substring',()=>{
 const watchdog=src.slice(src.indexOf('const meetingWatchdog ='),src.indexOf('meetingWatchdog.unref'))
 assert.match(watchdog,/lifecycle\.detect/)
 assert.doesNotMatch(watchdog,/includes\(frag\)/)
})
test('minutes read persisted offline transcript; non-streaming failure cannot impersonate success',()=>{
 const pipeline=src.slice(src.indexOf('const pipeline ='),src.indexOf('const resumeTimer'))
 assert.match(pipeline,/transcript-offline\.jsonl/)
 assert.match(pipeline,/minutesCompleter/)
 assert.doesNotMatch(pipeline,/session\.transcript/)
 assert.match(src,/非流式文件识别失败/)
})
test('session model is inherited without unrelated key environment fallback',()=>{
 assert.match(src,/createModelRouteStore\(/)
 assert.match(src,/bindOwnedSession\(judgementSessionId\)/)
 assert.match(src,/overrideOwnedModel\(agent\.id, base, ownedSelections\)/)
 assert.doesNotMatch(src,/sourceModel\s*=/,'不许把任意会话最后一次请求当模型来源')
 assert.doesNotMatch(src,/selectModel\(/,'不许改宿主默认模型')
 const c=src.slice(src.indexOf('  const brainKey ='),src.indexOf('// 注意：必须在 completer'))
 assert.doesNotMatch(c,/process\.env\.(ARK_API_KEY|OPENAI_API_KEY)/)
})
