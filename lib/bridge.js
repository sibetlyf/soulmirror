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
    const parts = line.split('\t')
    if (parts.length < 4) continue
    rows.push({ device: parts[0], pid: Number(parts[1] || 0), proc: parts[2] || '', state: Number(parts[3] || 0) })
  }
  return rows
}

/** 会议进程当前是否真的在采某个设备，以及采的是哪个 */
export async function meetingMicActive(procName = 'wemeetapp') {
  const rows = await micUsage()
  const active = rows.filter((r) => r.proc === procName && r.state === 1)
  return { active: active.length > 0, devices: active.map((r) => r.device), all: rows }
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