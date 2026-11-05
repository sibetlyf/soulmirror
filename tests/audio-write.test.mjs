import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/**
 * 4GB 堆溢出的直接嫌疑之一：录音写入。
 *
 * 原来每块音频都 appendFile，并用 `this._audioQ = this._audioQ.then(...)` 串起来。
 * 磁盘一慢，这条 Promise 链无限增长：每个待写块（16~32KB）+ 闭包都留在内存，
 * 长时间会议能堆到几个 GB。
 *
 * 现在：常开写流 + 积压上限（超限丢音频并计数），宁可录音有缺口也不能撑爆宿主。
 */

const src = readFileSync(new URL('../lib/session.js', import.meta.url), 'utf8')

test('不再用无限增长的 Promise 链写音频', () => {
  // 只看"代码行"，注释里说明历史写法不应算违规
  const codeLines = src.split('\n').filter((l) => {
    const s = l.trim()
    return !s.startsWith('*') && !s.startsWith('//') && !s.startsWith('/*')
  })
  const code = codeLines.join('\n')
  assert.equal(/_audioQ\s*=/.test(code), false, '不要再用 _audioQ 串 appendFile')
  assert.equal(/appendFile\(this\.audioFile/.test(code), false, '不要每块都 appendFile')
})

test('音频走常开写流', () => {
  assert.match(src, /_openAudioStream\(\)/, '缺少写流打开方法')
  assert.match(src, /createWriteStream\(this\.audioFile, \{ flags: 'a' \}\)/, '应以 append 方式常开写流')
  assert.match(src, /_writeAudio\(chunk\)|_writeAudio\(d\)/, '缺少写入方法')
})

test('写流也挂了 error 监听（ENOSPC/EACCES 不能打崩宿主）', () => {
  const at = src.indexOf('_openAudioStream()')
  const seg = src.slice(at, at + 900)
  assert.match(seg, /\.on\('error'/, '写流缺少 error 监听')
})

test('有积压上限，超限丢弃并计数（而不是无限缓冲）', () => {
  const at = src.indexOf('_writeAudio(chunk)')
  assert.ok(at > 0, '找不到 _writeAudio')
  const seg = src.slice(at, at + 900)
  assert.match(seg, /writableLength > MAX_BACKLOG/, '缺少积压上限判断')
  assert.match(seg, /audioDropped/, '丢弃要计数')
  assert.match(seg, /16 \* 1048576/, '默认上限 16MB 应写明')
})

test('收尾会 flush 写流（否则最后几秒音频丢失）', () => {
  assert.match(src, /async _closeAudioStream\(\)/, '缺少收尾方法')
  const at = src.indexOf('async _closeAudioStream()')
  const seg = src.slice(at, at + 600)
  assert.match(seg, /s\.end\(done\)/, '应 end 并等待完成')
  assert.match(seg, /setTimeout\(done, 3000\)/, '磁盘卡住时要有兜底退出')
  assert.match(src, /await this\._closeAudioStream\(\)/, '收尾流程要调用它')
})
