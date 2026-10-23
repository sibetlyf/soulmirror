/**
 * lib/auto-join.js —— 会话里出现会议链接/会议号时自动入会
 *
 * 场景：正在开会，有人在 DSH 会话里贴了一条「点击链接入会：https://meeting.tencent.com/dm/xxx」，
 * 或者干脆只发了「会议号 206-275-219」。这里负责从消息里认出来，并决定要不要自动进。
 *
 * 只管识别与节流；真正入会由调用方去做。
 */

import { isJoinUrl, isBareCode, extractJoinUrl } from './join-url.js'

/** 会议号：允许 9~12 位，带横线/空格分组 */
const CODE_RE = /(?:会议号|会议\s*ID|meeting\s*(?:code|id))\D{0,6}(\d{3}[\s-]?\d{3}[\s-]?\d{3,4})/i
/** 裸会议号（没有"会议号"字样时，只认 9 位带分组的，避免误把手机号/金额当会议号） */
const BARE_GROUPED_RE = /(?<!\d)(\d{3}[\s-]\d{3}[\s-]\d{3,4})(?!\d)/

/**
 * 从一段文本里找会议信息
 * @returns {{kind:'url'|'code', value:string, url?:string}|null}
 */
export function findMeeting(text) {
  const s = String(text || '')
  if (!s) return null

  // 1) 链接优先
  const url = extractJoinUrl(s)
  if (url && isJoinUrl(url)) return { kind: 'url', value: url, url }

  // 2) 带"会议号"字样的号
  const m = CODE_RE.exec(s)
  if (m) {
    const code = m[1].replace(/[\s-]/g, '')
    if (isBareCode(code)) return { kind: 'code', value: code }
  }

  // 3) 有分组的裸号（206-275-219 / 206 275 219），只在明确像会议号时才认
  const g = BARE_GROUPED_RE.exec(s)
  if (g) {
    const code = g[1].replace(/[\s-]/g, '')
    if (isBareCode(code)) return { kind: 'code', value: code }
  }
  return null
}

/** 从任意事件对象里挖出文本（不关心具体事件类型，只找字符串里的会议信息） */
export function findMeetingInEvent(event, { maxDepth = 6 } = {}) {
  const seen = new Set()
  const texts = []

  const walk = (v, depth) => {
    if (depth > maxDepth || v == null) return
    if (typeof v === 'string') {
      if (v.length <= 4000 && /会议|meeting|dm\/|wemeet/i.test(v)) texts.push(v)
      return
    }
    if (Array.isArray(v)) {
      // 数组只是容器，不占深度，否则 content[0].text 会被漏掉
      for (const x of v) walk(x, depth)
      return
    }
    if (typeof v === 'object') {
      if (seen.has(v)) return
      seen.add(v)
      for (const k of Object.keys(v)) {
        // 跳过明显的二进制/大字段
        if (/^(usage|stream|attachments|images|snapshot)$/i.test(k)) continue
        walk(v[k], depth + 1)
      }
    }
  }

  walk(event, 0)
  for (const t of texts) {
    const hit = findMeeting(t)
    if (hit) return hit
  }
  return null
}

/** 去重 + 冷却：同一个会议短时间内只自动入一次 */
export class AutoJoinGate {
  constructor({ cooldownMs = 5 * 60 * 1000 } = {}) {
    this.cooldownMs = cooldownMs
    this.seen = new Map()
  }

  #key(hit) {
    return hit.kind + ':' + (hit.kind === 'url' ? hit.url : hit.value)
  }

  /** 是否允许这次自动入会 */
  allow(hit, now = Date.now()) {
    if (!hit) return { ok: false, why: 'nothing' }
    const key = this.#key(hit)
    const at = this.seen.get(key) || 0
    if (now - at < this.cooldownMs) return { ok: false, why: 'cooldown', key }
    return { ok: true, key }
  }

  mark(hit, now = Date.now()) {
    if (!hit) return
    this.seen.set(this.#key(hit), now)
    // 别无限长
    if (this.seen.size > 50) {
      const oldest = [...this.seen.entries()].sort((a, b) => a[1] - b[1])[0]
      if (oldest) this.seen.delete(oldest[0])
    }
  }
}
