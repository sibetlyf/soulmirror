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

test('apply 注册了侧栏图标 / 会话字幕条 / 设置页 三处原生入口', () => {
  const { exp, registered } = loadClient()
  exp.apply({ slots: { inject(n, fn) { fn() }, register(m, c) { registered.push({ meta: m, comp: c }) }, get: () => null } })
  const names = registered.map((r) => r.meta.name)
  assert.ok(names.includes('sidebar.panellist'), '缺少侧栏图标：' + names.join(','))
  assert.ok(names.includes('conversation.input.dock'), '缺少会话字幕条')
  assert.ok(names.includes('settings.section'), '缺少设置页')
})

test('注册了 main#soulmirror 主面板（否则点侧栏只高亮、右侧仍是首页）', () => {
  const { exp, registered } = loadClient()
  exp.apply({ slots: { inject(n, fn) { fn() }, register(m, c) { registered.push({ meta: m, comp: c }) }, get: () => null } })
  const main = registered.find((r) => r.meta.name === 'main')
  assert.ok(main, '缺少 main 注册：' + registered.map((r) => r.meta.name).join(','))
  assert.equal(main.meta.key, 'soulmirror', 'key 必须与侧栏 panellist 的 id 一致')
  const panel = registered.find((r) => r.meta.name === 'sidebar.panellist')
  assert.equal(panel.meta.id, main.meta.key, 'panellist.id 必须等于 main.key')
})

test('侧栏图标只画图形，不嵌套 button（DSH 外层已有 button）', () => {
  const { exp } = loadClient()
  const el = exp.__test.PanelIcon({ size: 16, active: false })
  assert.ok(el, 'PanelIcon 应返回元素')
  assert.notEqual(el.t, 'button', '不要在 slot 里再套一个 button：会多一层内边距且点击冲突')
  assert.equal(el.t, 'span')
})

test('这三处组件渲染都不抛错（防白屏）', () => {
  const { exp } = loadClient()
  const panels = exp.__test
  for (const key of ['PanelIcon', 'LiveDock', 'SettingsSection']) {
    assert.equal(typeof panels[key], 'function', '缺少 __test.' + key)
    assert.doesNotThrow(() => panels[key]({}), key + ' 渲染抛错')
  }
})

test('所有在 onClick 里调用的函数都必须有定义（防"点了没反应"）', () => {
  const src = readFileSync(join(here, '..', 'lib', 'client.js'), 'utf8')
  // 收集形如 xxx(...) 的调用，只盯我们自己的这几个已知动作函数
  const names = new Set()
  for (const m of src.matchAll(/\b(switchMode|callAuto|switchApp|runDemo)\s*\(/g)) names.add(m[1])
  for (const name of names) {
    assert.match(src, new RegExp('function ' + name + '\\s*\\('), name + ' 被调用但未定义 —— 点击会抛 ReferenceError，表现为"没反应"')
  }
  assert.ok(names.has('switchMode'), '至少要有 switchMode 的调用（否则这个守护无效）')
})

test('live 状态必须能承载 mode（否则模式按钮切换后界面读不到 → "没反应"）', () => {
  const { exp } = loadClient()
  const { live } = exp.__test
  assert.equal(live.mode, 'transcribe', '默认模式应是 transcribe')
  live.set({ mode: 'agent' })
  assert.equal(live.mode, 'agent', 'live.set 应更新 mode')
  live.set({ mode: 'transcribe' })
  assert.equal(live.mode, 'transcribe')
  live.set({ enabled: true })
  assert.equal(live.enabled, true, '对照：enabled 仍应正常')
  live.set({ enabled: false })
})

test('SetupCard 能渲染（含 compact 模式）—— 防 props 未接线导致白屏', () => {
  const { exp } = loadClient()
  for (const props of [{}, { compact: true }]) {
    const out = exp.__test.SetupCard(props)
    assert.ok(out, '应返回节点')
  }
})

test('DevicePicker 能渲染', () => {
  const { exp } = loadClient()
  for (const props of [{}, { wide: true, value: '扬声器' }]) {
    assert.ok(exp.__test.DevicePicker(props))
  }
})

test('所有导出的面板组件都能在默认 props 下渲染', () => {
  const { exp } = loadClient()
  const names = ['PanelIcon', 'LiveDock', 'SettingsSection', 'SetupCard', 'DevicePicker', 'StatusStrip', 'AfterMeetingCard', 'PrepareCard', 'RecordsCard', 'CompactPanel', 'MeetingPage', 'Overlay']
  for (const name of names) {
    const comp = exp.__test[name]
    assert.ok(comp, name + ' 未导出')
    assert.doesNotThrow(() => comp({}), name + ' 渲染抛错')
  }
})

// 把渲染树里的文字收集起来（fake React 下宿主元素是 {t,p,c}）
function textOf(node, out = []) {
  if (node == null || node === false) return out
  if (typeof node === 'string' || typeof node === 'number') { out.push(String(node)); return out }
  if (Array.isArray(node)) { for (const n of node) textOf(n, out); return out }
  if (typeof node === 'object') {
    if (node.c) textOf(node.c, out)
    if (node.p && typeof node.p === 'object') {
      for (const v of Object.values(node.p)) {
        if (typeof v === 'string') out.push(v)
      }
    }
  }
  return out
}

test('StatusStrip 能反映连接状态（这是"一点提示都没有"的修复点）', () => {
  const { exp } = loadClient()
  const strip = exp.__test.StatusStrip
  assert.ok(strip, 'StatusStrip 未导出')

  // 1) 连上了、也有音频
  const okText = textOf(strip({ state: { session: { asr: { online: true, phase: 'online', sentMs: 12500, reconnects: 0 } }, transcript: [{ t: new Date().toISOString() }] } })).join(' ')
  assert.match(okText, /百炼已连接/)
  assert.match(okText, /已送 12 秒音频/)
  assert.match(okText, /最后一句/)

  // 2) 连不上
  const failText = textOf(strip({ state: { session: { asr: { failed: true, phase: 'failed', sentMs: 0, lastError: '401 Unauthorized' } }, transcript: [] } })).join(' ')
  assert.match(failText, /连接失败/)
  assert.match(failText, /401/)

  // 3) 连上了但一个字节都没送进去 —— 这正是之前"看着正常其实没工作"的状态
  const noAudioText = textOf(strip({ state: { session: { asr: { online: true, phase: 'online', sentMs: 0 } }, transcript: [] } })).join(' ')
  assert.match(noAudioText, /百炼已连接/)
  assert.match(noAudioText, /还没收到音频/)
  assert.match(noAudioText, /还没有转写/)
})

test('小窗 / 大页面 / Overlay 都能渲染', () => {
  const { exp } = loadClient()
  const { CompactPanel, MeetingPage, Overlay } = exp.__test
  assert.doesNotThrow(() => CompactPanel({}))
  assert.doesNotThrow(() => MeetingPage({}))
  assert.doesNotThrow(() => Overlay({}))
})
