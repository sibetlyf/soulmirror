import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const src=readFileSync(new URL('../lib/postmeeting-persona.js',import.meta.url),'utf8')
const host=readFileSync(new URL('../index.js',import.meta.url),'utf8')
test('会后画像由独立step调用且只读固定offline目录',()=>{assert.match(host,/persona: async task =>/);assert.match(host,/updatePostMeetingPersona\(\{dir:task\.dir/);assert.match(src,/transcript-offline\.jsonl/);assert.doesNotMatch(src,/session\.transcript|session\.dir/)})
test('画像文档渲染和同步保留，失败带阶段且抛给journal管线',()=>{assert.match(src,/renderPersonaDoc\(/);assert.match(src,/sync = syncPersonaDoc/);assert.match(src,/await sync\(/);assert.match(src,/throw new Error\('画像写库失败/);assert.match(src,/kb\.stage/);assert.match(src,/return \{status:'done'.*personaKb/)})
test('画像知识库同步仅显式true开启，默认关并保留薄画像门槛',()=>{assert.match(src,/cfg\.knowledge\?\.personaSync === true/);assert.match(src,/未开启自动同步/);assert.match(src,/personaMinItems\)\|\|5/);assert.match(src,/personaMinScore\)\|\|0\.2/);assert.match(src,/personaBaseName/)})
test('拿不到端口明确失败，不能假装写过；每次外部await后检查取消',()=>{assert.match(src,/if \(!port\) throw new Error\('画像已保存本地/);assert.match(src,/await fetchImpl\(url/);assert.match(src,/assertActive\(\); return r/);assert.match(src,/signal/);assert.match(src,/await sync\([\s\S]*?\n    assertActive\(\)/)})
