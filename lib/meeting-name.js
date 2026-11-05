/**
 * 会议目录命名 + "一场会只留一条记录"。
 *
 * 用户要求：
 *   1. 一场会议最后只出现一次（或只有一段截断的日志），不要散成好几个目录
 *   2. 目录按「会议软件 · 时间 · 主题」自动命名，自己认得出来
 *
 * 这里只做纯计算（不碰文件系统），便于测试。
 */

// Windows 最严：\/:*?"<>| 都要换掉；控制字符一并去掉
const BAD = /[\\/:*?"<>|\u0000-\u001f]+/g

/** 把任意文本变成安全的目录片段 */
export function safePart(text, max = 40) {
  const s = String(text || '')
    .replace(BAD, '-')
    .replace(/\s+/g, ' ')
    .replace(/^[-.\s]+|[-.\s]+$/g, '')   // Windows 不允许结尾是点或空格
    .trim()
  return s.slice(0, max).trim()
}

/** 本地时间 → 2026-11-05 16-07（用短横线版时间，避免冒号） */
export function stamp(at) {
  const d = at instanceof Date ? at : new Date(at || Date.now())
  if (Number.isNaN(d.getTime())) return ''
  const p = (n) => String(n).padStart(2, '0')
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
    ' ' + p(d.getHours()) + '-' + p(d.getMinutes())
}

/**
 * 生成会议目录名：`腾讯会议 · 2026-11-05 16-07 · 周会`
 *
 * - 三段都可缺，缺了就跳过（不会留下连续的分隔）
 * - 主题为空时用会议号兜底，都没有就只留软件与时间
 * - 总长限制在 90 字符内，避免路径过长
 */
export function buildMeetingDirName({ app = '', at = Date.now(), topic = '', code = '' } = {}) {
  const a = safePart(app, 14)
  const t = safePart(topic, 40)
  const c = safePart(code, 20)
  const when = stamp(at)
  const label = t || c
  const parts = [a, when, label].filter(Boolean)
  // 只有时间、没有软件也没有主题时，补一个"会议"前缀，别让目录名只剩一串数字
  if (!a && !label) return ('会议 · ' + when).trim()
  const name = parts.join(' · ').slice(0, 90).trim()
  return name || ('会议 · ' + when)
}

/**
 * 主题是否"值得用作名字"。
 *
 * 窗口标题常常是「腾讯会议 - 123-456-789」这种纯会议号，
 * 拿它当主题没意义，宁可用会议号那一段。
 */
export function topicFromTitle({ title = '', app = '', code = '' } = {}) {
  let t = String(title || '').trim()
  if (!t) return ''
  // 去掉软件名
  if (app) t = t.split(app).join(' ').trim()
  // 去掉会议号（含横线分组的写法）
  if (code) t = t.split(code).join(' ').trim()
  t = t.replace(/\d{3}[-\s]?\d{3}[-\s]?\d{3}/g, ' ')
  // 去掉常见的连接符残留
  t = t.replace(/^[-–—|·:：\s]+|[-–—|·:：\s]+$/g, '').trim()
  if (!t) return ''
  // 纯噪声（比如只剩"快速会议"以外的标点）
  if (/^[-–—|·:：\d\s]+$/.test(t)) return ''
  return t
}

/**
 * 是否该复用已有目录（= 认为还是"同一场会"）。
 *
 * 条件同时满足才复用：
 *   - 同一个会议键（会议号相同 / 主题相同）
 *   - 上次写入距今不超过 mergeWindowMs
 *   - 上一场没有标记结束（meta.json 里没有 endedAt）
 *
 * 这样"采集中断后重启""窗口关掉又打开"都落在同一个目录里，
 * 而不是每重启一次多出一个目录。
 */
export function shouldReuseDir({ sameKey = false, sinceLastMs = Infinity, mergeWindowMs = 45 * 60 * 1000, previousEnded = false } = {}) {
  if (!sameKey) return false
  if (previousEnded) return false
  return sinceLastMs <= mergeWindowMs
}
