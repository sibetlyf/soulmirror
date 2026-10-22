/** 繁体 → 简体（OpenCC TSCharacters 表，打包在 lib/data/ts.txt） */
import { readFileSync } from 'node:fs'

let MAP = null

function load() {
  if (MAP) return MAP
  MAP = new Map()
  try {
    const txt = readFileSync(new URL('./data/ts.txt', import.meta.url), 'utf8')
    for (const line of txt.split('\n')) {
      if (!line || line.startsWith('#')) continue
      const tab = line.indexOf('\t')
      if (tab <= 0) continue
      const k = line.slice(0, tab).trim()
      const v = line.slice(tab + 1).trim()
      if (!k || !v) continue
      const first = v.split(/\s+/)[0]
      if (first && first !== k) MAP.set(k, first)
    }
  } catch { /* 表缺失就原样返回 */ }
  return MAP
}

/** 逐字转换；表里没有的字符原样保留 */
export function toSimplified(text) {
  if (!text) return text
  const m = load()
  if (m.size === 0) return text
  let out = ''
  for (const ch of text) out += m.get(ch) || ch
  return out
}
