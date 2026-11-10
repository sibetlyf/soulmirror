#!/usr/bin/env node
/**
 * 作用域检查：找出"引用了不存在的变量"这类运行时才炸的错误。
 *
 * 背景：recTimer 在 try 块里用 const 声明，却在外层 finally 里 clearInterval(recTimer)，
 * 每次会后重转写都以 ReferenceError 收尾。node --check 只查语法，查不出这种问题。
 *
 * 做法：用 TypeScript 编译器以 checkJs 方式分析 JS，只保留"名字找不到 / 声明前使用"
 * 这几类诊断，其它类型错误一律忽略（本项目不是 TS，不追求类型正确）。
 *
 * 用法：node scripts/check-scope.mjs [文件...]   （默认 index.js + lib/*.js）
 * 退出码：有问题 = 1。
 */
import { createRequire } from 'node:module'
import { readdirSync, existsSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * 普通 Node 解析（CI 应安装项目开发工具），或显式 SOULMIRROR_TYPESCRIPT 路径。
 * 不执行 npm、不扫描全局目录、不捕获子进程 stdio；缺工具必须失败，不能算通过。
 * 当前开发机 node_modules 是宿主 junction，禁止为检查而改动该链接/宿主依赖。
 */
export function loadTypeScript({ compilerPath = process.env.SOULMIRROR_TYPESCRIPT || '', requireFn } = {}) {
  const req = requireFn || createRequire(join(ROOT, 'package.json'))
  try { return req(compilerPath ? resolve(compilerPath) : 'typescript') } catch { return null }
}

// 只关心这几类：名字不存在、声明前使用、块作用域变量越界
const CODES = new Set([
  2304, // Cannot find name 'x'
  2552, // Cannot find name 'x'. Did you mean 'y'?
  2448, // Block-scoped variable 'x' used before its declaration
  2454, // Variable 'x' is used before being assigned
  2474, // const enum ...（基本不会出现，保留）
  1155, // 'const' declarations must be initialized
])

// 运行环境提供的全局（浏览器 / Node / DSH 注入），不算问题
const ALLOWED_GLOBALS = new Set([
  'window', 'document', 'navigator', 'location', 'localStorage', 'sessionStorage',
  'fetch', 'EventSource', 'WebSocket', 'requestAnimationFrame', 'cancelAnimationFrame',
  'Blob', 'URL', 'URLSearchParams', 'TextDecoder', 'TextEncoder', 'AbortController',
  'structuredClone', 'queueMicrotask', 'performance', 'getComputedStyle', 'matchMedia',
  'ResizeObserver', 'MutationObserver', 'IntersectionObserver', 'CustomEvent', 'Event',
  'HTMLElement', 'Element', 'Node', 'alert', 'confirm', 'prompt', 'open', 'close',
  'process', 'Buffer', 'global', 'globalThis', '__dirname', '__filename', 'require', 'module',
  'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'clearImmediate',
  'console', 'React', 'ReactDOM',
])

export function defaultFiles() {
  const lib = join(ROOT, 'lib')
  return [join(ROOT, 'index.js'), ...readdirSync(lib).filter((f) => f.endsWith('.js')).map((f) => join(lib, f))]
}

export function checkScope(files = defaultFiles(), options = {}) {
  const ts = options.loadCompiler ? options.loadCompiler() : loadTypeScript()
  if (!ts) return { ok: false, unavailable: true, problems: [], error: '作用域检查未执行：找不到 TypeScript。CI 请准备 TypeScript 开发工具，或显式设置 SOULMIRROR_TYPESCRIPT；不能把缺工具视为通过。' }
  const missing = files.filter((f) => !existsSync(f))
  if (missing.length) return { ok: false, unavailable: true, problems: [], error: '作用域检查输入不存在：' + missing.join(', ') }
  const program = ts.createProgram(files, {
    allowJs: true, checkJs: true, noEmit: true, skipLibCheck: true,
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'], types: [], noLib: false,
    strict: false, noImplicitAny: false,
  })
  const problems = []
  const wanted = new Set(files.map((f) => resolve(f).toLowerCase()))
  for (const sf of program.getSourceFiles()) {
    if (!wanted.has(resolve(sf.fileName).toLowerCase())) continue
    const syntax = program.getSyntacticDiagnostics(sf)
    for (const d of [...syntax, ...program.getSemanticDiagnostics(sf)]) {
      if ((!CODES.has(d.code) && !syntax.includes(d)) || d.start == null) continue
      const msg = ts.flattenDiagnosticMessageText(d.messageText, ' ')
      const name = (msg.match(/'([^']+)'/) || [])[1] || ''
      if (ALLOWED_GLOBALS.has(name)) continue
      const { line, character } = sf.getLineAndCharacterOfPosition(d.start)
      problems.push({
        file: resolve(sf.fileName).slice(ROOT.length + 1).replace(/\\/g, '/'),
        line: line + 1, col: character + 1, code: d.code, name, message: msg,
      })
    }
  }
  return { ok: problems.length === 0, problems }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  const r = checkScope(args.length ? args.map((a) => resolve(a)) : undefined)
  if (r.unavailable) { console.error(r.error); process.exit(2) }
  for (const p of r.problems) console.log(`${p.file}:${p.line}:${p.col}  TS${p.code}  ${p.message}`)
  console.log(r.ok ? '作用域检查通过' : `作用域检查：${r.problems.length} 处问题`)
  process.exit(r.ok ? 0 : 1)
}
