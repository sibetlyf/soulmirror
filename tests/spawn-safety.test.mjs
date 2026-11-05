import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'

/**
 * 事故回归：全新安装缺 tools/mbridge.exe 时，采集进程 spawn 抛 ENOENT，
 * 而那个 child 没挂 error 监听 → 未捕获异常把整个 DSH 进程打崩（应用闪退）。
 *
 * 这里钉三件事：
 *   1) 源码里所有 spawn 都必须挂 error 监听（或走 run() 包裹）
 *   2) 采集入口必须先 ensureBridge 预检
 *   3) 真的 spawn 一个不存在的 exe 时，挂了 error 监听就不会崩
 */

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')

test('采集入口先预检 mbridge，并且给 child 挂 error 监听', () => {
  const src = read('../lib/session.js')
  const checkAt = src.indexOf('ensureBridge(')
  assert.ok(checkAt > 0, 'session.js 没有 ensureBridge 预检')
  const spawnAt = src.indexOf('this.spawnFn(bridgeExe')
  assert.ok(spawnAt > checkAt, '预检必须在 spawn 之前')
  assert.match(src, /child\.on\('error'/, '采集 child 没有 error 监听（会导致宿主崩溃）')
})

test('tts 的 stream-play 也有预检与 error 监听', () => {
  const src = read('../lib/tts.js')
  assert.match(src, /ensureBridge\(\)/, 'tts 没有 ensureBridge 预检')
  assert.match(src, /child\.on\('error'/, 'tts child 没有 error 监听')
})

test('desktop 的 detached 启动也监听 error', () => {
  const src = read('../lib/desktop.js')
  const at = src.indexOf('spawn(appPath')
  assert.ok(at > 0, '找不到 spawn(appPath')
  const seg = src.slice(at, at + 400)
  assert.match(seg, /\.on\('error'/, 'detached spawn 没有 error 监听')
})

test('ensureBridge 在 exe 缺失且源码也缺失时给出明确原因（不抛异常）', async () => {
  const { ensureBridge } = await import('../lib/bridge.js')
  const r = ensureBridge()
  // 本机装着 exe，应当 ok；契约是不抛异常且结构完整
  assert.equal(typeof r.ok, 'boolean')
  assert.equal(typeof r.path, 'string')
  if (!r.ok) assert.ok(r.error && r.error.length > 0, '失败时必须给原因')
})

test('spawn 一个不存在的可执行文件：挂了 error 监听就不会抛未捕获异常', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sm-spawn-'))
  const missing = join(dir, 'definitely-not-here.exe')
  const err = await new Promise((resolve) => {
    const child = spawn(missing, ['x'], { stdio: ['ignore', 'pipe', 'pipe'] })
    // 关键：监听 error —— 不监听的话这里会变成 uncaught exception
    child.on('error', (e) => resolve(e))
    setTimeout(() => resolve(null), 3000)
  })
  assert.ok(err, '应当收到 error 事件')
  assert.equal(err.code, 'ENOENT')
  rmSync(dir, { recursive: true, force: true })
})
