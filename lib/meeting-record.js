/**
 * 会议记录的数据层：准备（会邀 / 目标 / 背景）、进行中、回看。
 *
 * 设计参考 vianvio/dsh-plugin-meeting-assistant 的工作流：
 *   准备页写会邀与目标（可 AI 润色）→ 开始录音 → 结束 → 回看。
 *
 * 我们额外的约束：一场会议一个目录（插件私有），
 * 目录里放 preparation.json / meta.json / transcript.jsonl / minutes.md / audio.wav。
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/** 读 JSON，坏了返回 null */
export function readJson(file) {
  try { return JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, '')) } catch { return null }
}

/** 原子写 JSON */
export function writeJson(file, data) {
  try {
    mkdirSync(join(file, '..'), { recursive: true })
    const tmp = file + '.tmp'
    writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8')
    writeFileSync(file, readFileSync(tmp))
    return true
  } catch { return false }
}

const PREP = 'preparation.json'
const META = 'meta.json'

/** 会前准备：只存文字，不扫描项目 */
export function savePreparation(dir, { invite = '', goal = '', background = '', projectDir = '' } = {}) {
  if (!dir) return null
  const data = {
    invite: String(invite || '').trim(),
    goal: String(goal || '').trim(),
    background: String(background || '').trim(),
    projectDir: String(projectDir || '').trim(),
    updatedAt: new Date().toISOString(),
  }
  writeJson(join(dir, PREP), data)
  return data
}

export function loadPreparation(dir) {
  if (!dir) return { invite: '', goal: '', background: '', projectDir: '' }
  return readJson(join(dir, PREP)) || { invite: '', goal: '', background: '', projectDir: '' }
}

/** 会议元信息：状态、时长、说话人数、是否已整理 */
export function saveMeta(dir, patch = {}) {
  if (!dir) return null
  const cur = readJson(join(dir, META)) || {}
  const next = { ...cur, ...patch, updatedAt: new Date().toISOString() }
  writeJson(join(dir, META), next)
  return next
}

export function loadMeta(dir) {
  if (!dir) return null
  return readJson(join(dir, META))
}

/**
 * 列出历史会议（按目录名倒序，目录名是 ISO 时间戳，天然可排）。
 * @param {string} root 会议根目录
 * @param {number} limit
 */
export function listRecords(root, limit = 20, now = Date.now()) {
  try {
    const dirs = readdirSync(root, { withFileTypes: true })
      .filter((d) => d.isDirectory() && /^\d{4}-\d{2}-\d{2}/.test(d.name)) // 只认时间戳目录，跳过 _probe 之类
      .map((d) => d.name)
      .sort()
      .reverse()
      .slice(0, limit)
    return dirs.map((name) => {
      const dir = join(root, name)
      const meta = loadMeta(dir)
      const prep = loadPreparation(dir)
      let minutesBytes = 0
      let hasAudio = false
      let lines = 0
      try { minutesBytes = statSync(join(dir, 'minutes.md')).size } catch { /* ignore */ }
      hasAudio = existsSync(join(dir, 'audio.wav'))
      try {
        lines = readFileSync(join(dir, 'transcript.jsonl'), 'utf8').split('\n').filter(Boolean).length
      } catch { /* ignore */ }
      return {
        id: name,
        dir,
        title: prep.goal || meta?.title || name,
        invite: prep.invite || '',
        goal: prep.goal || '',
        startedAt: meta?.startedAt || '',
        endedAt: meta?.endedAt || '',
        durationMin: meta?.durationMin || 0,
        speakers: meta?.speakers || 0,
        lines,
        hasAudio,
        hasMinutes: minutesBytes > 0,
        ageHours: Math.round((now - (Date.parse(meta?.endedAt || meta?.startedAt || '') || now)) / 3600000),
      }
    })
  } catch { return [] }
}

/** 回看一条记录：纪要 + 转写尾部 + 元信息 */
export function loadRecord(dir, { transcriptLimit = 400 } = {}) {
  if (!dir) return null
  let minutes = ''
  try { minutes = readFileSync(join(dir, 'minutes.md'), 'utf8') } catch { /* ignore */ }
  let lines = []
  try {
    lines = readFileSync(join(dir, 'transcript.jsonl'), 'utf8')
      .split('\n').filter(Boolean)
      .map((l) => { try { return JSON.parse(l) } catch { return null } })
      .filter(Boolean)
  } catch { /* ignore */ }
  // 会后重转写（带说话人）优先
  let offline = []
  try {
    offline = readFileSync(join(dir, 'transcript-offline.jsonl'), 'utf8')
      .split('\n').filter(Boolean)
      .map((l) => { try { return JSON.parse(l) } catch { return null } })
      .filter(Boolean)
  } catch { /* ignore */ }
  const view = offline.length ? offline : lines
  return {
    dir,
    meta: loadMeta(dir),
    preparation: loadPreparation(dir),
    minutes,
    speakers: new Set(view.map((x) => x.speaker).filter(Boolean)).size,
    lines: view.slice(-transcriptLimit),
    hasAudio: existsSync(join(dir, 'audio.wav')),
    source: offline.length ? 'offline' : 'live',
  }
}
