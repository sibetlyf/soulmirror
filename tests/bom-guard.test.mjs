import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * BOM 守卫。
 *
 * 真实事故：PowerShell 的 `Set-Content -Encoding utf8` 会写 BOM(EF BB BF)，
 * JS 里无害，但 package.json 带 BOM 会让 DSH 直接跳过整个插件：
 *   skipping profile bundle "soulmirror": SyntaxError: Unexpected token '﻿'
 *
 * 所以：仓库里任何 JSON / JS / MJS 都不许带 BOM。
 */
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const SKIP = new Set(['node_modules', '.git'])

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue
    const full = join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) walk(full, out)
    else if (/\.(json|js|mjs)$/.test(name)) out.push(full)
  }
  return out
}

test('仓库里的 JSON / JS / MJS 文件不能带 BOM', () => {
  const bad = []
  for (const file of walk(root)) {
    const buf = readFileSync(file)
    if (buf.length >= 3 && buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) {
      bad.push(file.slice(root.length + 1))
    }
  }
  assert.deepEqual(bad, [], '带 BOM 的文件会让 DSH 跳过插件：' + bad.join(', '))
})

test('package.json 必须是合法 JSON 且能被 JSON.parse 直接读', () => {
  const raw = readFileSync(join(root, 'package.json'), 'utf8')
  assert.ok(!raw.startsWith('\uFEFF'), 'package.json 开头不能有 BOM')
  const j = JSON.parse(raw)
  assert.equal(typeof j.name, 'string')
  assert.equal(typeof j.version, 'string')
})
