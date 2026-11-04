import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { run } from './proc.js'

export const pluginDir = dirname(dirname(fileURLToPath(import.meta.url)))
export const toolsDir = join(pluginDir, 'tools')
export const bridgeExe = join(toolsDir, 'mbridge.exe')
export const uiScript = join(toolsDir, 'ui.ps1')
export const micScript = join(toolsDir, 'mic.ps1')
export const holdScript = join(toolsDir, 'hold.ps1')

/** 调用 mbridge.exe */
export async function bridge(args, { timeoutMs = 120000 } = {}) {
  const r = await run(bridgeExe, args, { timeoutMs })
  if (r.code !== 0) {
    throw new Error(`mbridge ${args[0]} 失败(code=${r.code}): ${(r.stderr || r.stdout || '').trim().slice(0, 500)}`)
  }
  return r.stdout.trim()
}

/** 调用 ui.ps1（Windows PowerShell 5.1，UIAutomation + SendKeys） */
export async function ui(args, { timeoutMs = 45000 } = {}) {
  const r = await run('powershell.exe', [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', uiScript, ...args,
  ], { timeoutMs })
  return { ...r, text: (r.stdout || '').trim() }
}

/** 解析 devices 输出为结构化列表 */
export function parseDevices(text) {
  const list = []
  for (const line of text.split(/\r?\n/)) {
    const parts = line.split('\t')
    if (parts.length < 3) continue
    const [flow, idx, name] = parts
    if (flow !== 'RENDER' && flow !== 'CAPTURE') continue
    list.push({ flow, index: Number(idx), name, id: parts[3] || '' })
  }
  return list
}

/** 谁在占用哪个麦克风：返回 [{device,pid,proc,state}]，state=1 表示正在采集 */
export async function micUsage() {
  const out = await bridge(['mic-usage'], { timeoutMs: 20000 })
  const rows = []
  for (const line of out.split(/\r?\n/)) {
    const parts = line.split('\t').map((x) => x.trim())
    if (parts.length < 2) continue
    // 实测列数不固定：进程名读不到时会少一列（device / pid / state）。
    // 状态永远在最后一列，进程名在中间（可能为空）。
    const state = Number(parts[parts.length - 1] || 0)
    const pid = Number(parts[1] || 0)
    const proc = parts.length >= 4 ? (parts[2] || '') : ''
    rows.push({ device: parts[0], pid, proc, state })
  }
  return rows
}

/** 会议进程当前是否真的在采某个设备，以及采的是哪个 */
export async function meetingMicActive(procName = 'wemeetapp') {
  const rows = await micUsage()
  const want = String(procName || '').toLowerCase()
  // 进程名可能读不到（权限/时序）：不能因为匹配不上就把"正在采集"判成没有，
  // 否则切麦校验永远失败（曾经真的这样误报过）。
  const active = rows.filter((r) => r.state === 1 && (!r.proc || r.proc.toLowerCase().includes(want)))
  return { active: active.length > 0, devices: active.map((r) => r.device), all: rows }
}

/**
 * 决定这次采集用哪个设备。只在启动时调用一次，结果全程锁定。
 * 优先级：配置显式指定 > 正在出声的设备 > 系统默认播放设备
 */
export function pickCaptureDevice({ configured = "", defaultDevice = "", loud = null, loudThreshold = 0.05 } = {}) {
  const cfg = String(configured || "").trim()
  if (cfg) return { device: cfg, why: "配置指定" }

  const def = String(defaultDevice || "").trim()
  const loudName = loud && loud.name ? String(loud.name) : ""
  const loudLevel = loud && Number(loud.level) ? Number(loud.level) : 0

  // 有别的设备此刻正在出声 → 那才是应用实际在用的输出
  if (loudName && loudLevel >= loudThreshold && loudName !== def) {
    return { device: loudName, why: "正在出声（峰值 " + loudLevel.toFixed(2) + "）" }
  }
  if (def) return { device: def, why: "系统默认播放设备" }
  return { device: "", why: "未检测到（用系统默认）" }
}

/** 系统默认播放设备名（应用默认往这里送声音） */
/**
 * 问系统：这些进程正在往哪个渲染端点放声音？
 * 依赖桥接的 session-device 命令（枚举音频会话 + 进程映像名匹配）。
 * @param {string[]} processNames 例如 ['wemeetapp','CloudVideo','Feishu']
 * @returns {Promise<{ name: string, id: string } | null>}
 */
export async function sessionDevice(processNames = []) {
  const list = (Array.isArray(processNames) ? processNames : [processNames]).map((x) => String(x || '').trim()).filter(Boolean)
  if (list.length === 0) return null
  try {
    const out = await bridge(['session-device', '--process', list.join(',')], { timeoutMs: 20000 })
    for (const line of String(out).split(/\r?\n/)) {
      const parts = line.split('\t')
      if (parts[0] === 'DEVICE' && parts[1]) return { name: parts[1], id: parts[2] || '' }
    }
  } catch { /* 命令不存在或失败：交给上层回退 */ }
  return null
}

export async function defaultRenderDevice() {
  const out = await bridge(['default', '--flow', 'render'], { timeoutMs: 15000 }).catch(() => '')
  return String(out || "").trim().split(/\r?\n/)[0].trim()
}

/** 读各渲染设备当前峰值，返回 { name → level } */
export async function renderLevels() {
  const out = await bridge(['meters'], { timeoutMs: 20000 }).catch(() => '')
  const map = new Map()
  for (const line of String(out).split(/\r?\n/)) {
    const [name, v] = line.split('\t')
    if (!name) continue
    const n = Number(v) || 0
    map.set(name, Math.max(map.get(name) || 0, n))
  }
  return map
}

/**
 * 找出"正在出声"的渲染设备。会议声音可能不在系统默认设备上（比如走 HDMI），
 * 采默认设备的环回就只能是静音，所以采之前先看一眼谁在响。
 * @returns {Promise<{name:string, level:number}|null>}
 */
export async function loudestRenderDevice({ samples = 5, intervalMs = 300, min = 0.01 } = {}) {
  const seen = new Map()
  for (let i = 0; i < samples; i++) {
    const levels = await renderLevels()
    for (const [k, v] of levels) seen.set(k, Math.max(seen.get(k) || 0, v))
    if (i < samples - 1) await new Promise((r) => setTimeout(r, intervalMs))
  }
  let best = null
  for (const [name, level] of seen) {
    if (level >= min && (!best || level > best.level)) best = { name, level }
  }
  return best
}

export async function listDevices() {
  return parseDevices(await bridge(['devices']))
}

/** 会议窗口被最小化到屏幕外时把它还原 */
export async function restoreWindow(title, opts = {}) {
  const r = await ui(['restore', ...selector(title, opts)])
  return r.code === 0 ? (r.text || 'OK') : ''
}

/** 用 OCR 读工具栏判断麦克风状态：muted / unmuted / unknown；unknown 时回显识别到的词便于排查 */
export async function micStateOcr(title) {
  try {
    const r = await run('powershell.exe', [
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', micScript, 'probe', '-title', title,
    ], { timeoutMs: 30000 })
    const line = (r.stdout || '').trim().split(/\r?\n/).pop() || ''
    const j = JSON.parse(line)
    return { state: j.ok ? j.state : 'unknown', label: j.label || '', words: j.words }
  } catch (e) {
    return { state: 'unknown', error: e.message }
  }
}

/** 点击麦克风按钮切换，返回 before/after */
export async function toggleMicOcr(title) {
  try {
    const r = await run('powershell.exe', [
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', micScript, 'toggle', '-title', title,
    ], { timeoutMs: 45000 })
    const line = (r.stdout || '').trim().split(/\r?\n/).pop() || ''
    return JSON.parse(line)
  } catch (e) {
    return { ok: false, error: e.message }
  }
}
/** 按住空格（腾讯会议"长按空格发言"）：必须是真实前台窗口才吃键 */
export async function holdSpaceDown(title) {
  const r = await run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', holdScript, 'down', '-title', title], { timeoutMs: 15000 })
  return { ok: r.code === 0, text: (r.stdout || '').trim(), err: (r.stderr || '').trim() }
}

export async function holdSpaceUp() {
  const r = await run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', holdScript, 'up'], { timeoutMs: 10000 })
  return { ok: r.code === 0, text: (r.stdout || '').trim(), err: (r.stderr || '').trim() }
}