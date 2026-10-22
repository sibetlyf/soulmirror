/**
 * lib/twin.js —— 数字分身的外部任务执行器。
 *
 * 两层能力：
 *  1. runDshTask：把任务交给本机 DSH（headless 模式）跑，拿回结果
 *  2. runShellTask：不需要 DSH 的轻量系统任务（避免长链路）
 *
 * 设计要点：
 *  - 全程 child_process.spawn，不落地临时脚本
 *  - 有超时上限，超时kill，避免把会议卡住
 *  - 输出做长度裁剪，避免把整段日志塞进上下文
 */
import { spawn } from 'node:child_process'

function clip(text, max = 4000) {
  const s = String(text || '')
  return s.length > max ? s.slice(0, max) + '\n…（已截断 ' + (s.length - max) + ' 字）' : s
}

/**
 * 把任务交给 DSH headless 执行。
 * @param {string} prompt 自然语言任务
 * @param {object} opts { profile, cwd, timeoutMs, onOutput }
 */
export function runDshTask(prompt, opts = {}) {
  const profile = opts.profile || 'headless'
  const timeoutMs = Math.max(10000, Math.min(opts.timeoutMs || 180000, 600000))
  const args = [prompt]
  if (profile) args.unshift('--profile', profile)
  return new Promise((resolve) => {
    let out = ''
    let err = ''
    let done = false
    const finish = (r) => {
      if (done) return
      done = true
      resolve(r)
    }
    let child
    try {
      child = spawn('dsh', args, {
        cwd: opts.cwd || process.cwd(),
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: process.platform === 'win32',
        windowsHide: true,
      })
    } catch (e) {
      return finish({ ok: false, error: '启动 dsh 失败: ' + e.message })
    }
    const timer = setTimeout(() => {
      try { child.kill() } catch { /* ignore */ }
      finish({ ok: false, error: '任务超时（' + Math.round(timeoutMs / 1000) + 's）', output: clip(out) })
    }, timeoutMs)
    child.stdout.on('data', (b) => {
      const s = b.toString()
      out += s
      opts.onOutput?.(s)
    })
    child.stderr.on('data', (b) => { err += b.toString() })
    child.on('error', (e) => {
      clearTimeout(timer)
      finish({ ok: false, error: '执行失败: ' + e.message })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      finish({ ok: code === 0, code, output: clip(out), error: code === 0 ? '' : clip(err || ('退出码 ' + code)) })
    })
  })
}

/** 轻量 shell 任务（不需要模型时用，快） */
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
