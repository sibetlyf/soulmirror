/**
 * lib/meeting-id.js —— 会议身份（同一场会 → 同一个 session）
 *
 * 拿不到就退化：
 *  1. 显式指定的会议号（setMeetingId / 配置）
 *  2. 窗口标题里出现的会议号（腾讯会议有时把 206-275-219 写进标题）
 *  3. 窗口标题本身（会议主题）—— 同一主题视为同一场会
 *  4. 时间戳（最后的兜底）
 *
 * 身份 → 会话的映射持久化在 ~/.dsh/soulmirror/sessions.json，
 * 所以「退出再进入同一场会」会续接原来的 DSH 会话。
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

const ID_RE = /(\d{3})[\s-]?(\d{3})[\s-]?(\d{3})/

/** 把标题/显式值归一化成会议 key */
export function deriveMeetingKey({ explicit = '', title = '' } = {}) {
  const ex = String(explicit || '').trim()
  if (ex) {
    const m = ID_RE.exec(ex)
    return { key: m ? m.slice(1, 4).join('') : ex, source: 'explicit', display: ex }
  }
  const t = String(title || '').trim()
  if (!t) return { key: '', source: 'none', display: '' }
  const m = ID_RE.exec(t)
  if (m) return { key: m.slice(1, 4).join(''), source: 'title-id', display: m[0] }
  // 标题里的同名会议视为同一场
  const norm = t.replace(/\s+/g, ' ').toLowerCase()
  return { key: 'topic:' + norm, source: 'title', display: t }
}

/** 目录名安全化 */
export function safeName(key) {
  return String(key || 'meeting').replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 80)
}

export class SessionMap {
  constructor(file) {
    this.file = file
    this.data = {}
    this.load()
  }

  load() {
    try {
      if (existsSync(this.file)) {
        const raw = JSON.parse(readFileSync(this.file, 'utf8').replace(/^\uFEFF/, ''))
        if (raw && typeof raw === 'object') this.data = raw
      }
    } catch { this.data = {} }
    return this.data
  }

  save() {
    try {
      mkdirSync(dirname(this.file), { recursive: true })
      writeFileSync(this.file, JSON.stringify(this.data, null, 1), 'utf8')
    } catch { /* ignore */ }
  }

  get(key) {
    return this.data[key] || null
  }

  set(key, value) {
    this.data[key] = { ...(this.data[key] || {}), ...value, lastSeen: new Date().toISOString() }
    this.save()
    return this.data[key]
  }

  list(limit = 20) {
    return Object.entries(this.data)
      .sort((a, b) => String(b[1].lastSeen || '').localeCompare(String(a[1].lastSeen || '')))
      .slice(0, limit)
      .map(([key, v]) => ({ key, ...v }))
  }
}
