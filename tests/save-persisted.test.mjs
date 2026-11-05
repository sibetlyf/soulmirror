import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/**
 * 事故：别的电脑上"保存了密钥仍显示没连接"。
 *
 * 根因在 savePersisted：写盘失败只记一条 warn，接口照样回"已保存"。
 * 于是界面显示已连接，刷新/重启后配置没了（常见原因是安装目录不可写）。
 * 这里钉住：写失败必须如实返回失败，并回滚内存，别让界面说谎。
 */

const src = readFileSync(new URL('../index.js', import.meta.url), 'utf8')

test('savePersisted 返回 { ok, path, error }，不再只返回 undefined', () => {
  const at = src.indexOf('function savePersisted(patch)')
  assert.ok(at > 0, '找不到 savePersisted')
  const seg = src.slice(at, at + 2200)
  assert.match(seg, /return \{ ok: true, path: CONFIG_FILE, error: '' \}/, '成功分支要返回结果')
  assert.match(seg, /return \{ ok: false, path: CONFIG_FILE, error: msg \}/, '失败分支要返回结果')
})

test('写入后回读校验（只读挂载/杀软拦截能被发现）', () => {
  const at = src.indexOf('function savePersisted(patch)')
  const seg = src.slice(at, at + 2200)
  assert.match(seg, /const back = readFileSync\(CONFIG_FILE/, '缺少回读校验')
  assert.match(seg, /back !== text/, '缺少内容比对')
})

test('写失败要回滚内存（cfg 是 const，必须原地还原）', () => {
  const at = src.indexOf('function savePersisted(patch)')
  const seg = src.slice(at, at + 2600)
  assert.match(seg, /stored = prevStored/, '没有回滚 stored')
  assert.match(seg, /for \(const k of touched\)/, '没有原地回滚 cfg')
  assert.equal(/^\s*cfg = /m.test(seg), false, '不能给 const cfg 整体赋值')
})

test('/setup 的 key 分支把保存失败如实告诉界面', () => {
  const at = src.indexOf("if (action === 'key')")
  assert.ok(at > 0, '找不到 key 分支')
  const seg = src.slice(at, at + 1200)
  assert.match(seg, /sv = savePersisted\(/, '应拿到保存结果（现在分"设置/清空"两条分支赋值）')
  assert.match(seg, /if \(!sv\.ok\)/, '应判断保存失败')  // 清空分支之后仍要有这个判断
  assert.match(seg, /保存失败（没写进磁盘）/, '失败时要有明确文案')
  assert.match(seg, /sv\.path/, '失败时应给出配置文件路径')
})

test('成功文案带上实际写入路径（便于排查路径不一致）', () => {
  const at = src.indexOf("if (action === 'key')")
  const seg = src.slice(at, at + 1200)
  assert.match(seg, /密钥已保存 → ' \+ sv\.path/, '成功时应显示落盘路径')
})

test('清空密钥真的能清（patchToStore 会跳过空 apiKey）', () => {
  const at = src.indexOf("if (action === 'key')")
  const seg = src.slice(at, at + 1800)
  assert.match(seg, /if \(!value\)/, '清空要走显式分支')
  assert.match(seg, /cfg\.asr\.apiKey = ''/, '清空要直接改内存')
  assert.match(seg, /stored\.asr\.apiKey = ''/, '清空要改待写对象')
  assert.match(seg, /savePersisted\(\{\}\)/, '清空后仍要落盘')
})
