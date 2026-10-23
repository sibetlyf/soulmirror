/**
 * lib/env.js —— 环境变量兜底读取
 *
 * 为什么需要：Windows 上把密钥设成「用户环境变量」后，只有**之后新启动**的进程能继承。
 * DSH 经常比变量活得久（或者从没有该变量的父进程启动），于是重启后就报「缺少密钥」。
 *
 * 这里的顺序：进程环境 → 用户环境（HKCU\Environment）→ 系统环境（HKLM）。
 * 读注册表用 reg.exe，零依赖、无需管理员。
 */

import { execFileSync } from 'node:child_process'

const cache = new Map()
const TTL = 30_000

function readRegistry(scope, name) {
  try {
    const out = execFileSync('reg', ['query', `${scope}\\Environment`, '/v', name], {
      encoding: 'utf8',
      timeout: 4000,
      windowsHide: true,
      // 必须显式吞掉 stderr：Node 默认把子进程 stderr 继承给控制台，
      // 查不到值时 reg.exe 的中文报错就会变成启动时那几行乱码
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    // 形如：    DASHSCOPE_API_KEY    REG_SZ    sk-xxxx
    const m = new RegExp(`${name}\\s+REG_[A-Z_]+\\s+(.*)`, 'i').exec(out)
    const v = m && m[1] ? m[1].trim() : ''
    return v || ''
  } catch {
    return ''
  }
}

/**
 * 读一个环境变量，找不到返回空串。
 * @param {string} name
 * @param {{ fresh?: boolean }} opts fresh=true 跳过缓存
 */
export function readEnv(name, opts = {}) {
  const key = String(name || '').trim()
  if (!key) return ''

  // 1) 进程环境最优先
  const fromProc = process.env[key]
  if (fromProc) return fromProc

  // 2) 注册表（带缓存）
  const hit = cache.get(key)
  if (!opts.fresh && hit && Date.now() - hit.at < TTL) return hit.value

  let value = ''
  if (process.platform === 'win32') {
    value = readRegistry('HKCU', key) || readRegistry('HKLM', key)
  }
  cache.set(key, { at: Date.now(), value })
  return value
}

/** 解析密钥：配置里的优先，其次环境变量（含用户级兜底），最后试别名 */
export function resolveApiKey(config = {}, aliases = []) {
  const direct = String(config.apiKey || '').trim()
  if (direct) return { key: direct, source: 'config', envName: '' }

  const names = [String(config.apiKeyEnv || '').trim(), ...aliases].filter(Boolean)
  for (const envName of names) {
    const fromProc = process.env[envName]
    if (fromProc) return { key: fromProc, source: 'env', envName }
    const fromReg = readEnv(envName)
    if (fromReg) return { key: fromReg, source: 'env:registry', envName }
  }
  return { key: '', source: names.length ? 'missing' : 'none', envName: names[0] || '' }
}

/** 给面板用：这个密钥从哪来、有没有 */
export function keyInfo(config = {}) {
  const r = resolveApiKey(config)
  return { set: !!r.key, source: r.source, envName: r.envName }
}

export function clearEnvCache() {
  cache.clear()
}
