#!/usr/bin/env node
/**
 * 生成 manifest.json：插件运行时文件的 path → sha256。
 *
 * 增量升级靠它：升级时先取远端 manifest，与本地逐个比对，
 * 只下载 sha256 不一致的文件。
 *
 * 用法：node scripts/gen-manifest.mjs
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

/** 与 lib/upgrade.js 的 isRuntimePath 保持一致 */
function isRuntimePath(p) {
  const s = String(p || '').replace(/\\/g, '/')
  if (!s || s.startsWith('/') || s.includes('..')) return false
  if (s === 'index.js' || s === 'package.json' || s === 'manifest.json' || s === 'README.md') return true
  if (s.startsWith('lib/')) return true
  // tools/ 只同步真正运行需要的：桥接 exe、UIAutomation 脚本、编译产物
  if (s === 'tools/mbridge.exe' || s === 'tools/meeting-bridge.cs') return true
  if (s === 'tools/ui.ps1' || s === 'tools/mic.ps1' || s === 'tools/hold.ps1') return true
  return false
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.git' || name.startsWith('.')) continue
    const abs = join(dir, name)
    const st = statSync(abs)
    if (st.isDirectory()) { walk(abs, out); continue }
    out.push(abs)
  }
  return out
}

const files = []
for (const abs of walk(root)) {
  const rel = relative(root, abs).replace(/\\/g, '/')
  if (!isRuntimePath(rel)) continue
  const buf = readFileSync(abs)
  files.push({
    path: rel,
    sha256: createHash('sha256').update(buf).digest('hex'),
    bytes: buf.length,
  })
}

files.sort((a, b) => a.path.localeCompare(b.path))
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const manifest = { name: pkg.name, version: pkg.version, files }
writeFileSync(join(root, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8')
console.log('manifest.json 已生成：' + files.length + ' 个文件，版本 ' + pkg.version)
