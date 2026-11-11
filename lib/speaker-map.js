/**
 * 说话人名册：把云端分人结果里的「说话人1/2/3」映射成真实姓名。
 *
 * 为什么要这一层（用户原话）：阿里云识别**能分人**，但只给"说话人1、说话人2"
 * 这种匿名编号，不会告诉你这是谁，也不返回可复用的声纹。所以：
 *   · 先把"这一场会里谁是谁"记下来 → 纪要里就能写真实姓名（P1，本文）
 *   · 以后再做声纹录入与跨会识别（P2，见 docs/speaker-diarization-plan.md）
 *
 * 存储是两层：
 *   1. 每场会一份 `<会议目录>/speaker-map.json`：这场会 说话人N → 姓名
 *   2. 全局一份 `<数据目录>/speakers/people.json`：已知的人名（只给输入提示用，
 *      **不含任何声纹**，所以绝不能据此跨会"认人"）
 *
 * 规矩：
 *   · 只认明确的映射，不做模糊匹配（"李"不匹配"李亚峰"）
 *   · 没映射的标签保持匿名，纪要里用角色词或省略，不编造姓名
 *   · 写入失败要让调用方知道（不静默丢用户的输入）
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs'
import { join } from 'node:path'

export const SPEAKER_MAP_FILE = 'speaker-map.json'
export const PEOPLE_FILE = 'people.json'

/** DashScope 的编号形如「说话人1」；统一成这个形状再比较 */
export function normalizeLabel(raw) {
  const text = String(raw || '').trim()
  if (!text) return ''
  const cn = /^说话人\s*(\d+)$/.exec(text)
  if (cn) return '说话人' + Number(cn[1])
  const spk = /^(?:speaker|spk)[\s_-]*0*(\d+)$/i.exec(text)
  if (spk) return '说话人' + Number(spk[1])
  const bare = /^0*(\d+)$/.exec(text)
  if (bare) return '说话人' + Number(bare[1])
  return text
}

/** 姓名：去空白、限长；空串表示"取消映射" */
export function sanitizeName(raw) {
  return String(raw || '').replace(/[\r\n\t]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40)
}

function readJson(file, fallback) {
  try {
    if (!existsSync(file)) return fallback
    const parsed = JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, ''))
    return parsed && typeof parsed === 'object' ? parsed : fallback
  } catch { return fallback }
}

/** 原子写：先写临时文件再 rename，避免半截 JSON 让下次读不到 */
function writeJson(file, data) {
  const dir = join(file, '..')
  mkdirSync(dir, { recursive: true })
  const tmp = file + '.tmp'
  writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8')
  renameSync(tmp, file)
  return true
}

/**
 * 读这一场会的映射。
 * @returns {{ byLabel: Record<string,string>, at: string, version: number }}
 */
export function loadSpeakerMap(dir) {
  const raw = readJson(join(String(dir || ''), SPEAKER_MAP_FILE), null)
  const byLabel = {}
  if (raw && raw.byLabel && typeof raw.byLabel === 'object') {
    for (const [label, name] of Object.entries(raw.byLabel)) {
      const key = normalizeLabel(label)
      const value = sanitizeName(name)
      if (key && value) byLabel[key] = value
    }
  }
  return { byLabel, at: String((raw && raw.at) || ''), version: Number((raw && raw.version) || 1) }
}

/**
 * 写这一场会的映射。**先落盘再生效**：写失败抛错，调用方必须报给用户。
 */
export function saveSpeakerMap(dir, byLabel) {
  if (!dir) throw new Error('没有会议目录，无法保存说话人映射')
  const clean = {}
  for (const [label, name] of Object.entries(byLabel || {})) {
    const key = normalizeLabel(label)
    const value = sanitizeName(name)
    if (key && value) clean[key] = value
  }
  const data = { version: 1, at: new Date().toISOString(), byLabel: clean }
  writeJson(join(String(dir), SPEAKER_MAP_FILE), data)
  return data
}

/** 全局人名清单（只用于输入提示，不含声纹） */
export function loadPeople(root) {
  const raw = readJson(join(String(root || ''), 'speakers', PEOPLE_FILE), null)
  const names = Array.isArray(raw && raw.names) ? raw.names.map(sanitizeName).filter(Boolean) : []
  return Array.from(new Set(names)).slice(0, 200)
}

/** 记住一个名字（去重、限量）。写失败返回 false，由调用方决定是否提示 */
export function rememberPeople(root, names = []) {
  try {
    if (!root) return false
    const merged = Array.from(new Set([...loadPeople(root), ...names.map(sanitizeName).filter(Boolean)]))
    writeJson(join(String(root), 'speakers', PEOPLE_FILE), { version: 1, at: new Date().toISOString(), names: merged.slice(-200) })
    return true
  } catch { return false }
}

/**
 * 从非流式转写里列出说话人：时长、句数、首末时间。
 * 只统计有文本的行（gap/助手播报不算），给界面判断"哪个是我"。
 */
export function listSpeakers(lines = []) {
  const acc = new Map()
  for (const line of Array.isArray(lines) ? lines : []) {
    if (!line || !line.text || line.role === 'assistant' || line.src === 'gap') continue
    const label = normalizeLabel(line.speaker)
    if (!label) continue
    const rec = acc.get(label) || { label, sentences: 0, chars: 0, seconds: 0, firstAt: '', lastAt: '', sample: '' }
    rec.sentences += 1
    rec.chars += String(line.text).length
    const begin = Number(line.begin)
    const end = Number(line.end)
    if (Number.isFinite(begin) && Number.isFinite(end) && end > begin) rec.seconds += (end - begin) / 1000
    const t = String(line.t || '')
    if (t) {
      if (!rec.firstAt) rec.firstAt = t
      rec.lastAt = t
    }
    if (!rec.sample || String(line.text).length > rec.sample.length) rec.sample = String(line.text).slice(0, 60)
    acc.set(label, rec)
  }
  return Array.from(acc.values()).sort((a, b) => b.seconds - a.seconds || b.sentences - a.sentences)
}

/**
 * 把映射应用到转写上。
 *
 * - 已映射 → speaker 换成姓名，原始标签保留在 speakerLabel（界面/排查都还要用）
 * - 未映射 → 保持标签不变；调用方决定是显示"与会人员"还是省略
 *
 * 返回新数组，不修改入参（同样的输入永远得到同样的输出，方便测试与重放）。
 */
export function applySpeakerMap(lines = [], byLabel = {}) {
  const map = {}
  for (const [label, name] of Object.entries(byLabel || {})) {
    const key = normalizeLabel(label)
    const value = sanitizeName(name)
    if (key && value) map[key] = value
  }
  return (Array.isArray(lines) ? lines : []).map((line) => {
    if (!line) return line
    const label = normalizeLabel(line.speaker)
    const name = label ? map[label] : ''
    if (!name) return { ...line, speakerLabel: label || line.speakerLabel || '' }
    return { ...line, speaker: name, speakerLabel: label }
  })
}

/** 给纪要提示词用的与会人员列表：只有映射过的人名，按发言量排序 */
export function attendeesFromMap(speakers = []) {
  return speakers
    .map((s) => sanitizeName(s && (s.name || '')))
    .filter(Boolean)
}
