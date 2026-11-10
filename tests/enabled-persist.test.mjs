import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync, rmdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * 总开关必须"先落盘，再生效"。
 *
 * 真实症状：界面显示已开启、config.json 里还是关的，重启后又变回去。
 * 原因是先改内存、再 try{savePersisted()}catch{} —— 写盘失败被吞掉了。
 * 现在写失败就保持原状并且接口如实报错。
 */

const home = mkdtempSync(join(tmpdir(), 'sm-enabled-'))
const envKeys = ['SOULMIRROR_TEST', 'SOULMIRROR_HOME', 'USERPROFILE', 'HOME']
const savedEnv = Object.fromEntries(envKeys.map((k) => [k, process.env[k]]))
process.env.SOULMIRROR_TEST = '1'
process.env.SOULMIRROR_HOME = home
process.env.USERPROFILE = home
process.env.HOME = home

const cfgDir = join(home, 'soulmirror')
const cfgFile = join(cfgDir, 'config.json')
mkdirSync(cfgDir, { recursive: true })
// 一开始是关的
writeFileSync(cfgFile, JSON.stringify({ enabled: false, autoWatch: false }), 'utf8')

const disposers = []
test.after(async () => {
  try { for (const d of disposers.reverse()) await d() } finally {
    for (const k of envKeys) {
      if (savedEnv[k] === undefined) delete process.env[k]
      else process.env[k] = savedEnv[k]
    }
    rmSync(home, { recursive: true, force: true })
  }
})

const mod = await import('../index.js')
const plugin = mod.default || mod
const routes = []
plugin.apply({
  tools: { register() {} },
  logger: { info() {}, warn() {}, error() {} },
  get: () => undefined,
  webServer: { port: 3086, register(r) { routes.push(r) } },
  on: () => () => {},
  effect(register) { const d = register(); if (typeof d === 'function') disposers.push(d); return d || (() => {}) },
  emit() {},
}, { enabled: false, dataDir: join(home, 'meetings'), pet: { enabled: false } }, { listWindows: async () => [] })

async function api(body) {
  let out = ''
  const res = { code: 0, writeHead(c) { this.code = c }, end(s) { out = s } }
  const req = { method: 'POST', url: '/api/soulmirror/auto', [Symbol.asyncIterator]: async function* () { yield Buffer.from(JSON.stringify(body)) } }
  await routes[0].handler(req, res)
  return { code: res.code, body: JSON.parse(out || '{}') }
}
const onDisk = () => JSON.parse(readFileSync(cfgFile, 'utf8'))

test('开启：磁盘先写成 true，接口才回 enabled=true', async () => {
  const r = await api({ action: 'start' })
  assert.equal(r.body.ok, true)
  assert.equal(r.body.enabled, true)
  assert.equal(onDisk().enabled, true, '磁盘必须真的变成 true')
  assert.equal(onDisk().autoWatch, true)
})

test('关闭：磁盘先写成 false，再解除 armed', async () => {
  const r = await api({ action: 'off' })
  assert.equal(r.body.ok, true)
  assert.equal(r.body.enabled, false)
  assert.equal(r.body.armed, false)
  assert.equal(onDisk().enabled, false)
})

test('写盘失败时：保持原状、如实报错，不谎称已开启', async () => {
  const before = onDisk().enabled
  // 把配置文件换成目录，写入必然失败（仍然隔离在临时目录里）
  rmSync(cfgFile, { force: true })
  mkdirSync(cfgFile)
  try {
    const r = await api({ action: 'start' })
    assert.equal(r.body.ok, false, '写不进去就不能回成功')
    assert.match(String(r.body.error), /保存|写入/)
    assert.equal(r.body.enabled, before === true, '内存里的开关必须保持原状')
  } finally {
    rmdirSync(cfgFile)
    writeFileSync(cfgFile, JSON.stringify({ enabled: before, autoWatch: false }), 'utf8')
  }
})
