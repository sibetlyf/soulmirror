import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/**
 * 一个会议助手：一套配置、一个 Key、一个页面。
 *
 * 用户要求："所有的会议助手，统一用一个配置，统一的 key，一个页面。"
 * 之前的问题：
 *   · 前端三处各自 fetch 配置（已由 cfgStore 修掉）
 *   · 保存 Key 只写 asr 槽位 → 识别能用、语音/模型说没 Key（本次修）
 *   · 有 4 个入口（footprint 图标、面板图标、会话视图、浮层小窗）→ 两套 UI（本次修）
 */

const src = readFileSync(new URL('../index.js', import.meta.url), 'utf8')
const client = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')

test('配置里有统一的 keys.apiKey，且槽位为空时兜底', () => {
  assert.match(src, /keys: z\.object\(\{[\s\S]{0,80}apiKey/, 'schema 应有 keys.apiKey')
  const at = src.indexOf('const keyFor = (slotCfg, slot) => {')
  assert.ok(at > 0)
  const seg = src.slice(at, at + 400)
  assert.match(seg, /cfg\.keys && cfg\.keys\.apiKey/, 'keyFor 应回落到统一 Key')
})

test('保存一次 Key 同时写 asr / tts / brain 三个槽位', () => {
  const at = src.indexOf("const wr = await keyStore.set('asr', value)")
  assert.ok(at > 0)
  const seg = src.slice(at, at + 900)
  assert.match(seg, /keyStore\.set\('tts', value\)/, '应同时写 tts')
  assert.match(seg, /keyStore\.set\('brain', value\)/, '应同时写 brain')
  assert.match(seg, /cfg\.keys\.apiKey = value/, '应同步统一 Key 字段')
})

test('只有 4 个入口，且没有第二套 UI', () => {
  const injects = [...client.matchAll(/slots\.inject\('([^']+)'/g)].map((m) => m[1])
  assert.deepEqual(injects.sort(), ['conversation.input.dock', 'main', 'settings.section', 'shell.overlay', 'sidebar.footer.action', 'sidebar.panellist'],
    '入口应只剩 4 个，实际：' + injects.join(', '))
  for (const gone of ['CompactPanel', 'function Entry(']) {
    assert.equal(client.includes(gone), false, '不该再有 ' + gone)
  }
})

test('配置仍是单一来源（cfgStore / useConfig）', () => {
  const gets = [...client.matchAll(/fetch\('\/api\/soulmirror\/config'\)/g)]
  assert.equal(gets.length, 1, '只允许 store 内部 GET 配置')
  assert.ok(client.includes('function useConfig()'), '应保留共享配置钩子')
})

test('出问题必须说明原因：issues 汇总里密钥优先', () => {
  assert.match(src, /issues: \(\(\) => \{/, '/status 应带问题清单')
})
