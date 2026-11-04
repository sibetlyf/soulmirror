import { existsSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

async function main() {
  const setupPath = join(root, 'lib', 'setup.js')
  if (!existsSync(setupPath)) return
  const mod = await import(new URL('../lib/setup.js', import.meta.url)).catch(() => null)
  if (!mod) return
  try {
    if (process.platform === 'win32') {
      const r = mod.buildBridge()
      console.log('[soulmirror] mbridge ' + (r.ok ? (r.skipped ? '已存在' : '编译完成') : '未就绪：' + (r.error || r.reason || '')))
    }
  } catch (e) { console.log('[soulmirror] 编译跳过：' + e.message) }

  // 生成默认配置（幂等；已存在只补新键）
  try {
    const { ensureConfigFile, installChecklist, formatChecklist } = await import(new URL('../lib/bootstrap.js', import.meta.url))
    const { homedir } = await import('node:os')
    const file = join(homedir(), '.dsh', 'soulmirror', 'config.json')
    const r = ensureConfigFile(file, {
      enabled: false,
      asr: { provider: 'dashscope', dashscopeModel: 'paraformer-realtime-v2', sentenceSilenceMs: 400, hourlyBudgetMinutes: 0 },
      devices: { capture: '', speak: 'CABLE Input' },
      twin: { enabled: true, useActiveWorkspace: true, workspaceCwd: '' },
      mode: 'transcribe',
    })
    console.log('[soulmirror] 配置文件 ' + (r.created ? '已生成：' : '已存在：') + r.path)

    const envKey = process.env.DASHSCOPE_API_KEY || ''
    const rows = installChecklist({
      configFile: !r.error,
      bridge: !!(mod.detectEnv && mod.detectEnv().tools && mod.detectEnv().tools.mbridge),
      key: !!envKey,
      captureDevice: '',
      virtualMic: false,
    })
    console.log(formatChecklist(rows))
  } catch (e) {
    console.log('[soulmirror] 配置自检跳过：' + e.message)
  }
}

main()
