/**
 * scripts/postinstall.mjs
 * dsh 安装（dsh plugin add github:...#main）后自动执行：
 *  - Windows：若缺 tools/mbridge.exe，用系统 csc 现场编译
 *  - 其他平台：只做检测与提示，不做破坏性操作
 * 任何失败都只告警，不阻断安装。
 */
import { existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

async function main() {
  const setupPath = join(root, 'lib', 'setup.js')
  if (!existsSync(setupPath)) {
    console.log('[soulmirror] 跳过：找不到 lib/setup.js')
    return
  }
  let mod
  try {
    mod = await import(new URL('../lib/setup.js', import.meta.url))
  } catch (e) {
    console.log('[soulmirror] 跳过自检：' + e.message)
    return
  }
  try {
    if (process.platform === 'win32') {
      const r = mod.buildBridge()
      if (r.ok) console.log('[soulmirror] mbridge ' + (r.skipped ? '已存在' : '编译完成') + '：' + (r.path || ''))
      else console.log('[soulmirror] mbridge 未就绪：' + (r.error || r.reason || '未知原因'))
    }
    const env = mod.detectEnv()
    console.log('[soulmirror] 环境自检：' + (env.ready ? '就绪' : '缺 ' + env.missing.join('、')))
    for (const h of env.hints) console.log('[soulmirror] 提示：' + h)
  } catch (e) {
    console.log('[soulmirror] 自检失败（不影响安装）：' + e.message)
  }
}

main()
