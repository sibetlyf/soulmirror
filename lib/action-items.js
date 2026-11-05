/**
 * 从会议纪要里抽取"待办事项"。
 *
 * 为什么放在会议助手这边而不是宠物那边：待办的内容来自会议理解
 * （谁说、要做什么、什么时候前做完），宠物只负责把它显示在头顶。
 * 所以这里只做纯抽取，宠物的 todo 协议由调用方投喂。
 *
 * 现实约束：纪要是模型写的自由文本，格式不保证。因此走"规则优先"而不是
 * 指望模型永远输出结构化字段——规则抓不到的再交给上层决定要不要问模型。
 */

const DATE_HINT = /(?:\d{1,2}\s*月\s*\d{1,2}\s*[日号]|周[一二三四五六日天]|明天|后天|下周[一二三四五六日天]?|下个月|\d{4}-\d{2}-\d{2})/

const VERB_HINT = /(完成|确认|跟进|整理|提交|发出|同步|评审|修复|上线|排期|对接|输出|准备|补充|review|check|send|prepare)/i

// 回顾性描述（已经做完、讨论过了）不是待办，别抓到清单里
const PAST_HINT = /(已经|已|完成了|做完了|讨论过|通过了|上线了|结束了)/

/** 去掉 Markdown 标记与编号，留下人话 */
export function cleanLine(line) {
  return String(line == null ? '' : line)
    .replace(/^\s*[-*+]\s+/, '')
    .replace(/^\s*\d+[.)]\s+/, '')
    .replace(/^\s*\[[ xX]\]\s*/, '')
    .replace(/^\s*(?:待办|TODO|Todo|todo)[:：]\s*/, '')
    .replace(/[*_`>]/g, '')
    .trim()
}

/**
 * 抽取待办。
 * @param {string} minutes 纪要正文
 * @param {{ max?: number }} opts
 * @returns {Array<{ text: string, due: string, owner: string, source: 'todo-list'|'heading'|'action' }>}
 */
export function extractActionItems(minutes, { max = 12 } = {}) {
  const text = String(minutes || '')
  if (!text.trim()) return []

  const items = []
  const seen = new Set()
  const push = (raw, source) => {
    const text2 = cleanLine(raw)
    if (text2.length < 3) return
    const key = text2.replace(/[\s，。、；：,.;:]/g, '')
    if (seen.has(key)) return
    seen.add(key)
    const owner = (/^([\u4e00-\u9fa5A-Za-z]{2,4})[:：]/.exec(text2) || [])[1] || ''
    const due = (DATE_HINT.exec(text2) || [])[0] || ''
    items.push({
      text: owner ? text2.replace(new RegExp('^' + owner + '[:：]\\s*'), '') : text2,
      due,
      owner,
      source,
    })
  }

  const lines = text.split(/\r?\n/)
  let inTodoSection = false
  let inHeading = ''

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) { continue }

    // 标题：记住当前在哪个小节
    const heading = /^#{1,6}\s*(.+)$/.exec(trimmed)
    if (heading) {
      inHeading = heading[1].replace(/[*_`]/g, '').trim()
      inTodoSection = /(待办|行动|下一步|下步|todo|action)/i.test(inHeading)
      continue
    }
    // 小节标题也可能是加粗形式
    const boldHeading = /^\*\*(.+?)\*\*\s*$/.exec(trimmed)
    if (boldHeading) {
      inHeading = boldHeading[1].trim()
      inTodoSection = /(待办|行动|下一步|下步|todo|action)/i.test(inHeading)
      continue
    }

    const bare = cleanLine(trimmed)
    if (!bare) continue

    const isBullet = /^\s*(?:[-*+]|\d+[.)]|\[[ xX]\])\s+/.test(trimmed)
    if (inTodoSection && (isBullet || VERB_HINT.test(bare))) { push(bare, 'todo-list'); continue }
    // 不在待办小节里：只认显式的动作句，避免把讨论内容当成任务
    if (isBullet && VERB_HINT.test(bare) && !PAST_HINT.test(bare)) { push(bare, 'action'); continue }
    if (!isBullet && /(下一步|需要|请|负责)/.test(bare) && VERB_HINT.test(bare)) { push(bare, 'heading'); continue }
    if (items.length >= max) break
  }

  return items.slice(0, max)
}

/** 有没有到期的（给宠物做提醒用）：due 命中"今天/明天"这类就视为临近 */
export function isDueSoon(item, { now = new Date() } = {}) {
  const due = String((item && item.due) || '')
  if (!due) return false
  if (/(今天|明天|后天|本周|这周)/.test(due)) return true
  if (/(下周|下周[一二三四五六日天])/.test(due)) return true
  const m = /^(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]$/.exec(due)
  if (m) {
    const d = new Date(now.getFullYear(), Number(m[1]) - 1, Number(m[2]))
    const diff = d.getTime() - new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
    return diff >= 0 && diff <= 86400000 * 2
  }
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(due)
  if (iso) {
    const d = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]))
    const diff = d.getTime() - new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
    return diff >= 0 && diff <= 86400000 * 2
  }
  return false
}
