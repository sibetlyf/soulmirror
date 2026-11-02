/**
 * 面板渲染冒烟：真正执行每个面板组件（含 380px 侧栏 CompactPanel）。
 * 之前的白屏 bug 是"组件里用了未声明的变量 followBig"——语法检查发现不了，
 * 只有真正调用组件函数才会抛 ReferenceError。这个测试就是防这个。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(join(here, '..', 'lib', 'client.js'), 'utf8')

function makeReact() {
  return {
    createElement(type, props, ...children) {
      if (typeof type === 'function') return type(props || {})
      return { t: type, p: props, c: children }
    },
    Fragment: 'Fragment',
    createContext() { return { Provider: function () {}, Consumer: function () {} } },
    useContext() { return {} },
    useState(init) { return [typeof init === 'function' ? init() : init, () => {}] },
    useReducer(s) { return [s, () => {}] },
    useEffect() {},
    useLayoutEffect() {},
    useMemo(fn) { return fn() },
    useCallback(fn) { return fn },
    useRef(v) { return { current: v } },
  }
}

function loadClient() {
  let spec = null
  const React = makeReact()
  const registered = []
  const slots = {
    inject(name, fn) { fn() },
    register(meta, comp) { registered.push({ meta, comp }) },
    get: () => null,
  }

  const g = globalThis
  const prev = g.window
  g.window = { __ModuleLoader__: { load(s) { spec = s } } }
  try {
    // eslint-disable-next-line no-new-func
    new Function('require', 'module', 'exports', src)(
      (id) => (id === 'react' ? React : slots),
      { exports: {} },
      {},
    )
  } finally {
    if (prev === undefined) delete g.window
    else g.window = prev
  }

  assert.ok(spec && typeof spec.factory === 'function', 'client.js 没注册模块')
  const exp = spec.factory((id) => (id === 'react' ? React : slots))
  return { exp, registered }
}

test('client.js 能加载并导出 apply', () => {
  const { exp } = loadClient()
  assert.equal(typeof exp.apply, 'function')
  assert.ok(Array.isArray(exp.inject))
})

test('apply 会注册 3 个 slot', () => {
  const { exp, registered } = loadClient()
  exp.apply({ slots: { inject(n, fn) { fn() }, register(m, c) { registered.push({ meta: m, comp: c }) }, get: () => null } })
  assert.ok(registered.length >= 3, '注册组件数：' + registered.length)
})

test('380px 侧栏 CompactPanel 能渲染（能抓出未声明变量）', () => {
  const { exp } = loadClient()
  const panels = exp.__test
  assert.ok(panels && panels.CompactPanel, '缺少 __test.CompactPanel 测试出口')
  assert.doesNotThrow(() => panels.CompactPanel({}), '侧栏渲染抛错')
})

test('小窗 / 大页面 / Overlay 都能渲染', () => {
  const { exp } = loadClient()
  const { CompactPanel, MeetingPage, Overlay } = exp.__test
  assert.doesNotThrow(() => CompactPanel({}))
  assert.doesNotThrow(() => MeetingPage({}))
  assert.doesNotThrow(() => Overlay({}))
})
