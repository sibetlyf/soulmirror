import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * 静态守卫：源码里用到的 fs 函数，必须有名字来源。
 *
 * 来由：probeRenderDevices 里写了 await mkdir(...) 但只 import 了 mkdirSync，
 * 一调用就 ReferenceError: mkdir is not defined。
 * 这类错跑不到单元测试，只能在运行时炸，所以这里做静态检查。
 *
 * 三种合法来源都要认：
 *   1. 顶部具名/默认导入
 *   2. 命名空间导入（fsp.writeFile）
 *   3. 函数内动态解构（const { writeFile } = await import('node:fs/promises')）
 */

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

const FS_FNS = ['mkdir', 'writeFile', 'readFile', 'appendFile', 'rm', 'rename', 'copyFile', 'unlink', 'readdir', 'stat', 'mkdtemp', 'readFileSync', 'writeFileSync', 'mkdirSync', 'existsSync']

/** 顶部导入的名字 */
function importedNames(src) {
  const names = new Set()
  for (const m of src.matchAll(/import\s+(?:([\w$]+)\s*,\s*)?\{([^}]*)\}\s*from\s*['"][^'"]+['"]/g)) {
    if (m[1]) names.add(m[1])
    for (const part of m[2].split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop().trim()
      if (name) names.add(name)
    }
  }
  for (const m of src.matchAll(/import\s+([\w$]+)\s+from\s*['"][^'"]+['"]/g)) names.add(m[1])
  return names
}

/** 命名空间导入：import { promises as fsp } / import * as fsp */
function namespaces(src) {
  const out = new Set()
  for (const m of src.matchAll(/import\s+\{[^}]*promises\s+as\s+([\w$]+)/g)) out.add(m[1])
  for (const m of src.matchAll(/import\s+\*\s*as\s+([\w$]+)/g)) out.add(m[1])
  return out
}

/** 函数内动态解构出来的名字 */
function dynamicNames(src) {
  const out = new Set()
  for (const m of src.matchAll(/const\s*\{([^}]*)\}\s*=\s*await\s+import\(\s*['"]node:fs/g)) {
    for (const part of m[1].split(',')) {
      const name = part.trim().split(/\s*:\s*/).pop().trim()
      if (name) out.add(name)
    }
  }
  return out
}

test('用到的 fs 函数都必须有名字来源（防 ReferenceError: xxx is not defined）', () => {
  const files = ['index.js', ...readdirSync(join(root, 'lib')).filter((f) => f.endsWith('.js')).map((f) => join('lib', f))]
  const problems = []
  for (const rel of files) {
    let src
    try { src = readFileSync(join(root, rel), 'utf8') } catch { continue }
    const named = importedNames(src)
    const ns = namespaces(src)
    const dyn = dynamicNames(src)

    for (const fn of FS_FNS) {
      const direct = new RegExp('(?:await\\s+|[^\\w.$])' + fn + '\\s*\\(').test(src)
      if (!direct) continue
      const declared = new RegExp('(?:function|const|let|var)\\s+' + fn + '\\b').test(src)
      const viaNs = [...ns].some((n) => new RegExp(n.replace(/\$/g, '\\$') + '\\.' + fn + '\\s*\\(').test(src))
      // 命名空间调用时，本名 fn( 不算错，只要该文件里确实用 fn( 而非 ns.fn( 就行
      if (named.has(fn) || declared || dyn.has(fn)) continue
      // 只有"裸调用 fn(" 才算问题；纯 ns.fn( 由 viaNs 覆盖
      const bare = new RegExp('(?:await\\s+|[^\\w.$])' + fn + '\\s*\\(').test(src) && !/[\w$]\.[a-zA-Z]*\s*$/.test('')
      if (bare && !viaNs) problems.push(rel + ' → ' + fn)
    }
  }
  assert.deepEqual(problems, [], '这些函数被调用但没有名字来源：' + problems.join('、'))
})
