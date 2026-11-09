/**
 * 密钥存储桥：**优先用 DSH 的凭据服务，没有才回退到插件自己的文件**。
 *
 * 为什么要有这一层（对比出来的差距）：
 *   DSH 官方把机密放在 `<DSH_HOME>/.credentials.yaml`，配置里只写"名字"，
 *   读用 ctx.credentials.resolve，界面用 describe（只报状态、不返回值）。
 *   而我们现在把 Key 明文写在 soulmirror/config.json 里——和设置同一个文件，
 *   可同步、可备份、可贴进 issue，还出过"启动补齐时被 strip 掉"的事故。
 *
 * 所以：
 *   · 宿主有 credentials 服务 → 存进它的 records（`soulmirror/asr`、`soulmirror/tts`）
 *   · 没有 → 落到插件自己的 `credentials.json`（单文件、仅属主可读）
 *   · config.json 只保留 `asr.keyRef` 这类**名字**，不再留明文
 *
 * 这一层只做纯粹的决策与读写编排，不依赖 cordis，便于单测。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs'
import { join } from 'node:path'

export const SCOPE = 'soulmirror'

/** 每个密钥槽位的定义 */
export const SLOTS = {
  asr: { id: 'asr', ref: 'SOULMIRROR_ASR_KEY', label: '语音识别 Key' },
  tts: { id: 'tts', ref: 'SOULMIRROR_TTS_KEY', label: '语音合成 Key' },
  brain: { id: 'brain', ref: 'SOULMIRROR_BRAIN_KEY', label: '判断模型 Key' },
}

function readJson(file) {
  try { return JSON.parse(readFileSync(file, 'utf8')) } catch { return null }
}

/** 插件自带的密钥文件路径 */
export function fileStorePath(configDir) {
  return join(configDir, 'credentials.json')
}

/**
 * 创建密钥存储。
 *
 * @param {{
 *   credentials?: object | null,   // ctx.credentials（可能没有）
 *   configDir: string,             // 回退文件的目录
 *   logger?: object,
 * }} o
 */
export function createKeyStore({ credentials = null, configDir = '', logger = null } = {}) {
  const file = configDir ? fileStorePath(configDir) : ''
  const hasService = !!(credentials && typeof credentials === 'object')

  const mode = hasService ? 'dsh-credentials' : (file ? 'plugin-file' : 'none')

  const loadFile = () => (file && existsSync(file) ? (readJson(file) || {}) : {})

  const saveFile = (obj) => {
    if (!file) throw new Error('没有可写的密钥文件目录')
    mkdirSync(configDir, { recursive: true })
    writeFileSync(file, JSON.stringify(obj, null, 2), 'utf8')
    try { chmodSync(file, 0o600) } catch { /* Windows 上没有意义 */ }
  }

  return {
    mode,
    /** 存储位置说明（给 /status 与日志用，不含密钥） */
    describeLocation() {
      if (hasService) return { mode, scope: SCOPE, path: '(DSH 凭据存储)' }
      return { mode, path: file }
    },

    /**
     * 读取某个槽位的密钥。
     * @param {'asr'|'tts'|'brain'} slot
     * @returns {Promise<{value: string, source: string}>}
     */
    async get(slot) {
      const def = SLOTS[slot]
      if (!def) return { value: '', source: 'none' }

      if (hasService) {
        try {
          // 先按记录读（我们自己写入的位置）
          if (typeof credentials.readRecord === 'function') {
            const rec = await credentials.readRecord(SCOPE + '/' + def.id)
            const v = rec && rec.payload && (rec.payload.token || rec.payload.value || rec.payload.secret)
            if (v) return { value: String(v), source: 'dsh-credentials:record' }
          }
          // 再按命名引用读（用户可能在 DSH 界面里以环境变量名存过）
          if (typeof credentials.resolve === 'function') {
            const hit = await credentials.resolve(def.ref)
            if (hit && hit.value) return { value: String(hit.value), source: 'dsh-credentials:ref:' + def.ref }
          }
          // 服务在，但确实没配
          return { value: '', source: 'none' }
        } catch (e) {
          // 关键：不回退。读不到就报错，别让调用方以为"没配置"或悄悄用旧值。
          const msg = '读取 DSH 凭据失败（' + def.id + '）：' + (e && e.message ? e.message : String(e))
          logger?.warn?.('[soulmirror] ' + msg)
          return { value: '', source: 'error', error: msg }
        }
      }

      if (file) {
        const all = loadFile()
        if (all[def.id]) return { value: String(all[def.id]), source: 'plugin-file' }
      }
      return { value: '', source: 'none' }
    },

    /**
     * 写入密钥；空字符串表示清除。
     * @returns {Promise<{ok: boolean, error?: string, mode: string}>}
     */
    async set(slot, value) {
      const def = SLOTS[slot]
      if (!def) return { ok: false, error: '未知槽位 ' + slot, mode }
      const v = String(value == null ? '' : value).trim()

      if (hasService) {
        try {
          if (v && typeof credentials.modifyRecord === 'function') {
            await credentials.modifyRecord(SCOPE + '/' + def.id, async () => ({
              kind: 'grant',
              payload: { token: v },
            }))
            return { ok: true, mode: 'dsh-credentials' }
          }
          if (!v && typeof credentials.deleteRecord === 'function') {
            await credentials.deleteRecord(SCOPE + '/' + def.id)
            // 顺手清掉可能存在的命名引用（失败不算错）
            try { await credentials.unset?.(def.ref) } catch { /* ignore */ }
            return { ok: true, mode: 'dsh-credentials' }
          }
          if (v && typeof credentials.set === 'function') {
            await credentials.set(def.ref, v)
            return { ok: true, mode: 'dsh-credentials' }
          }
          return { ok: false, mode: 'dsh-credentials', error: '凭据服务没有可用的写入方法（modifyRecord / set 都不可用）' }
        } catch (e) {
          // 关键：不回退。回退会让用户以为存进了 DSH，实际落在别处；
          // 明确报错才能让人去修权限/组合，而不是留下一份自己都找不到的副本。
          const msg = '写入 DSH 凭据失败（' + def.id + '）：' + (e && e.message ? e.message : String(e))
          logger?.warn?.('[soulmirror] ' + msg)
          return { ok: false, mode: 'dsh-credentials', error: msg }
        }
      }

      if (!file) return { ok: false, error: '没有可写的密钥存储', mode }
      try {
        const all = loadFile()
        if (v) all[def.id] = v
        else delete all[def.id]
        saveFile(all)
        return { ok: true, mode: 'plugin-file' }
      } catch (e) {
        return { ok: false, error: e.message, mode }
      }
    },

    /** 清除 */
    async clear(slot) {
      return this.set(slot, '')
    },

    /**
     * 判断某个槽位是否已配置（不读值，等价于 DSH 的 describe）。
     * @returns {Promise<{configured: boolean, source: string}>}
     */
    async describe(slot) {
      const def = SLOTS[slot]
      if (!def) return { configured: false, source: 'none' }
      if (hasService && typeof credentials.describeRecord === 'function') {
        try {
          const d = await credentials.describeRecord(SCOPE + '/' + def.id)
          if (d && d.configured) return { configured: true, source: 'dsh-credentials' }
        } catch { /* ignore */ }
      }
      if (file) {
        const all = loadFile()
        if (all[def.id]) return { configured: true, source: 'plugin-file' }
      }
      return { configured: false, source: 'none' }
    },

    /**
     * 迁移：把配置文件里的明文 Key 搬进安全存储，并从配置里删掉。
     * @param {{asr?: string, tts?: string, brain?: string}} legacy
     * @returns {Promise<{migrated: string[], failed: string[]}>}
     */
    async migrate(legacy = {}) {
      const migrated = []
      const failed = []
      for (const slot of Object.keys(SLOTS)) {
        const v = String(legacy[slot] || '').trim()
        if (!v) continue
        try {
          // 已经有值就不覆盖（用户可能已经在新位置存过了）
          const cur = await this.get(slot)
          if (cur.value) { migrated.push(slot + '（已存在，跳过）'); continue }
          const r = await this.set(slot, v)
          if (r.ok) migrated.push(slot)
          else failed.push(slot + '：' + (r.error || '未知原因'))
        } catch (e) {
          failed.push(slot + '：' + e.message)
        }
      }
      return { migrated, failed }
    },
  }
}

/**
 * 从一份配置里挑出"明文密钥"，用于迁移与后续擦除。
 * @param {object} cfg
 * @returns {{asr: string, tts: string, brain: string}}
 */
export function pickLegacyKeys(cfg = {}) {
  return {
    asr: (cfg.asr && cfg.asr.apiKey) || '',
    tts: (cfg.tts && cfg.tts.apiKey) || '',
    brain: (cfg.brain && cfg.brain.apiKey) || '',
  }
}
