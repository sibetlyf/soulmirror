/**
 * 可选插件的依赖体检与安装。
 *
 * 原则（用户明确要求）：**没装对应的插件，就不启动对应功能**，
 * 而不是启动了然后静默失败——那样用户只会看到"桌宠没反应""纪要不要写库"
 * 这种没有线索的现象。
 *
 * 安装方式复用 DSH 自己的命令：`dsh plugin --profile <p> add <pkg>`。
 * 不自己调 pnpm，也不改 profile 的 package.json——那是插件的活。
 */

import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

/** 我们依赖的可选插件能力 */
export const OPTIONAL_DEPS = [
  {
    key: 'pet',
    pkg: 'dsh-pet',
    name: '桌面宠物',
    // 装了它才有动画形象、气泡、右键菜单
    why: '桌宠形象与气泡、右键入口',
  },
  {
    key: 'knowledge',
    pkg: 'dsh-knowledge',
    name: '知识库',
    why: '会后纪要写回知识库',
  },
]

/** 在某个 profile 的 node_modules 里找包 */
export function packageInstalled(profileDir, pkg) {
  const base = String(profileDir || '').trim()
  if (!base || !pkg) return false
  return existsSync(join(base, 'node_modules', String(pkg), 'package.json'))
}

/**
 * 体检：每个可选依赖装没装。
 * @param {{ profileDir: string, extra?: Array<{key:string,pkg:string,name:string,why:string}> }} input
 */
export function checkOptionalDeps({ profileDir, extra = [] } = {}) {
  const list = [...OPTIONAL_DEPS, ...extra]
  return list.map((d) => ({
    key: d.key,
    pkg: d.pkg,
    name: d.name,
    why: d.why,
    installed: packageInstalled(profileDir, d.pkg),
  }))
}

/** 这些功能是否允许启动（没装就不启动） */
export function featureAllowed(key, deps) {
  const hit = (deps || []).find((d) => d.key === key)
  return !!(hit && hit.installed)
}

/**
 * 用 DSH 自己的命令安装一个插件。
 *
 * 为什么用 spawn 而不是 HTTP：安装是本地进程操作，DSH 没暴露成服务。
 * 命令固定为 `dsh plugin --profile <p> add <pkg>`，参数不拼接 shell 字符串，
 * 避免注入；超时 180 秒（npm 拉包的正常上限）。
 *
 * @param {{ pkg: string, profile: string, dshBin?: string, timeoutMs?: number }} input
 * @returns {Promise<{ ok: boolean, output: string, error: string }>}
 */
export function installPlugin({ pkg, profile, dshBin = 'dsh', timeoutMs = 180000 } = {}) {
  const name = String(pkg || '').trim()
  const prof = String(profile || '').trim()
  if (!/^[@a-z0-9][a-z0-9._@/-]*$/i.test(name)) {
    return Promise.resolve({ ok: false, output: '', error: '包名不合法：' + name })
  }
  if (!/^[a-z0-9._-]+$/i.test(prof)) {
    return Promise.resolve({ ok: false, output: '', error: 'profile 名不合法：' + prof })
  }
  return new Promise((resolve) => {
    const args = ['plugin', '--profile', prof, 'add', name]
    let out = ''
    let err = ''
    let settled = false
    const done = (r) => {
      if (settled) return
      settled = true
      resolve(r)
    }
    let child
    try {
      child = execFile(dshBin, args, { timeout: timeoutMs, windowsHide: true }, (e) => {
        if (e) done({ ok: false, output: out.trim(), error: (err || e.message).trim().slice(0, 800) })
        else done({ ok: true, output: out.trim(), error: '' })
      })
    } catch (e) {
      done({ ok: false, output: '', error: e.message })
      return
    }
    child.stdout?.on('data', (d) => { out += String(d) })
    child.stderr?.on('data', (d) => { err += String(d) })
    child.on('error', (e) => done({ ok: false, output: out.trim(), error: e.message }))
  })
}

/** 面向界面的一句话说明：为什么这个功能没启动 */
export function featureGateMessage(key, deps) {
  const hit = (deps || []).find((d) => d.key === key)
  if (!hit) return { allowed: true, message: '' }
  if (hit.installed) return { allowed: true, message: '' }
  return {
    allowed: false,
    message: hit.name + '未安装，' + hit.why + '暂不可用（可在「依赖」里一键安装 ' + hit.pkg + '）',
  }
}
