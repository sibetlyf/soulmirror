import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/**
 * 静态检查（替代 no-undef 的最低保障）。
 *
 * 事故：`_pushLine` 里调用实例方法漏写 `this.`，
 * 运行时抛 ReferenceError，又被空 catch 吞掉 → "界面有字、日志没有"。
 * ESLint 不在依赖里，所以这里用最朴素的办法盯住同类问题：
 *   · 类里定义的私有方法，任何地方调用都必须带 this. / 对象前缀
 *   · 用到但没导入的 fs 函数（unlink 就漏过）
 */

const session = readFileSync(new URL('../lib/session.js', import.meta.url), 'utf8')

test('session 里的私有方法调用都带了 this.（防再漏）', () => {
  // 收集类内定义：两空格缩进的 [a-zA-Z_](...) {  或  async name(
  const defined = new Set()
  for (const m of session.matchAll(/^ {2}(?:async\s+)?(_?[a-zA-Z][\w$]*)\s*\(/gm)) {
    defined.add(m[1])
  }
  assert.ok(defined.has('_appendTranscript'), '应能识别出私有方法定义')

  const offenders = []
  const lines = session.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    // 跳过定义行与注释
    if (/^ {2}(?:async\s+)?_?[a-zA-Z][\w$]*\s*\(/.test(line)) continue
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) continue
    for (const name of defined) {
      if (!name.startsWith('_')) continue          // 只看私有方法，避免误报
      if (name === 'constructor') continue
      // 裸调用：行内出现 name( 但前面不是 . 或单词字符
      const re = new RegExp(`(^|[^\\w.$])${name}\\s*\\(`)
      if (re.test(line)) offenders.push({ line: i + 1, name, text: line.trim().slice(0, 80) })
    }
  }
  assert.deepEqual(offenders, [], '这些地方可能漏了 this.：' + JSON.stringify(offenders.slice(0, 5)))
})

test('用到 fs/promises 的函数都已导入（unlink 曾漏）', () => {
  const importLine = (session.match(/import \{([^}]*)\} from 'node:fs\/promises'/) || [])[1] || ''
  const imported = new Set(importLine.split(',').map((x) => x.trim()).filter(Boolean))
  for (const fn of ['mkdir', 'appendFile', 'writeFile', 'readFile', 'stat', 'unlink']) {
    if (new RegExp(`\\b${fn}\\(`).test(session) && !new RegExp(`\\b${fn}\\b`).test(session.slice(0, session.indexOf('\n\n')))) {
      // 只看是否在导入语句里
      assert.ok(imported.has(fn) || !new RegExp(`await ${fn}\\(`).test(session), 'fs/promises 的 ' + fn + ' 被使用但没导入')
    }
  }
  assert.ok(imported.has('unlink'), 'unlink 必须在导入里')
})
