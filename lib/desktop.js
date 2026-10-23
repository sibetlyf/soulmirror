import { existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { ui } from './bridge.js'

const CANDIDATES = [
  'E:\\Tencent\\Meeting\\WeMeet\\wemeetapp.exe',
  process.env.LOCALAPPDATA + '\\Tencent\\WeMeet\\wemeetapp.exe',
  process.env.ProgramFiles + '\\Tencent\\WeMeet\\wemeetapp.exe',
  process.env['ProgramFiles(x86)'] + '\\Tencent\\WeMeet\\wemeetapp.exe',
]

export const MEETING_CLASSES = ['FloatSpeakingWnd', 'VideoMainWindow', 'MeetingMainWindow', 'MeetingView', 'BaseDialog']

export function resolveAppPath(configured) {
  const list = configured ? [configured, ...CANDIDATES] : CANDIDATES
  for (const p of list) if (p && existsSync(p)) return p
  return ''
}

/** 列表模式的窗口选择参数：标题片段 + 类名片段 + 进程名 */
let WINDOW_SELECTOR = { cls: '', proc: '' }

/** 由插件在启动时设置默认窗口选择器（类名/进程名），避免误操作别的窗口 */
export function setWindowSelector(o = {}) {
  WINDOW_SELECTOR = { cls: o.cls || '', proc: o.proc || '' }
}

function selector(title, opts = {}) {
  const merged = { ...WINDOW_SELECTOR, ...opts }
  const args = []
  if (title) args.push('-title', title)
  if (merged.cls) args.push('-cls', merged.cls)
  if (merged.proc) args.push('-proc', merged.proc)
  return args
}

export async function listWindows() {
  const r = await ui(['list'])
  if (r.code !== 0) throw new Error((r.text || r.stderr || 'ui list 失败').slice(0, 300))
  const out = []
  for (const line of r.text.split(/\r?\n/)) {
    const parts = line.split('\t')
    if (parts.length < 4) continue
    // ui.ps1 list 的列：pid / proc / cls / title / WxH / left,top
    const sizePart = (parts[4] || "").split("x")
    const posPart = (parts[5] || "").split(",")
    const rectRaw = parts[4] + (parts[5] ? "\t" + parts[5] : "")
    out.push({
      pid: Number(parts[0]),
      proc: parts[1],
      cls: parts[2],
      title: parts[3],
      rect: rectRaw,
      w: Number(sizePart[0]) || 0,
      h: Number(sizePart[1]) || 0,
      x: Number(posPart[0]) || 0,
      y: Number(posPart[1]) || 0,
    })
  }
  return out
}

export function pickMeetingWindows(windows, fragment, procName = '') {
  return windows.filter((w) => {
    if (procName && w.proc !== procName) return false
    return (fragment && w.title.includes(fragment))
      || MEETING_CLASSES.some((c) => w.cls && w.cls.includes(c))
  })
}

export async function dump(title, max = 60, opts = {}) {
  const r = await ui(['dump', ...selector(title, opts), '-max', String(max)])
  if (r.code !== 0) throw new Error((r.text || r.stderr || 'dump 失败').slice(0, 300))
  return r.text
}

export async function focus(title, opts = {}) {
  const r = await ui(['focus', ...selector(title, opts)])
  if (r.code !== 0) throw new Error((r.text || r.stderr || 'focus 失败').slice(0, 300))
  return r.text
}

/** 窗口客户区的物理屏幕矩形（DPI 感知）：{ x, y, w, h } */
export async function clientRect(title, opts = {}) {
  const r = await ui(['rect', ...selector(title, opts)])
  if (r.code !== 0) throw new Error((r.text || '').trim() || 'rect failed')
  const m = /OK rect (-?\d+),(-?\d+) (\d+)x(\d+)/.exec(r.text || '')
  if (!m) throw new Error("rect 解析失败: " + String(r.text).slice(0, 120))
  return { x: Number(m[1]), y: Number(m[2]), w: Number(m[3]), h: Number(m[4]) }
}

/** 按客户区相对坐标（0~1）点击：用于 Qt 自绘按钮 */
export async function clickRatio(title, rx, ry, opts = {}) {
  const rect = await clientRect(title, opts)
  const x = Math.round(rect.x + rect.w * Math.max(0, Math.min(1, rx)))
  const y = Math.round(rect.y + rect.h * Math.max(0, Math.min(1, ry)))
  await clickXY(title, x, y, opts)
  return { x, y, rect }
}

/** 按屏幕绝对坐标点击（Qt 自绘界面用） */
export async function clickXY(title, x, y, opts = {}) {
  const r = await ui(['clickxy', ...selector(title, opts), '-x', String(Math.round(x)), '-y', String(Math.round(y))])
  if (r.code !== 0) throw new Error((r.text || '').trim() || 'clickxy failed')
  return 'clickxy'
}

export async function click(title, name, opts = {}) {
  const r = await ui(['click', ...selector(title, opts), '-name', name])
  if (r.code !== 0) throw new Error((r.text || r.stderr || 'click 失败').slice(0, 300))
  return r.text
}

export async function setText(title, name, value, opts = {}) {
  const r = await ui(['settext', ...selector(title, opts), '-name', name, '-value', value])
  if (r.code !== 0) throw new Error((r.text || r.stderr || 'settext 失败').slice(0, 300))
  return r.text
}

export async function pressKey(title, keys, opts = {}) {
  const r = await ui(['key', ...selector(title, opts), '-keys', keys])
  if (r.code !== 0) throw new Error((r.text || r.stderr || 'key 失败').slice(0, 300))
  return r.text
}

export async function typeText(title, text, opts = {}) {
  const r = await ui(['type', ...selector(title, opts), '-text', text])
  if (r.code !== 0) throw new Error((r.text || r.stderr || 'type 失败').slice(0, 300))
  return r.text
}

export async function ensureApp(appPath, fragment, procName = '') {
  const wins = await listWindows()
  const existing = pickMeetingWindows(wins, fragment, procName)
  if (existing.length > 0) return { launched: false, windows: existing }
  if (!appPath) throw new Error('未找到会议客户端可执行文件，请配置 appPath')
  spawn(appPath, [], { detached: true, stdio: 'ignore', windowsHide: false }).unref()
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 500))
    const now = pickMeetingWindows(await listWindows(), fragment, procName)
    if (now.length > 0) return { launched: true, windows: now }
  }
  return { launched: true, windows: [] }
}

/** 切换会议麦克风：优先点 mic 控件，失败退回 Ctrl+M 快捷键 */
export async function toggleMic(title, opts = {}) {
  const r = await ui(['click', ...selector(title, opts), '-name', 'mic'])
  if (r.code === 0) return { how: 'click', detail: r.text }
  const k = await ui(['key', ...selector(title, opts), '-keys', 'ctrl+m'])
  if (k.code === 0) return { how: 'hotkey', detail: k.text }
  throw new Error((r.text || k.text || '切换麦克风失败').trim())
}
/** 读腾讯会议"正在讲话"悬浮窗，拿当前发言人名字（读不到返回空串） */
export async function currentSpeaker(opts = {}) {
  const r = await ui(['dump', '-cls', 'FloatSpeakingWnd', '-proc', opts.proc || 'wemeetapp', '-max', '80'])
  if (r.code !== 0) return ''
  const lines = (r.text || '').split(/\r?\n/)
  let name = ''
  for (const line of lines) {
    const cols = line.split('\t')
    const label = (cols[2] || '').trim()
    const aid = (cols[3] || '').trim()
    if (!label) continue
    if (/speaking_members/.test(aid)) name = label.replace(/[;；]\s*$/, '').trim()
    const m = /正在讲话[:：]\s*(.+)$/.exec(label)
    if (m && m[1].trim()) name = m[1].replace(/[;；]\s*$/, '').trim()
  }
  return name
}