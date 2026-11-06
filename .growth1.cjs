const fs = require('node:fs')
const p = 'G:/dsh-test/soulmirror/lib/persona.js'
let t = fs.readFileSync(p, 'utf8')
let n = 0

// ① 画像文件 + 读写 + 渲染
if (!t.includes('PROFILE_FILE')) {
  const anchor = 'export function ensurePersona(dir) {'
  const block = `/** 结构化画像（比 markdown 层更适合机器读写；由 lib/persona-growth.js 维护） */
export const PROFILE_FILE = 'PROFILE.json'

/** 读画像；不存在返回 null */
export function loadProfile(dir) {
  try {
    const raw = readFileSync(join(dir, PROFILE_FILE), 'utf8').replace(/^\\uFEFF/, '')
    const j = JSON.parse(raw)
    return j && j.sections ? j : null
  } catch {
    return null
  }
}

/** 写画像（原子感：先写再返回，失败抛错） */
export function saveProfile(dir, profile) {
  ensurePersona(dir)
  writeFileSync(join(dir, PROFILE_FILE), JSON.stringify(profile, null, 1), 'utf8')
  return profile
}

/**
 * 完整的人格块：markdown 四层（手写底色）+ 结构化画像（自动成长）。
 * 顺序：SOUL → IDENTITY → 画像（身份/口吻/立场/事实/状态）。
 */
export function fullPersonaBlock(dir, { maxChars = 6000 } = {}) {
  const parts = []
  try {
    const p = loadPersona(dir)
    if (p.soul) parts.push(p.soul)
    if (p.identity) parts.push(p.identity)
  } catch { /* ignore */ }
  try {
    const profile = loadProfile(dir)
    if (profile) {
      const r = renderProfile(profile, { maxChars: Math.max(800, maxChars - 1200) })
      if (r) parts.push('# 关于她（自动积累，按此判断与口吻）\\n' + r)
    }
  } catch { /* ignore */ }
  const text = parts.join('\\n\\n')
  return text.length > maxChars ? text.slice(0, maxChars) + '\\n…（已截断）' : text
}

` + anchor
  t = t.replace(anchor, block)
  n++
}

// ② 导入 profile 渲染
if (!t.includes("from './persona-growth.js'")) {
  const firstImport = t.indexOf('import ')
  t = t.slice(0, firstImport) + "import { renderProfile } from './persona-growth.js'\n" + t.slice(firstImport)
  n++
}

fs.writeFileSync(p, t, 'utf8')
console.log('persona.js 已加画像读写，改', n, '处')
