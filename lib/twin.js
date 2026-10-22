/**
 * lib/twin.js —— 数字分身的外部任务执行器。
 *
 * 能力：
 *  1. runDshTask：把任务交给本机 DSH（headless）跑，拿回结果
 *  2. runShell：不需要模型的轻量系统任务
 *
 * 会话模型：
 *  - 每场会议对应一个 cwd（工作区）与一个 DSH session
 *  - 首次任务从 --json 事件里拿到 sessionId；后续任务用 --session-id 续接
 *  - 端侧可在 DSH 会话列表里翻看"这场会里模型说了什么"
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { join as joinPath } from 'node:path'

function clip(text, max = 4000) {
  const s = String(text || '')
  return s.length > max ? s.slice(0, max) + '\n…（已截断 ' + (s.length - max) + ' 字）' : s
}

/** 找到 dsh 的 bin.js，直接用 node 调起（绕开 .cmd/.ps1 的引号问题） */
export function resolveDshBin() {
  const env = process.env.DSH_BIN
  if (env && existsSync(env)) return env
  const cands = []
  const appData = process.env.APPDATA
  if (appData) cands.push(joinPath(appData, 'npm', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'))
  const prefix = process.env.npm_config_prefix || process.env.PREFIX
  if (prefix) cands.push(joinPath(prefix, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'))
  cands.push('E:/NodeJS/node_global/node_modules/@deepseek-ai/dsh/lib/bin.js')
  cands.push('/usr/local/lib/node_modules/@deepseek-ai/dsh/lib/bin.js')
  for (const c of cands) if (existsSync(c)) return c
  return ''
}

/**
 * @param {string} prompt
 * @param {{profile?:string,cwd?:string,timeoutMs?:number,sessionId?:string,onOutput?:Function,onSession?:Function}} opts
 */
export function runDshTask(prompt, opts = {}) {
  const profile = opts.profile || 'headless'
  const timeoutMs = Math.max(10000, Math.min(opts.timeoutMs || 180000, 600000))
  const cwd = opts.cwd || process.cwd()
  try { mkdirSync(cwd, { recursive: true }) } catch { /* ignore */ }

  // headless 支持 --json（能拿到 sessionId 与结构化事件）；
  // web/tui 等应用不认这个参数，退回纯文本模式。
  const useJson = opts.json !== undefined ? !!opts.json : profile === 'headless'
  const args = ['--profile', profile]
  if (useJson) args.push('--json')
  if (opts.sessionId) args.push('--session-id', opts.sessionId)
  args.push(prompt)

  return new Promise((resolve) => {
    let err = ''
    let text = ''
    let sessionId = opts.sessionId || ''
    let done = false
    const finish = (r) => {
      if (done) return
      done = true
      resolve(r)
    }

    let child
    const bin = resolveDshBin()
    try {
      if (bin) {
        child = spawn(process.execPath, [bin, ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
      } else if (process.platform === 'win32') {
        const q = (s) => '"' + String(s).replace(/(["^&|<>%])/g, '^$1') + '"'
        const line = 'dsh ' + args.map(q).join(' ')
        child = spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', line], { cwd, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
      } else {
        child = spawn('dsh', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
      }
    } catch (e) {
      return finish({ ok: false, error: '启动 dsh 失败: ' + e.message })
    }

    const timer = setTimeout(() => {
      try { child.kill() } catch { /* ignore */ }
      finish({ ok: false, error: '任务超时（' + Math.round(timeoutMs / 1000) + 's）', sessionId })
    }, timeoutMs)

    let buf = ''
    child.stdout.on('data', (b) => {
      buf += b.toString()
      let idx
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).trim()
        buf = buf.slice(idx + 1)
        if (!line) continue
        opts.onOutput?.(line)
        if (!useJson) { text += line + '\n'; continue }
        let ev
        try { ev = JSON.parse(line) } catch { continue }
        if (ev.type === 'session' && ev.sessionId) {
          sessionId = ev.sessionId
          opts.onSession?.(ev.sessionId, ev.cwd)
        }
        if (ev.type === 'text' && ev.text) text += ev.text
        if (ev.type === 'final' && ev.text) text = ev.text
      }
    })
    child.stderr.on('data', (b) => { err += b.toString() })
    child.on('error', (e) => { clearTimeout(timer); finish({ ok: false, error: '执行失败: ' + e.message, sessionId }) })
    child.on('close', (code) => {
      clearTimeout(timer)
      finish({
        ok: code === 0,
        code,
        sessionId,
        text: clip(text, 2000),
        output: clip(text),
        error: code === 0 ? '' : clip(err || ('退出码 ' + code)),
      })
    })
  })
}

/** 轻量 shell 任务 */
export function runShell(command, opts = {}) {
  const timeoutMs = Math.max(3000, Math.min(opts.timeoutMs || 30000, 120000))
  return new Promise((resolve) => {
    let out = ''
    let err = ''
    let done = false
    const finish = (r) => { if (!done) { done = true; resolve(r) } }
    const child = spawn(process.platform === 'win32' ? 'powershell.exe' : 'sh', process.platform === 'win32'
      ? ['-NoProfile', '-Command', command]
      : ['-c', command], { cwd: opts.cwd || process.cwd(), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    const timer = setTimeout(() => {
      try { child.kill() } catch { /* ignore */ }
      finish({ ok: false, error: '超时', output: clip(out) })
    }, timeoutMs)
    child.stdout.on('data', (b) => { out += b.toString() })
    child.stderr.on('data', (b) => { err += b.toString() })
    child.on('error', (e) => { clearTimeout(timer); finish({ ok: false, error: e.message }) })
    child.on('close', (code) => {
      clearTimeout(timer)
      finish({ ok: code === 0, code, output: clip(out), error: code === 0 ? '' : clip(err) })
    })
  })
}
