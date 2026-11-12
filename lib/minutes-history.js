/**
 * 历史会议纪要：给"这一次纪要"接上"前几次纪要"。
 *
 * 用户原话：
 *   「会议纪要的时候，还要结合知识库中前几天开的会议纪要，
 *     增加每一次后续任务与用户真实场景的贴合度。」
 *
 * 做法与边界（都是刻意的）：
 *   · 只读本地会议目录里的 minutes.md —— dsh-knowledge 侧目前只有写入/核验，
 *     没有"按时间读回纪要"的稳定接口，不能硬造 API。
 *   · 没有纪要文件就没有历史；读不到 / 坏了就跳过，**不生成占位**。
 *   · 无网络、无 UI、无日志：这里只做读取与拼文本，日志由调用方写元数据。
 *   · 摘要只用来"衔接/判断冲突"，字符预算默认 2400，超了截断并可由
 *     historyMeta 读出 truncated —— 历史不能把转写挤出上下文。
 *
 * 纯读取，不修改任何会议目录。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { loadMeta, loadPreparation } from './meeting-record.js'

const DAY_MS = 86400000
/** 会议目录名就是时间戳（导入目录是 `<时间戳>-import`），和 meeting-record 的口径一致 */
const TIMESTAMP_DIR = /^\d{4}-\d{2}-\d{2}/
const MINUTES_NAME = 'minutes.md'
/** 一次最多看多少个会议目录：历史很多时只读最近的这些，避免每次整理都扫全盘 */
const MAX_SCAN_DIRS = 200
/** 超过这个大小的 minutes.md 不读：不是纪要，可能是别的产物误命名 */
const MAX_MINUTES_BYTES = 256 * 1024
/** 单场摘要预算（约 500 字，见需求） */
const EXCERPT_CHARS = 500
/** 单场最多抽几条待办（抽不到就是空数组，不许编） */
const MAX_ACTION_ITEMS = 5
/** 历史块默认总预算 */
export const HISTORY_BLOCK_MAX_CHARS = 2400
/** 默认时间窗与场次上限 */
export const HISTORY_DEFAULTS = Object.freeze({ days: 14, limit: 6 })

/** 待办/承诺的提示词（宁可漏抽，不能把"讨论了什么"误当待办） */
const ACTION_CUE = /待办|负责人?|责任人|下周|下个?月|明天|后天|截止|之前|前完成|交付|跟进|落实/
/** 明显不是待办的行：章节标题 */
const NOT_ACTION = /^(?:[一二三四]、|会议纪要$|会议主题$|会议内容$|会议基本信息$)/
/** 二进制垃圾特征：控制字符（保留 \n \r \t）与替换符 */
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/

function toMs(t) {
  if (t instanceof Date) return t.getTime()
  if (typeof t === 'function') {
    try { return toMs(t()) } catch { return NaN }
  }
  const n = Number(t)
  return Number.isFinite(n) ? n : NaN
}

function clampInt(value, fallback, min, max) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.trunc(n)))
}

/** 路径比较键：Windows 下大小写不敏感，统一绝对路径再比 */
function pathKey(p) {
  const abs = resolve(String(p || ''))
  return process.platform === 'win32' ? abs.toLowerCase() : abs
}

/** 本机时区写"2026-11-11 10:46"（与 minutes-format.localStamp 同口径，但不反向依赖它） */
function stamp(ms) {
  const d = new Date(ms)
  const p = (n) => String(n).padStart(2, '0')
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes())
}

/** 截成 n 个字符以内；真的截了才加省略号，长度严格 ≤ n */
function clip(text, n) {
  const s = String(text == null ? '' : text)
  const max = Math.max(0, Math.trunc(n) || 0)
  if (s.length <= max) return s
  if (max <= 1) return s.slice(0, max)
  return s.slice(0, max - 1) + '…'
}

/**
 * 目录名 → 时间。真实目录名来自 new Date().toISOString().replace(/[:.]/g, '-')，
 * 即 `2026-11-12T06-45-44-123Z`（UTC）；也兼容 `2026-11-12T10-00-00`（本机时间）。
 * 解析不出返回 NaN（该目录不参与历史）。
 */
function recordTimeFromName(name) {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T_ ](\d{2})[-:](\d{2})(?:[-:](\d{2}))?)?/.exec(String(name || ''))
  if (!m) return NaN
  const y = Number(m[1])
  const mo = Number(m[2]) - 1
  const d = Number(m[3])
  const hh = Number(m[4] || 0)
  const mm = Number(m[5] || 0)
  const ss = Number(m[6] || 0)
  // 目录名带 Z（ISO UTC）才按 UTC 解释；否则按本机时间
  const isUtc = /Z(?:[.-]|$)/.test(String(name || '').slice(0, 26))
  return isUtc ? Date.UTC(y, mo, d, hh, mm, ss) : new Date(y, mo, d, hh, mm, ss).getTime()
}

/** 时间以 meta 的结束/开始时间为准（导入记录目录名与真实时间可能不同），再退回目录名 */
function recordTime(meta, name) {
  const fromMeta = Date.parse(String((meta && (meta.endedAt || meta.startedAt)) || ''))
  return Number.isFinite(fromMeta) ? fromMeta : recordTimeFromName(name)
}

/**
 * 读一份 minutes.md。返回 {text} 或 {skip:原因}。
 * 损坏文件（二进制垃圾 / 编码坏到满是替换符）直接跳过，绝不把垃圾喂给模型。
 */
function readMinutesText(file) {
  let st
  try { st = statSync(file) } catch { return { skip: 'missing' } }
  if (!st.isFile() || !st.size) return { skip: 'empty' }
  if (st.size > MAX_MINUTES_BYTES) return { skip: 'too-large' }
  let raw = ''
  try { raw = readFileSync(file, 'utf8') } catch { return { skip: 'unreadable' } }
  const text = String(raw || '').replace(/^\uFEFF/, '').trim()
  if (!text) return { skip: 'empty' }
  // 二进制垃圾：控制字符 / 大量替换符（readFileSync 解不出的字节会变成 U+FFFD）
  if (CONTROL_CHARS.test(text.slice(0, 4000))) return { skip: 'corrupt' }
  const bad = (text.match(/\uFFFD/g) || []).length
  if (text.length >= 40 && bad / text.length > 0.02) return { skip: 'corrupt' }
  return { text }
}

/** 去掉行首 Markdown 标题符号、列表符号与强调符，正文不动 */
function cleanLine(line) {
  return String(line == null ? '' : line)
    .replace(/^\s{0,3}#{1,6}\s*/, '')
    .replace(/^\s*(?:[-*+]\s+|\d+[.)]\s+)/, '')
    .replace(/\*\*|__|`/g, '')
    .replace(/\s+$/, '')
    .trim()
}

/** 取某个二级标题下的正文（不含标题本身），清理空行 */
function sectionLines(lines, startRe) {
  const start = lines.findIndex((l) => startRe.test(l))
  if (start < 0) return []
  const out = []
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s/.test(lines[i])) break // 下一个二级标题（### 小节不算）
    const s = cleanLine(lines[i])
    if (s) out.push(s)
  }
  return out
}

const TOPIC_HEADING = /^##\s*二、\s*会议主题/
const CONTENT_HEADING = /^##\s*三、\s*会议内容/

/**
 * 「二、会议主题」+「三、会议内容」前 ~500 字。
 * 找不到这两节时退化成"去掉标题符号的正文前 500 字"（不返回空）。
 */
function excerptOf(minutes) {
  const lines = String(minutes || '').replace(/\r\n?/g, '\n').split('\n')
  const topic = sectionLines(lines, TOPIC_HEADING)
  const content = sectionLines(lines, CONTENT_HEADING)
  if (!topic.length && !content.length) {
    return clip(lines.map(cleanLine).filter(Boolean).join('\n'), EXCERPT_CHARS)
  }
  const parts = []
  if (topic.length) parts.push('主题：' + topic.join(' '))
  if (content.length) parts.push('内容：\n' + content.join('\n'))
  return clip(parts.join('\n'), EXCERPT_CHARS)
}

/** 从纪要正文里抽"待办 / 负责 / 下周 / 截止 / 之前"这类承诺句，抽不到就是空数组 */
function actionItemsOf(minutes) {
  const out = []
  const seen = new Set()
  const lines = String(minutes || '').replace(/\r\n?/g, '\n').split('\n')
  for (const rawLine of lines) {
    const line = cleanLine(rawLine)
    if (!line || line.length < 5 || NOT_ACTION.test(line)) continue
    // 一句里可能有多个分句：逐个看，避免把整段抄进来
    for (const piece of line.split(/[。；;！!？?]/)) {
      const s = piece.trim().replace(/^[，,、]\s*/, '')
      if (s.length < 5 || !ACTION_CUE.test(s)) continue
      const key = s.replace(/\s+/g, '')
      if (seen.has(key)) continue
      seen.add(key)
      out.push(clip(s, 120))
      if (out.length >= MAX_ACTION_ITEMS) return out
    }
  }
  return out
}

/** 纪要「二、会议主题」的正文，用作没有标题字段时的标题（来自纪要本身，不是编的） */
function topicOf(minutes) {
  const lines = String(minutes || '').replace(/\r\n?/g, '\n').split('\n')
  const topic = sectionLines(lines, TOPIC_HEADING)
  return topic.length ? clip(topic.join(' '), 80) : ''
}

/** 把时间窗信息挂在返回的数组上（不参与 JSON 序列化），供 historyMeta 读 days */
function withWindow(list, { days, limit }) {
  Object.defineProperty(list, 'days', { value: days, enumerable: false, configurable: true })
  Object.defineProperty(list, 'limit', { value: limit, enumerable: false, configurable: true })
  return list
}

/**
 * 扫描会议根目录，取最近 `days` 天内、最新的若干场**有纪要**的历史会议。
 *
 * @param {{root?: string, now?: number|Date, days?: number, limit?: number, excludeDir?: string}} o
 *   · root        会议数据根目录（每场会一个时间戳子目录）
 *   · now         当前时间（毫秒）；也接受 Date / 返回时间的函数
 *   · days        时间窗，默认 14 天
 *   · limit       最多几场，默认 6
 *   · excludeDir  要排除的目录（通常是本次会议目录，避免把它上次的纪要当历史）
 * @returns {Array<{dir: string, at: number, title: string, excerpt: string, actionItems: string[], charCount: number}>}
 *   读不到根目录返回空数组；readdir 等非"目录不存在"的异常会抛出，由调用方降级。
 *   返回的数组带不可枚举的 days/limit 元信息。
 */
export function collectHistory({ root = '', now = Date.now(), days = HISTORY_DEFAULTS.days, limit = HISTORY_DEFAULTS.limit, excludeDir = '' } = {}) {
  const dayCount = clampInt(days, HISTORY_DEFAULTS.days, 1, 365)
  const maxCount = clampInt(limit, HISTORY_DEFAULTS.limit, 1, 50)
  const nowMs = toMs(now)
  const rootDir = String(root || '').trim()
  if (!rootDir) return withWindow([], { days: dayCount, limit: maxCount })
  const cutoff = (Number.isFinite(nowMs) ? nowMs : Date.now()) - dayCount * DAY_MS

  let names = []
  try {
    names = readdirSync(rootDir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && TIMESTAMP_DIR.test(d.name))
      .map((d) => d.name)
      .sort()
      .reverse()
      .slice(0, MAX_SCAN_DIRS)
  } catch (e) {
    // 还没开过会 / 根目录还没建：这是正常状态，不是故障
    if (e && (e.code === 'ENOENT' || e.code === 'ENOTDIR')) return withWindow([], { days: dayCount, limit: maxCount })
    throw e
  }

  const excluded = excludeDir ? pathKey(excludeDir) : ''
  const candidates = []
  for (const name of names) {
    const dir = join(rootDir, name)
    if (excluded && pathKey(dir) === excluded) continue
    const meta = loadMeta(dir)
    const at = recordTime(meta, name)
    if (!Number.isFinite(at) || at < cutoff) continue
    candidates.push({ name, dir, at, meta })
  }
  candidates.sort((a, b) => (b.at - a.at) || (a.name < b.name ? 1 : a.name > b.name ? -1 : 0))

  const history = []
  for (const c of candidates) {
    if (history.length >= maxCount) break
    const read = readMinutesText(join(c.dir, MINUTES_NAME))
    if (!read.text) continue // 没纪要 / 坏了 / 不是纪要：跳过，没有占位
    const prep = loadPreparation(c.dir)
    const title = String((prep && prep.goal) || '').trim() ||
      String((c.meta && c.meta.title) || '').trim() ||
      topicOf(read.text) ||
      c.name
    history.push({
      dir: c.dir,
      at: c.at,
      title: clip(title, 80),
      excerpt: excerptOf(read.text),
      actionItems: actionItemsOf(read.text),
      charCount: read.text.length,
    })
  }
  return withWindow(history, { days: dayCount, limit: maxCount })
}

/** 单场历史在提示词里的样子 */
function entryText(entry, index) {
  const at = Number(entry && entry.at)
  const dirName = basename(String((entry && entry.dir) || ''))
  const lines = [
    '【历史会议 ' + index + '】日期：' + (Number.isFinite(at) ? stamp(at) : '未标日期') + ' · 目录：' + (dirName || '未标目录'),
    '标题：' + (String((entry && entry.title) || '').trim() || '未标标题'),
  ]
  const excerpt = String((entry && entry.excerpt) || '').trim()
  if (excerpt) lines.push('摘要：\n' + excerpt)
  const items = (Array.isArray(entry && entry.actionItems) ? entry.actionItems : [])
    .map((x) => String(x || '').trim())
    .filter(Boolean)
    .slice(0, MAX_ACTION_ITEMS)
  if (items.length) lines.push('上次的待办/承诺：\n' + items.map((x) => '- ' + x).join('\n'))
  return lines.join('\n')
}

/**
 * 把历史压成给模型看的文本块（≤ maxChars）。
 * 顺序：从近到远 —— 【1】是最远…不，【1】是最近一场，方便模型说"上次"。
 * 预算不够时先保最近几场；一条都放不下部分内容时不再塞半条（除首条可截断）。
 */
function packHistory(history, maxChars) {
  const cap = clampInt(maxChars, HISTORY_BLOCK_MAX_CHARS, 1, 20000)
  const list = (Array.isArray(history) ? history : [])
    .filter((e) => e && typeof e === 'object' && (String(e.excerpt || '').trim() || (Array.isArray(e.actionItems) && e.actionItems.length)))
    .slice()
    .sort((a, b) => (Number(b.at) || 0) - (Number(a.at) || 0))
  if (!list.length) return { block: '', usedChars: 0, truncated: false }

  const header = [
    '以下是之前的会议纪要摘要，只用于衔接本次纪要：对照上次的待办/决议，判断这次有没有推进；不要照抄，也不要把摘要里没有的决定、人名、数字写成事实。',
    '按时间从近到远排列（【1】是最近一场）。',
  ].join('\n')
  let out = header
  let truncated = false
  const sep = '\n\n'
  for (let i = 0; i < list.length; i++) {
    const text = entryText(list[i], i + 1)
    const remain = cap - out.length - sep.length
    if (remain <= 0) { truncated = true; break }
    if (text.length <= remain) {
      out += sep + text
      continue
    }
    // 放不下整条：只保留第一条的可见前缀（最近的会议最有衔接价值），其余丢弃
    if (out === header && remain >= 200) out += sep + clip(text, remain)
    truncated = true
    break
  }
  if (out.length > cap) {
    out = clip(out, cap)
    truncated = true
  }
  return { block: out, usedChars: out.length, truncated }
}

/**
 * 历史块：给分钟纪要的 user prompt 用。
 * 空数组 / 没内容 → 空字符串（调用方据此走"无历史"的老路径）。
 *
 * @param {Array} history collectHistory 的返回
 * @param {{maxChars?: number}} [o]
 */
export function buildHistoryBlock(history, { maxChars = HISTORY_BLOCK_MAX_CHARS } = {}) {
  return packHistory(history, maxChars).block
}

/**
 * 历史元信息（只放可写日志的计数，不含纪要正文/标题等敏感内容）。
 * usedChars/truncated 按同一 maxChars 重算，与 buildHistoryBlock 的预算一致。
 *
 * @param {Array} history collectHistory 的返回
 * @param {{maxChars?: number}} [o] 必须与 buildHistoryBlock 用同一个 maxChars
 */
export function historyMeta(history, { maxChars = HISTORY_BLOCK_MAX_CHARS } = {}) {
  // days 挂在 collectHistory 返回的数组上；filter 会复制数组，必须先读
  const declaredDays = Number(Array.isArray(history) ? history.days : NaN)
  const list = Array.isArray(history) ? history.filter((e) => e && typeof e === 'object') : []
  const packed = packHistory(list, maxChars)
  const times = list.map((e) => Number(e.at)).filter((n) => Number.isFinite(n))
  return {
    count: list.length,
    days: Number.isFinite(declaredDays) ? declaredDays : 0,
    oldestAt: times.length ? Math.min(...times) : 0,
    newestAt: times.length ? Math.max(...times) : 0,
    usedChars: packed.usedChars,
    truncated: packed.truncated,
  }
}
