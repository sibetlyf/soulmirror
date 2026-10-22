import { spawn } from 'node:child_process'

/**
 * 运行外部命令并收集输出（非 shell，固定 argv）。
 * @returns {Promise<{code:number, stdout:string, stderr:string}>}
 */
export function run(cmd, args, { timeoutMs = 60000, cwd, env } = {}) {
  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    let done = false
    const child = spawn(cmd, args, {
      cwd,
      env: env ? { ...process.env, ...env } : process.env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const timer = setTimeout(() => {
      if (done) return
      done = true
      try { child.kill() } catch { /* ignore */ }
      resolve({ code: -1, stdout, stderr: stderr + `\n[timeout ${timeoutMs}ms]` })
    }, Math.max(1000, timeoutMs))

    child.stdout.on('data', (b) => { stdout += b.toString('utf8') })
    child.stderr.on('data', (b) => { stderr += b.toString('utf8') })
    child.on('error', (err) => {
      if (done) return
      done = true
      clearTimeout(timer)
      resolve({ code: -2, stdout, stderr: stderr + '\n' + err.message })
    })
    child.on('close', (code) => {
      if (done) return
      done = true
      clearTimeout(timer)
      resolve({ code: code ?? -3, stdout, stderr })
    })
  })
}
