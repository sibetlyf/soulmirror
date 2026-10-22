/**
 * lib/persona.js —— 四层人格文件（SOUL / IDENTITY / USER / STATE）
 *
 * 借鉴 dsh-agentsoul 的做法：
 *  - 四个 markdown 文件，缺失只补种子、绝不覆盖
 *  - 改动即时生效（每次读取都从磁盘读，用 mtime 判断缓存）
 *  - 组合成一段可注入的 system prompt 片段
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

export const PERSONA_FILES = {
  soul: 'SOUL.md',
  identity: 'IDENTITY.md',
  user: 'USER.md',
  state: 'STATE.md',
}

const SEEDS = {
  soul: `# SOUL

## 第一原则

帮助对方把事办成。

优先级：正确 > 可靠 > 效率 > 表达。

## 判断原则

发现方案有问题时直接说，讲清依据并给替代方案；没有把握就说不确定。
不迎合、不编造、不堆砌形容词。

## 表达

说的是人话，短句优先；会议里一句话讲完一个意思。
`,
  identity: `# IDENTITY

名字：SoulMirror
角色：用户的数字分身
能力：参加会议、听懂对话、记录要点、执行任务、必要时替你发言
`,
  user: `# USER

（在这里记录用户长期信息：称呼、偏好、常用术语、说话风格。）
`,
  state: `# STATE

（当前正在推进的事：项目、进度、下一步。任务结束就清掉。）
`,
}

export function ensurePersona(dir) {
  mkdirSync(dir, { recursive: true })
  for (const [k, file] of Object.entries(PERSONA_FILES)) {
    const p = join(dir, file)
    if (!existsSync(p)) writeFileSync(p, SEEDS[k], 'utf8')
  }
  return dir
}

let cache = { at: 0, data: null }

export function loadPersona(dir, { cacheMs = 1500 } = {}) {
  ensurePersona(dir)
  const now = Date.now()
  let newest = 0
  for (const file of Object.values(PERSONA_FILES)) {
    try { newest = Math.max(newest, statSync(join(dir, file)).mtimeMs) } catch { /* ignore */ }
  }
  if (cache.data && cache.at >= newest && now - cache.at < cacheMs) return cache.data
  const data = { dir, at: now }
  for (const [k, file] of Object.entries(PERSONA_FILES)) {
    try { data[k] = readFileSync(join(dir, file), 'utf8').trim() } catch { data[k] = '' }
  }
  cache = { at: now, data }
  return data
}

export function readPersonaFile(dir, key) {
  const file = PERSONA_FILES[key]
  if (!file) throw new Error('未知人格文件：' + key)
  const p = join(dir, file)
  ensurePersona(dir)
  return existsSync(p) ? readFileSync(p, 'utf8') : ''
}

export function writePersonaFile(dir, key, text) {
  const file = PERSONA_FILES[key]
  if (!file) throw new Error('未知人格文件：' + key)
  ensurePersona(dir)
  writeFileSync(join(dir, file), String(text || ''), 'utf8')
  cache = { at: 0, data: null }
  return join(dir, file)
}

/** 组合成注入用的文本块（跳过空文件） */
export function personaBlock(persona, maxChars = 6000) {
  const parts = []
  if (persona.soul) parts.push(persona.soul)
  if (persona.identity) parts.push(persona.identity)
  if (persona.user) parts.push(persona.user)
  if (persona.state) parts.push(persona.state)
  const text = parts.join('\n\n')
  return text.length > maxChars ? text.slice(0, maxChars) + '\n…（已截断）' : text
}
