/**
 * 会议记录的导出与搜索。
 *
 * 导出两种格式：
 *   - markdown：纪要为主，附带说话人的转写
 *   - text    ：纯文本，适合贴到群里
 *
 * 搜索是"标题 + 纪要 + 转写"的全文匹配，返回命中位置与片段，
 * 让用户知道为什么这一场被搜出来。
 */

/** 把毫秒转成 mm:ss / h:mm:ss */
export function fmtClock(ms) {
  const n = Number(ms)
  if (!Number.isFinite(n) || n < 0) return ''
  const total = Math.round(n / 1000)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const mm = String(m).padStart(2, '0')
  const ss = String(s).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

/** 日期 → 2026-11-04 15:20 */
export function fmtStamp(iso) {
  const d = new Date(iso || '')
  if (Number.isNaN(d.getTime())) return ''
  const p = (x) => String(x).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/**
 * 导出记录。
 * @param {{ dir: string, meta: any, preparation: any, minutes: string, lines: any[], source: string }} record
 * @param {{ format?: 'markdown'|'text', withTime?: boolean }} opts
 */
export function renderExport(record, { format = 'markdown', withTime = true } = {}) {
  const prep = record?.preparation || {}
  const meta = record?.meta || {}
  const lines = Array.isArray(record?.lines) ? record.lines : []
  const title = prep.goal || meta.title || '会议记录'
  const started = fmtStamp(meta.startedAt)
  const duration = meta.durationMin ? meta.durationMin + ' 分钟' : ''
  const speakers = record?.speakers || 0

  const head = []
  head.push(title)
  if (started) head.push('时间：' + started + (duration ? '（' + duration + '）' : ''))
  if (prep.invite) head.push('会邀：' + prep.invite)
  if (prep.goal) head.push('目标：' + prep.goal)
  if (speakers) head.push('说话人：' + speakers + ' 位')
  if (record?.source === 'offline') head.push('来源：会后重转写（云端文件识别）')

  const transcript = lines.map((l) => {
    const t = withTime && Number.isFinite(l.begin) ? '[' + fmtClock(l.begin) + '] ' : ''
    const spk = l.speaker ? l.speaker + '：' : ''
    return t + spk + String(l.text || '').trim()
  }).filter(Boolean).join('\n')

  if (format === 'text') {
    return [
      head.join('\n'),
      '',
      '—— 纪要 ——',
      (record?.minutes || '（无）').trim(),
      '',
      '—— 转写 ——',
      transcript || '（无）',
    ].join('\n')
  }

  const md = []
  md.push('# ' + title)
  md.push('')
  for (const h of head.slice(1)) md.push('- ' + h)
  md.push('')
  md.push('## 纪要')
  md.push('')
  md.push((record?.minutes || '（无）').trim())
  md.push('')
  md.push('## 转写')
  md.push('')
  md.push(transcript ? transcript.split('\n').map((l) => '- ' + l).join('\n') : '（无）')
  return md.join('\n')
}

/** 导出文件名：2026-11-04-1520-会议目标.md */
export function exportFileName(record, format = 'markdown') {
  const meta = record?.meta || {}
  const prep = record?.preparation || {}
  const d = new Date(meta.startedAt || Date.now())
  const p = (x) => String(x).padStart(2, '0')
  const stamp = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`
  const safe = String(prep.goal || meta.title || '会议记录')
    .replace(/[\\/:*?"<>|\r\n\t]/g, ' ')
    .trim()
    .slice(0, 40) || '会议记录'
  return `${stamp}-${safe}.${format === 'text' ? 'txt' : 'md'}`
}

/**
 * 在一条记录里找关键词。
 * @returns {{ hit: boolean, where: string[], snippet: string }}
 */
export function matchRecord(record, query) {
  const q = String(query || '').trim().toLowerCase()
  if (!q) return { hit: false, where: [], snippet: '' }
  const where = []
  const prep = record?.preparation || {}
  if (String(prep.goal || '').toLowerCase().includes(q)) where.push('目标')
  if (String(prep.invite || '').toLowerCase().includes(q)) where.push('会邀')
  const minutes = String(record?.minutes || '')
  const inMinutes = minutes.toLowerCase().indexOf(q)
  if (inMinutes >= 0) where.push('纪要')

  let snippet = ''
  const lines = Array.isArray(record?.lines) ? record.lines : []
  for (const l of lines) {
    const text = String(l.text || '')
    const at = text.toLowerCase().indexOf(q)
    if (at >= 0) {
      if (!where.includes('转写')) where.push('转写')
      const from = Math.max(0, at - 18)
      snippet = text.slice(from, from + 46)
      break
    }
  }
  if (!snippet && inMinutes >= 0) {
    const from = Math.max(0, inMinutes - 24)
    snippet = minutes.slice(from, from + 64).replace(/\s+/g, ' ')
  }
  return { hit: where.length > 0, where, snippet }
}

/**
 * 批量搜索：records 由 listRecords 提供，读文件由调用方注入（便于测试）。
 * @param {Array} records
 * @param {string} query
 * @param {(dir: string) => any} load 返回 { minutes, lines, preparation }
 */
export function searchRecords(records, query, load, limit = 30) {
  const q = String(query || '').trim()
  if (!q) return records.slice(0, limit)
  const out = []
  for (const rec of records) {
    const full = load(rec.dir)
    if (!full) continue
    const m = matchRecord({ ...rec, ...full }, q)
    if (m.hit) out.push({ ...rec, match: m })
    if (out.length >= limit) break
  }
  return out
}
