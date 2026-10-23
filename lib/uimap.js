/**
 * lib/uimap.js —— 界面坐标表（每个软件、每个动作一份）
 *
 * 为什么需要它：腾讯会议 / 移动会议的首页是 Qt 自绘的，按钮点不到控件名，
 * 只能按位置点。硬编码坐标换台电脑、换个缩放、换个窗口大小就失效，所以：
 *
 *  1. 首次使用：截一张客户端窗口图，交给会看图的一方（agent / computer-use）确认按钮位置
 *  2. 把坐标存下来（相对客户区的比例，跟窗口大小无关）
 *  3. 以后直接用；点完验证是否真的打开了目标界面，没打开就在附近小范围重试
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

export const ACTIONS = ['join', 'quick', 'schedule', 'share', 'leave']

/** 比例合法性：0 < v < 1 */
export function validRatio(x, y) {
  return Number.isFinite(x) && Number.isFinite(y) && x > 0 && x < 1 && y > 0 && y < 1
}

/** 像素 → 比例（截图或客户区坐标） */
export function pixelToRatio(px, py, w, h) {
  if (!(w > 0) || !(h > 0)) return null
  const x = px / w
  const y = py / h
  return validRatio(x, y) ? { x: Number(x.toFixed(4)), y: Number(y.toFixed(4)) } : null
}

/** 比例 → 客户区像素 */
export function ratioToPixel(ratio, rect) {
  if (!ratio || !rect) return null
  return {
    x: Math.round(rect.x + rect.w * ratio.x),
    y: Math.round(rect.y + rect.h * ratio.y),
  }
}

/** 局部探测点：以中心为原点，按环展开（不会跑太远，避免点到隔壁按钮） */
export function probeOffsets(step = 0.02, rings = 2) {
  const out = [{ dx: 0, dy: 0 }]
  for (let r = 1; r <= rings; r++) {
    const d = step * r
    out.push(
      { dx: d, dy: 0 }, { dx: -d, dy: 0 }, { dx: 0, dy: d }, { dx: 0, dy: -d },
      { dx: d, dy: d }, { dx: -d, dy: -d }, { dx: d, dy: -d }, { dx: -d, dy: d },
    )
  }
  return out
}

export class UiMap {
  constructor(file) {
    this.file = file
    this.data = this.#load()
  }

  #load() {
    try {
      if (existsSync(this.file)) {
        const raw = JSON.parse(readFileSync(this.file, 'utf8'))
        if (raw && typeof raw === 'object') return raw
      }
    } catch { /* 坏了就当空表 */ }
    return {}
  }

  #save() {
    try {
      mkdirSync(dirname(this.file), { recursive: true })
      writeFileSync(this.file, JSON.stringify(this.data, null, 2), 'utf8')
    } catch { /* 写不进去不影响主流程 */ }
  }

  /** 取某软件某动作的坐标比例 */
  get(appName, action) {
    const app = this.data[String(appName || '')] || {}
    const hit = app[action]
    return hit && validRatio(hit.x, hit.y) ? hit : null
  }

  /** 写入（带来源与时间，方便排查） */
  set(appName, action, ratio, meta = {}) {
    const name = String(appName || '').trim()
    if (!name || !ACTIONS.includes(action)) return null
    if (!ratio || !validRatio(ratio.x, ratio.y)) return null
    this.data[name] = this.data[name] || {}
    this.data[name][action] = {
      x: Number(ratio.x.toFixed(4)),
      y: Number(ratio.y.toFixed(4)),
      at: new Date().toISOString(),
      ...meta,
    }
    this.#save()
    return this.data[name][action]
  }

  /** 记一次失败：连续失败到阈值就该重新学一遍坐标了 */
  markFailure(appName, action, reason) {
    const name = String(appName || "").trim()
    if (!name) return null
    this.data[name] = this.data[name] || {}
    const key = action + "__meta"
    const meta = this.data[name][key] || { failures: 0 }
    meta.failures = (meta.failures || 0) + 1
    meta.lastFailAt = new Date().toISOString()
    if (reason) meta.lastReason = String(reason).slice(0, 200)
    this.data[name][key] = meta
    this.#save()
    return meta
  }

  /** 记一次成功：把失败计数清零 */
  markSuccess(appName, action) {
    const name = String(appName || "").trim()
    if (!name) return null
    const key = action + "__meta"
    const meta = (this.data[name] && this.data[name][key]) || { failures: 0 }
    meta.failures = 0
    meta.lastOkAt = new Date().toISOString()
    this.data[name] = this.data[name] || {}
    this.data[name][key] = meta
    this.#save()
    return meta
  }

  meta(appName, action) {
    const app = this.data[String(appName || "")] || {}
    return app[action + "__meta"] || { failures: 0 }
  }

  /** 是否值得重新探索坐标：没标定过，或连续失败达到阈值 */
  needsRecalibration(appName, action, threshold = 2) {
    const meta = this.meta(appName, action)
    if (!this.get(appName, action)) return { needed: true, why: "never-calibrated", failures: meta.failures || 0 }
    if ((meta.failures || 0) >= threshold) return { needed: true, why: "repeated-failure", failures: meta.failures }
    return { needed: false, why: "ok", failures: meta.failures || 0 }
  }

  /** 某软件已标定的动作 */
  list(appName) {
    const app = this.data[String(appName || '')] || {}
    return Object.keys(app).filter((k) => ACTIONS.includes(k))
  }

  snapshot() {
    return this.data
  }
}
