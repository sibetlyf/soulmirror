/**
 * lib/memory.js —— 轻量长期记忆 + LLM 蒸馏
 *
 * 不引入 SQLite：直接用 JSON 落盘，规模在几千条内完全够用。
 * 结构：
 *   { version: 1, entries: [{ at, role, text, session, kind }], distilled: [{ at, kind, text }] }
 *
 * 蒸馏：把最近 N 条对话交给 LLM，抽取成 persona / episodic / instruction 三类记忆，
 * 分别写回 USER.md、STATE.md 或 distilled 列表。
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

export class MemoryStore {
  constructor(file, opts = {}) {
    this.file = file
    this.maxEntries = opts.maxEntries || 2000
    this.state = { version: 1, entries: [], distilled: [] }
    this.load()
  }

  load() {
    try {
      if (existsSync(this.file)) {
        const raw = JSON.parse(readFileSync(this.file, 'utf8').replace(/^\uFEFF/, ''))
        if (raw && Array.isArray(raw.entries)) this.state = raw
      }
    } catch { /* 损坏就用空 */ }
    return this.state
  }

  save() {
    try {
      mkdirSync(dirname(this.file), { recursive: true })
      writeFileSync(this.file, JSON.stringify(this.state, null, 1), 'utf8')
    } catch { /* ignore */ }
  }

  add(entry) {
    const item = { at: new Date().toISOString(), kind: 'dialogue', ...entry }
    if (!item.text) return null
    this.state.entries.push(item)
    if (this.state.entries.length > this.maxEntries) {
      this.state.entries = this.state.entries.slice(-this.maxEntries)
    }
    this.save()
    return item
  }

  recent(n = 10) {
    return this.state.entries.slice(-n)
  }

  /** 蒸馏：返回 { persona, episodic, instruction } */
  async distill(completer, opts = {}) {
    const limit = opts.limit || 40
    const batch = this.recent(limit)
    if (!completer || batch.length < (opts.minEntries || 6)) return { skipped: true, count: batch.length }
    const convo = batch.map((e) => (e.role === 'assistant' ? '我: ' : '对方: ') + e.text).join('\n')
    const prompt = [
      {
        role: 'system',
        content: '你是记忆整理器。从对话里抽取值得长期记住的信息，只输出 JSON：'
          + '{"persona":["关于对方的稳定事实/偏好"],"episodic":["发生过的具体事件"],"instruction":["对我的长期要求"]}。'
          + '没有就返回空数组；不要编造；每条不超过 40 字。',
      },
      { role: 'user', content: convo.slice(-(opts.maxChars || 8000)) },
    ]
    try {
      const raw = await completer(prompt)
      const json = JSON.parse(String(raw).replace(/^```(?:json)?|```$/g, '').trim())
      const out = {
        persona: Array.isArray(json.persona) ? json.persona.slice(0, 8) : [],
        episodic: Array.isArray(json.episodic) ? json.episodic.slice(0, 8) : [],
        instruction: Array.isArray(json.instruction) ? json.instruction.slice(0, 8) : [],
      }
      for (const kind of ['persona', 'episodic', 'instruction']) {
        for (const text of out[kind]) {
          this.state.distilled.push({ at: new Date().toISOString(), kind, text })
        }
      }
      if (this.state.distilled.length > 500) this.state.distilled = this.state.distilled.slice(-500)
      this.save()
      return out
    } catch (e) {
      return { error: e.message }
    }
  }

  /** 蒸馏出的记忆摘要，用于注入 */
  digest(limit = 12) {
    const items = this.state.distilled.slice(-limit)
    if (!items.length) return ''
    return items.map((x) => '- [' + x.kind + '] ' + x.text).join('\n')
  }
}
