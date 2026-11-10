import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/**
 * 保存密钥的诚实性（不谎报成功、给出去哪儿找）。
 *
 * 现状：密钥不再写进 config.json，而是交给 keyStore
 * （DSH 凭据服务，或插件自带 credentials.json）。
 * 所以这里断言的是"意图"——失败要说清、成功要给出位置——
 * 而不是死盯某条具体语句。
 */

const src = readFileSync(new URL('../index.js', import.meta.url), 'utf8')

test('/setup 的 key 分支把保存失败如实告诉界面', () => {
  const at = src.indexOf("if (action === 'key')")
  assert.ok(at > 0, '找不到 key 分支')
  const seg = src.slice(at, at + 1600)
  assert.match(seg, /await keyStore\.set\('asr', value\)/, '应写进密钥存储')
  assert.match(seg, /if \(!wr\.ok\)/, '应判断失败')
  assert.match(seg, /保存失败/, '失败时要有明确文案')
  assert.match(seg, /存储位置/, '失败时应告诉用户存到哪里了')
  assert.match(seg, /ok: false/, '失败要带 ok:false')
})

test('成功文案带实际存储位置（便于排查路径不一致）', () => {
  // 用下一个分支做边界（这段代码会变长，按字符数截断会假失败）
  const at = src.indexOf("if (action === 'key')")
  const seg = src.slice(at, src.indexOf("if (action === '", at + 10))
  assert.match(seg, /describeLocation\(\)/, '成功时应给出存储位置')
  assert.match(seg, /keyStorage: wr\.mode/, '应回报是哪种存储')
})

test('清空密钥真的能清（空字符串表示清除）', () => {
  const at = src.indexOf("if (action === 'key')")
  const seg = src.slice(at, src.indexOf("if (action === '", at + 10))
  // 空值仍要交给 keyStore 处理（内部按 value='' 清除），并清掉可能残留的明文
  assert.match(seg, /keyStore\.set\('asr', value\)/, '空值也要走 keyStore（内部按清除处理）')
  assert.match(seg, /cfg\.asr\.apiKey = ''/, '应清掉内存明文')
  assert.match(seg, /stored\.asr\.apiKey = ''/, '应清掉待写明文')
  assert.match(seg, /密钥已清空/, '清空要有明确文案')
})

test('配置里不再长期保存明文密钥（迁移后应清空）', () => {
  const at = src.indexOf('const initKeys = async () => {')
  assert.ok(at > 0, '找不到密钥初始化')
  const seg = src.slice(at, at + 1200)
  assert.match(seg, /keyStore\.migrate\(legacy\)/, '启动应迁移旧明文')
  assert.match(seg, /apiKey = ''/, '迁移后从配置抹掉')
})
