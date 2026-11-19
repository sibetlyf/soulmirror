/**
 * lib/join-playbook.js —— computer-use 入会的"经验库"。
 *
 * 用户要求：每次用 computer-use 成功进入会议后，把这次的过程简要落盘，
 * 以便加快后面进入会议的过程，并且要及时更新。
 *
 * 为什么有用：入会按钮位置随版本/分辨率/窗口尺寸而变，但同一台机器、同一窗口尺寸下
 * 往往长期稳定。把"上次在这台机器、这个窗口尺寸下，点了哪里、看到了什么"记下来，
 * 下次可以先按经验走一步，不对再交回截图判断——比每次从零看屏幕快。
 *
 * 设计约束（照开发规程）：
 *   · 纯函数，便于单测；不碰真实桌面、不联网
 *   · 只记"过程要点"，不记会议内容/转写/人名
 *   · 按 app + 窗口尺寸去重，只保留最近的成功经验；条数有上限，避免无限增长
 *   · 写盘由调用方做（本模块只产出结构），失败要可见，不许静默吞
 */
import { readFileSync, writeFileSync } from 'node:fs'

/** 最多保留多少条经验（超出丢最旧的） */
export const PLAYBOOK_MAX = 20

/** 空库结构 */
export function emptyPlaybook() {
  return { version: 1, entries: [] }
}

/** 读库；文件不存在或损坏都退回空库（调用方不应因此失败） */
export function loadPlaybook(file) {
  try {
    const raw = readFileSync(file, 'utf8')
    const data = JSON.parse(raw)
    if (!data || typeof data !== 'object' || !Array.isArray(data.entries)) return emptyPlaybook()
    return { version: Number(data.version) || 1, entries: data.entries.filter((e) => e && typeof e === 'object') }
  } catch {
    return emptyPlaybook()
  }
}

/** 写库（缩进 JSON，人可读；失败抛给调用方） */
export function savePlaybook(file, store) {
  const data = store && Array.isArray(store.entries) ? store : emptyPlaybook()
  writeFileSync(file, JSON.stringify({ version: 1, entries: data.entries }, null, 2), 'utf8')
}

/** 经验键：同一客户端 + 同一窗口尺寸视为同一条经验 */
export function playbookKey(app, win) {
  const name = String(app || '').trim() || '未知客户端'
  const w = Number(win && win.w) || 0
  const h = Number(win && win.h) || 0
  return name + '@' + w + 'x' + h
}

/**
 * 写入一条成功经验（同键覆盖并置顶，保留最近 PLAYBOOK_MAX 条）。
 * @param {{entries:Array}} store
 * @param {{app:string, win?:{w:number,h:number}, at?:string, steps?:string[], note?:string}} entry
 */
export function upsertEntry(store, entry = {}) {
  const base = store && Array.isArray(store.entries) ? { ...store } : emptyPlaybook()
  const app = String(entry.app || '').trim() || '未知客户端'
  const win = { w: Number(entry.win && entry.win.w) || 0, h: Number(entry.win && entry.win.h) || 0 }
  const key = playbookKey(app, win)
  const steps = (entry.steps || []).map((s) => String(s || '').trim()).filter(Boolean).slice(0, 12)
  const at = String(entry.at || '') || new Date().toISOString()
  const prev = base.entries.find((e) => playbookKey(e && e.app, e && e.win) === key)
  const successes = (Number(prev && prev.successes) || 0) + 1
  const fresh = {
    key,
    app,
    win,
    at,
    successes,
    steps,
    note: String(entry.note || '').slice(0, 200),
  }
  const others = base.entries.filter((e) => playbookKey(e && e.app, e && e.win) !== key)
  return { version: 1, entries: [fresh, ...others].slice(0, PLAYBOOK_MAX) }
}

/** 取与当前客户端+窗口尺寸匹配的那条经验 */
export function findEntry(store, { app = '', win } = {}) {
  const entries = (store && store.entries) || []
  const key = playbookKey(app, win)
  return entries.find((e) => playbookKey(e && e.app, e && e.win) === key) || null
}

/**
 * 生成给 computer-use 提示词用的"上次经验"（没有就返回空串）。
 * 只给事实：上次成功的窗口尺寸、点击步骤；并明确"如果对不上就以截图为准"。
 */
export function buildPlaybookHint(store, { app = '', win } = {}) {
  const hit = findEntry(store, { app, win })
  if (!hit || !Array.isArray(hit.steps) || hit.steps.length === 0) return ''
  const size = hit.win && hit.win.w ? hit.win.w + 'x' + hit.win.h : '未知尺寸'
  const lines = []
  lines.push('【上次在这台机器上成功的入会过程（可先照做，对不上就以截图为准）】')
  lines.push('窗口尺寸：' + size + '；成功次数：' + (hit.successes || 1) + '；更新时间：' + (hit.at || ''))
  hit.steps.forEach((s, i) => lines.push('  ' + (i + 1) + '. ' + s))
  if (hit.note) lines.push('备注：' + hit.note)
  lines.push('注意：先按上面的步骤走；任何一步与屏幕实际不同，立即改为先截图再判断，不要凑合点。')
  return lines.join('\n')
}

/**
 * 解析 computer-use 子会话的回报，抽出入会结论与可复用的步骤。
 * 期望格式（提示词里会要求）：
 *   RESULT: joined|failed
 *   DETAIL: …
 *   EVIDENCE: …
 *   WIN: 1516x988
 *   STEPS:
 *   - 点「加入会议」按钮（约 x=0.25,y=0.26）
 */
export function parseVisualReport(text = '') {
  const s = String(text || '').replace(/\r/g, '')
  const result = (/RESULT:\s*(joined|failed)/i.exec(s) || [, ''])[1].toLowerCase()
  const detail = (/DETAIL:\s*(.+)/.exec(s) || [, ''])[1].trim()
  const evidence = (/EVIDENCE:\s*(.+)/.exec(s) || [, ''])[1].trim()
  const winRaw = (/WIN:\s*(\d+)\s*[x×]\s*(\d+)/i.exec(s) || [, '', '']).slice(1)
  const win = winRaw[0] ? { w: Number(winRaw[0]), h: Number(winRaw[1]) } : null
  const stepsBlock = (/STEPS:\s*\n([\s\S]*?)(?:\n[A-Z]+:|$)/.exec(s) || [, ''])[1]
  const steps = stepsBlock
    .split('\n')
    .map((l) => l.replace(/^\s*[-*\d.)、]+\s*/, '').trim())
    .filter((l) => l && l.length <= 160)
    .slice(0, 12)
  return { result, detail, evidence, win, steps }
}
