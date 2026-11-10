import { after, mock } from 'node:test'
import childProcess from 'node:child_process'
import { syncBuiltinESMExports } from 'node:module'
import { rmSync } from 'node:fs'
import { join } from 'node:path'

const cleanups = []
let currentRoot = ''

/** Call before importing index.js. Unlike HOME-only overrides, this wins over host DSH_HOME. */
export function isolatePlugin(root) {
  currentRoot = root
  const keys = ['SOULMIRROR_TEST', 'SOULMIRROR_HOME', 'HOME', 'USERPROFILE']
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]))
  process.env.SOULMIRROR_TEST = '1'
  process.env.SOULMIRROR_HOME = root
  process.env.HOME = root
  process.env.USERPROFILE = root
  // Fail closed even if a newly added production path bypasses its injected desktop dependency.
  if (process.env.SOULMIRROR_INTEGRATION !== '1') {
    const deny = () => { throw new Error('TEST_ISOLATION: real process/network is forbidden; inject a fake or opt into integration explicitly') }
    for (const name of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) mock.method(childProcess, name, deny)
    if (typeof globalThis.fetch === 'function') mock.method(globalThis, 'fetch', deny)
    syncBuiltinESMExports()
  }
  after(async () => {
    try {
      for (const dispose of cleanups.splice(0).reverse()) await dispose()
    } finally {
      for (const k of keys) {
        if (saved[k] === undefined) delete process.env[k]
        else process.env[k] = saved[k]
      }
      mock.restoreAll()
      syncBuiltinESMExports()
      rmSync(root, { recursive: true, force: true })
    }
  })
}

/** Integration tests register real effects and clean them up, but never discover real windows. */
export function applyIsolated(plugin, ctx, config = {}) {
  return plugin.apply({
    ...ctx,
    effect(register) {
      const dispose = register()
      if (typeof dispose === 'function') cleanups.push(dispose)
      return dispose
    },
  }, {
    enabled: false,
    dataDir: join(currentRoot, 'meetings'),
    pet: { enabled: false },
    ...config,
  }, { listWindows: async () => [] })
}
