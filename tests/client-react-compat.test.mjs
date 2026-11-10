import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/**
 * 客户端不能假设宿主 React 是完整的。
 *
 * 事故：错误边界写成 `class X extends React.Component`。
 * 宿主的 React shim 只提供 hooks（没有 Component），于是
 * `class X extends undefined` 在**加载期**抛 TypeError，
 * 整个客户端注册失败 —— 表现就是整页白屏，且 `node --check` 完全查不出来。
 */

const client = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')

test('不能直接 extends React.Component（宿主可能不提供）', () => {
  // 只看代码，不看注释（注释里会提到这个写法）
  const codeOnly = client
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((l) => l.replace(/\/\/.*$/, ''))
    .join('\n')
  assert.equal(/extends\s+React\.Component/.test(codeOnly), false, '应改为能力探测后再决定是否用 class')
})

test('错误边界必须有降级路径', () => {
  const at = client.indexOf('const PluginErrorBoundary = (function ()')
  assert.ok(at > 0, '找不到错误边界')
  const seg = client.slice(at, at + 700)
  assert.match(seg, /React\.Component/, '应探测 React.Component')
  assert.match(seg, /typeof Base !== 'function'/, '缺失时应走降级')
  assert.match(seg, /PassThrough/, '降级组件应直通 children')
})

test('客户端加载期不得引用不存在的宿主 API', () => {
  // 顶层（模块立即执行）里不该出现 React.<X> 的 class 继承或直接调用未探测的 API
  const beforeFactory = client.slice(0, client.indexOf('factory: function (require)'))
  assert.equal(/extends\s+React\./.test(beforeFactory), false)
})
