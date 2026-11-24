/**
 * lib/kb-store.js —— 知识库索引的持久化与增量更新。
 *
 * v1.5.13 的 `kb-index.js` 只有内存索引，重启即丢、也没数据源。这里补上：
 *   · 落盘到 `~/.dsh/soulmirror/kb-index.json`
 *   · 按内容哈希做**增量**：内容没变的文档不重建、不重复写
 *   · 条数上限（默认 200 篇），超出丢最久未更新的，避免文件无限膨胀
 *   · 带更新时间的元数据，便于排查"索引是不是旧的"
 *
 * IO 只在这一层：`buildFromDocs` 是纯函数（可单测），`loadStore/saveStore` 才碰磁盘。
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { ingestDoc } from './kb-index.js'

export const KB_STORE_MAX_DOCS = 200
export const KB_STORE_VERSION = 1

export function emptyStore() {
  return { version: KB_STORE_VERSION, updatedAt: '', docs: [] }
}

/** 读盘；不存在/损坏/形状不对一律退回空库（不因索引坏掉而让插件起不来） */
export function loadStore(file) {
  try {
    const data = JSON.parse(readFileSync(file, 'utf8'))
    if (!data || typeof data !== 'object' || !Array.isArray(data.docs)) return emptyStore()
    return {
      version: Number(data.version) || KB_STORE_VERSION,
      updatedAt: String(data.updatedAt || ''),
      docs: data.docs.filter((d) => d && typeof d === 'object' && Array.isArray(d.tokens)),
    }
  } catch {
    return emptyStore()
  }
}

/** 写盘（缩进 JSON，人可读；父目录自动建） */
export function saveStore(file, store) {
  const data = store && Array.isArray(store.docs) ? store : emptyStore()
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify({
    version: KB_STORE_VERSION,
    updatedAt: new Date().toISOString(),
    docs: data.docs,
  }, null, 2), 'utf8')
}

/** 内容指纹：用标题+正文长度+首尾片段，避免把整篇正文算哈希（长文档也快） */
export function docFingerprint(doc = {}) {
  const title = String(doc.title || '')
  const text = String(doc.text || '')
  const head = text.slice(0, 120)
  const tail = text.slice(-120)
  const raw = title + '|' + text.length + '|' + head + '|' + tail
  let h = 0
  for (let i = 0; i < raw.length; i++) h = (h * 31 + raw.charCodeAt(i)) | 0
  return 'fp' + (h >>> 0).toString(36)
}

/**
 * 增量构建：给一批文档（{id,title,text,tags}），只重建新增/变化的，其余原样保留。
 * @returns {{store:object, added:number, updated:number, unchanged:number, removed:number}}
 */
export function buildFromDocs(store, docs = [], { maxDocs = KB_STORE_MAX_DOCS, now = () => new Date().toISOString() } = {}) {
  const base = store && Array.isArray(store.docs) ? { ...store } : emptyStore()
  const oldById = new Map(base.docs.map((d) => [String(d.id), d]))
  const next = []
  let added = 0
  let updated = 0
  let unchanged = 0
  const seen = new Set()
  for (const doc of docs) {
    const id = String(doc && (doc.id || doc.title) || '').trim()
    if (!id) continue
    seen.add(id)
    const fp = docFingerprint(doc)
    const prev = oldById.get(id)
    if (prev && prev.fingerprint === fp) {
      unchanged += 1
      next.push({ ...prev, lastSeenAt: now() })
      continue
    }
    const entry = { ...ingestDoc({ ...doc, id }), fingerprint: fp, indexedAt: now(), lastSeenAt: now() }
    if (prev) updated += 1
    else added += 1
    next.push(entry)
  }
  // 本次没出现但库里有的：保留（可能是别的来源），只把"很久没出现"的裁掉
  for (const d of base.docs) {
    if (seen.has(String(d.id))) continue
    next.push(d)
  }
  const trimmed = next
    .slice()
    .sort((a, b) => String(b.lastSeenAt || b.indexedAt || '').localeCompare(String(a.lastSeenAt || a.indexedAt || '')))
    .slice(0, Math.max(1, maxDocs))
  const removed = base.docs.length + added + updated - trimmed.length >= 0
    ? Math.max(0, next.length - trimmed.length)
    : 0
  return {
    store: { version: KB_STORE_VERSION, updatedAt: now(), docs: trimmed },
    added, updated, unchanged, removed,
  }
}
