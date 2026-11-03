/**
 * 安装期自动化：能安全自动做的都做掉，不能自动的给出一次性指引。
 *
 * 分界线很清楚：
 *   ✅ 可以自动：目录、默认配置、编译 mbridge、探测设备、体检清单
 *   ❌ 不能自动：密钥（是你的账号资产）、虚拟声卡驱动（要 UAC 装驱动）、
 *              首次标定（依赖真实窗口）、自动开始采集（隐私）
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** 深合并：已有值优先，缺失字段用默认值补齐（永不覆盖用户设置） */
export function mergeDefaults(defaults, existing) {
  if (Array.isArray(defaults)) return Array.isArray(existing) ? existing : defaults
  if (defaults && typeof defaults === 'object') {
    const out = {}
    const src = existing && typeof existing === 'object' ? existing : {}
    for (const k of new Set([...Object.keys(defaults), ...Object.keys(src)])) {
      out[k] = k in src ? (typeof src[k] === 'object' && src[k] !== null && !Array.isArray(src[k])
        ? mergeDefaults(defaults[k] || {}, src[k])
        : src[k]) : defaults[k]
    }
    return out
  }
  return existing === undefined ? defaults : existing
}

/** 写配置前去掉明显的密钥字段，避免把它们顺手落到磁盘上 */
export function stripSecrets(obj) {
  const SECRET_KEYS = new Set(['apikey', 'apikeyenv', 'token', 'accesstoken', 'secret', 'password'])
  const walk = (v) => {
    if (Array.isArray(v)) return v.map(walk)
    if (v && typeof v === 'object') {
      const out = {}
      for (const [k, val] of Object.entries(v)) {
        if (SECRET_KEYS.has(k.toLowerCase())) continue
        out[k] = walk(val)
      }
      return out
    }
    return v
  }
  return walk(obj)
}

/**
 * 确保配置文件存在（幂等）。
 * @returns {{ created: boolean, path: string, merged?: boolean }}
 */
export function ensureConfigFile(file, defaults) {
  try {
    if (existsSync(file)) {
      let existing = {}
      try { existing = JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, '')) } catch { existing = {} }
      const merged = mergeDefaults(defaults, existing)
      // 只在"确实补了新键"时回写，避免每次启动都碰文件
      if (JSON.stringify(merged) !== JSON.stringify(existing)) {
        mkdirSync(dirname(file), { recursive: true })
        writeFileSync(file, JSON.stringify(stripSecrets(merged), null, 2), 'utf8')
        return { created: false, merged: true, path: file }
      }
      return { created: false, merged: false, path: file }
    }
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, JSON.stringify(stripSecrets(defaults), null, 2), 'utf8')
    return { created: true, path: file }
  } catch (e) {
    return { created: false, error: e.message, path: file }
  }
}

/**
 * 安装体检清单：每一项都给出"现在能不能用 + 怎么自己修"。
 * @param {{ bridge?: boolean, key?: boolean, captureDevice?: string, virtualMic?: boolean,
 *           csc?: boolean, configFile?: boolean }} s
 */
export function installChecklist(s = {}) {
  const rows = []
  const add = (ok, what, fix) => rows.push({ ok: !!ok, what, fix: ok ? '' : fix })

  add(s.configFile, '配置文件', '运行 soul_setup { action: "auto" } 自动生成')
  add(s.bridge, '音频桥接（mbridge.exe）', 'Windows 需要 .NET Framework 4.x；运行 soul_setup { action: "build" }')
  add(s.key, '语音识别密钥（DASHSCOPE_API_KEY）', '到阿里云百炼申请后，在“设置 → 会议助手”或系统环境变量里填；这一步只能你本人做')
  add(!!(s.captureDevice || '').trim(), '采集设备', '打开一次会议并确认有声音，或用 meeting_probe_audio 选出有声音的设备')
  add(s.virtualMic, '虚拟声卡（发言人声进会议用）', '装 VB-CABLE 后需要 UAC 确认；不装只影响“替你说”，不影响转写')
  return rows
}

/** 把清单渲染成给人看的文本 */
export function formatChecklist(rows) {
  const lines = []
  const fail = rows.filter((r) => !r.ok)
  lines.push(fail.length === 0 ? '✅ 全部就绪' : `⚠️ 还差 ${fail.length} 项（其余已就绪）`)
  for (const r of rows) {
    lines.push(`  ${r.ok ? '✓' : '✗'} ${r.what}${r.ok ? '' : '  → ' + r.fix}`)
  }
  return lines.join('\n')
}

/** 默认配置文件路径 */
export function configPath(home) {
  return join(home, '.dsh', 'soulmirror', 'config.json')
}
