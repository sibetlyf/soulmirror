import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/**
 * 体检不得把"常量"当函数调。
 *
 * 真实事故：collectPreflightEnv 里写了 `toolsDir()`，而 toolsDir 是
 * `export const toolsDir = join(pluginDir, 'tools')` —— 调用即抛 TypeError，
 * 被外层 catch 吞掉后 env.bridgePresent 一直是 undefined，
 * 于是界面上永远显示"音频桥接 mbridge.exe（文件不存在）"，
 * 而文件其实好好躺在 tools/ 里。用户照着提示重装也没用。
 */

const src = readFileSync(new URL('../index.js', import.meta.url), 'utf8')
const bridge = readFileSync(new URL('../lib/bridge.js', import.meta.url), 'utf8')

test('bridge.js 里 toolsDir / bridgeExe 是常量而非函数', () => {
  assert.match(bridge, /export const toolsDir = /, 'toolsDir 应为常量')
  assert.match(bridge, /export const bridgeExe = /, 'bridgeExe 应为常量')
})

test('index.js 不得调用 toolsDir() / bridgeExe()', () => {
  // 只看代码，不看注释（注释里会解释这个错误写法）
  const codeOnly = src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((l) => l.replace(/\/\/.*$/, ''))
    .join('\n')
  assert.equal(/toolsDir\s*\(\s*\)/.test(codeOnly), false, 'toolsDir 是常量，不能当函数调')
  assert.equal(/bridgeExe\s*\(\s*\)/.test(codeOnly), false, 'bridgeExe 是常量，不能当函数调')
})

test('体检直接用 bridgeExe 判断存在性', () => {
  const at = src.indexOf('async function collectPreflightEnv')
  assert.ok(at > 0, '找不到体检输入收集')
  const seg = src.slice(at, at + 2200)
  assert.match(seg, /existsSync\(bridgeExe\)/, '应直接检查 bridgeExe')
  assert.match(seg, /import .*bridgeExe|bridgeExe[,} ]/, '应导入 bridgeExe')
})

test('探测异常时不要把"文件存在"误报成"文件不存在"', () => {
  const at = src.indexOf('async function collectPreflightEnv')
  const seg = src.slice(at, at + 2200)
  // catch 分支里要重新确认文件是否存在
  const catchAt = seg.indexOf('} catch (e) {')
  assert.ok(catchAt > 0, '应有 catch')
  const catchSeg = seg.slice(catchAt, catchAt + 400)
  assert.match(catchSeg, /existsSync\(bridgeExe\)/, 'catch 里也要按文件实际存在性判定')
})
