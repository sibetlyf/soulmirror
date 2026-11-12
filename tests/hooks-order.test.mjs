import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/**
 * 现场事故：面板一打开就报
 *   Minified React error #310（Rendered more/fewer hooks than expected）
 * 栈顶是 VoiceprintCard 里的 useEffect。
 *
 * 根因不是 React 版本，而是 hook 被写在"提前 return"之后：
 *   数据没到 → 只跑前 N 个 hook → 渲染"正在读取…"
 *   数据到了 → 多跑 2 个 useEffect → 这一帧 hook 数量变了 → React 抛 #310
 *
 * 这里用"大括号深度"做静态体检（比正则猜块边界靠谱）：
 *   ① 组件的所有 hook 必须出现在**第一个顶层 return 之前**
 *   ② 组件的所有 hook 必须在**大括号深度 0**（不能写在 if/for/while 块里）
 * 纯读源码就能守住，不需要跑浏览器。
 */

const client = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
const lines = client.split('\n')

const HOOK = /\bReact\.(useState|useEffect|useRef|useCallback|useMemo)\b/

/** 顶层缩进 4 空格的组件函数：[{name, start, end}] */
function components() {
  const out = []
  for (let i = 0; i < lines.length; i++) {
    const m = /^ {4}function ([A-Z][A-Za-z0-9]*)\(/.exec(lines[i])
    if (!m) continue
    let depth = 0
    let started = false
    let end = lines.length
    for (let j = i; j < lines.length; j++) {
      const t = lines[j]
      const opens = (t.match(/\{/g) || []).length
      const closes = (t.match(/\}/g) || []).length
      depth += opens - closes
      if (!started && opens > 0) started = true
      if (started && depth <= 0 && j > i) { end = j + 1; break }
    }
    out.push({ name: m[1], start: i, end })
  }
  return out
}

/**
 * 分析一个组件：返回 hook 位置、第一个顶层 return、违规项。
 * 深度按"当前行之前的大括号深度"计算（行内 `{` 不改变本行 hook 的归属）。
 */
function analyze(name, startLine, endLine) {
  let depth = 0
  const hooks = []
  const returns = []
  const conditionalHooks = []
  for (let i = startLine; i < endLine; i++) {
    const raw = lines[i]
    const trimmed = raw.trim()
    const atDepth = depth
    if (HOOK.test(raw)) {
      hooks.push({ line: i + 1, depth: atDepth })
      if (atDepth > 0) conditionalHooks.push({ line: i + 1, depth: atDepth })
    }
    if (atDepth === 0 && /^return\b/.test(trimmed)) returns.push({ line: i + 1 })
    depth += (raw.match(/\{/g) || []).length - (raw.match(/\}/g) || []).length
  }
  const firstReturn = returns.length ? returns[0].line : Infinity
  const afterReturn = hooks.filter((h) => h.line > firstReturn)
  return { name, hooks, firstReturn, afterReturn, conditionalHooks }
}

const results = components().map((c) => analyze(c.name, c.start + 1, c.end))

test('组件的 hook 不能出现在提前 return 之后（React #310 的根因）', () => {
  const bad = results.filter((r) => r.afterReturn.length)
  assert.deepEqual(bad.map((b) => b.name + '（hook L' + b.afterReturn.map((h) => h.line).join('/') + '，提前 return L' + b.firstReturn + '）'), [],
    '这些组件会在数据到位那一帧抛 React #310')
})

test('组件的 hook 不能写在 if/for/while 块里（同样会抛 #310）', () => {
  const bad = results.filter((r) => r.conditionalHooks.length)
  assert.deepEqual(bad.map((b) => b.name + '（L' + b.conditionalHooks.map((h) => h.line).join('/') + '，深度 ' + b.conditionalHooks[0].depth + '）'), [],
    '条件块里的 hook 会随分支改变 hook 数量')
})

test('VoiceprintCard：安装轮询与终态提示两个 effect 都在提前 return 之前，且容忍 data 为空', () => {
  const start = client.indexOf('function VoiceprintCard(props)')
  assert.ok(start > 0, '应有 VoiceprintCard')
  const body = client.slice(start, client.indexOf('function SpeakersCard(props)'))
  const earlyAt = body.indexOf('if (!data)')
  assert.ok(earlyAt > 0, 'VoiceprintCard 仍有"数据未到"的提前返回')
  const polling = body.indexOf('setInterval(function () { if (alive) refresh() }, 800)')
  assert.ok(polling > 0, '应有 800ms 真实进度轮询')
  assert.ok(polling < earlyAt, '轮询 effect 必须在提前 return 之前')
  assert.match(body, /var inst = \(data && data\.install\) \|\| \{\}/, 'effect 内部要容忍 data 为空')
})

test('每个组件都真的被解析到（防止分析器自己漏掉）', () => {
  const names = results.map((r) => r.name)
  for (const want of ['VoiceprintCard', 'SpeakersCard', 'ArtifactsCard', 'MeetingWorkspace', 'HealthCheck', 'IssueBanner']) {
    assert.ok(names.includes(want) || !client.includes('function ' + want), '应解析到组件：' + want)
  }
})
