/**
 * 增量升级：只替换变了的文件，永不碰用户数据。
 *
 * 场景：插件以 `link:` 方式装在
 *   <profile>/plugins/soulmirror
 * 里，升级不该"卸载重装"——那样既慢，又容易让人以为要重新配置。
 *
 * 做法：
 *   1. 仓库里放一份 manifest.json（路径 → sha256），由 scripts/gen-manifest.mjs 生成
 *   2. 升级时先取远端 manifest，与本地文件逐个比对
 *   3. 只下载 sha256 不一致的文件；本地没有的新增；其余跳过
 *   4. 只写插件目录，绝不触碰 ~/.dsh/soulmirror（配置、会议记录、凭据都在那里）
 *
 * 全部 IO 由调用方注入，便于测试。
 */

import { createHash } from 'node:crypto'

export const UPGRADE_REPO = 'sibetlyf/soulmirror'
export const UPGRADE_BRANCH = 'main'

/** 升级时要同步的路径（相对插件根目录） */
export function isRuntimePath(p) {
  const s = String(p || '').replace(/\\/g, '/')
  if (!s || s.startsWith('/') || s.includes('..')) return false
  if (s === 'index.js' || s === 'package.json' || s === 'manifest.json' || s === 'README.md') return true
  if (s.startsWith('lib/')) return true
  // tools/ 只同步真正运行需要的：桥接 exe、UIAutomation 脚本、编译产物
  if (s === 'tools/mbridge.exe' || s === 'tools/meeting-bridge.cs') return true
  if (s === 'tools/ui.ps1' || s === 'tools/mic.ps1' || s === 'tools/hold.ps1') return true
  return false
}

/** 解析 manifest.json → Map<path, sha256> */
export function parseManifest(json) {
  const out = new Map()
  let obj = json
  if (typeof json === 'string') {
    try { obj = JSON.parse(json) } catch { return out }
  }
  const files = (obj && obj.files) || []
  for (const f of files) {
    if (!f || !f.path || !f.sha256) continue
    if (!isRuntimePath(f.path)) continue
    out.set(String(f.path), String(f.sha256))
  }
  return out
}

/**
 * 生成升级计划。
 * @param {Map<string,string>} local  本地 path → sha256
 * @param {Map<string,string>} remote 远端 path → sha256
 * @returns {{added: string[], changed: string[], same: string[], removed: string[]}}
 */
export function planUpgrade(local, remote) {
  const l = local instanceof Map ? local : new Map()
  const r = remote instanceof Map ? remote : new Map()
  const added = []
  const changed = []
  const same = []
  const removed = []
  for (const [path, sha] of r) {
    if (!l.has(path)) added.push(path)
    else if (l.get(path) !== sha) changed.push(path)
    else same.push(path)
  }
  // 远端已不再提供的运行时文件：列出来但不自动删（避免误删用户改动过的东西）
  for (const path of l.keys()) {
    if (!r.has(path)) removed.push(path)
  }
  return {
    added: added.sort(),
    changed: changed.sort(),
    same: same.sort(),
    removed: removed.sort(),
    // 需要下载的总数
    total: added.length + changed.length,
  }
}

/**
 * 执行升级：只拉变化文件并写入。
 * @param {{
 *   dir: string,
 *   plan: ReturnType<typeof planUpgrade>,
 *   readFileBuf: (abs: string) => Promise<Buffer> | Buffer,
 *   writeFileBuf: (abs: string, buf: Buffer) => Promise<void> | void,
 *   fetchText: (path: string) => Promise<string>,
 *   joinPath: (dir: string, rel: string) => string,
 *   logger?: { info?: Function, warn?: Function },
 * }} io
 */
export async function applyUpgrade(io) {
  const { dir, plan, readFileBuf, writeFileBuf, fetchBuf, joinPath, logger } = io
  const written = []
  const failed = []

  const targets = [...plan.added, ...plan.changed]
  for (const rel of targets) {
    try {
      // 必须是二进制：tools/mbridge.exe 是 exe，按 utf8 写会直接损坏
      const buf = await fetchBuf(rel)
      if (!buf || !buf.length) throw new Error('远端为空')
      const abs = joinPath(dir, rel)
      await writeFileBuf(abs, buf)
      written.push(rel)
      logger?.info?.('[soulmirror] 已更新 ' + rel)
    } catch (e) {
      failed.push(rel + '：' + (e && e.message ? e.message : String(e)))
      logger?.warn?.('[soulmirror] 更新失败 ' + rel + '：' + (e && e.message ? e.message : ''))
    }
  }

  // 校验：写完后本地 sha 是否等于远端（防止半截写入）
  const mismatched = []
  const expectMap = io.expect instanceof Map ? io.expect : null
  if (expectMap) {
    for (const rel of written) {
      try {
        const buf = await readFileBuf(joinPath(dir, rel))
        const got = sha256Hex(buf)
        const want = expectMap.get(rel)
        if (want && got !== want) mismatched.push(rel)
      } catch {
        mismatched.push(rel + '（读回失败）')
      }
    }
  }

  return { written, failed, mismatched }
}

/** 简易 sha256（hex），只在 Node 环境用 */
export function sha256Hex(buf) {
  return createHash('sha256').update(buf).digest('hex')
}

/** 升级后的说明文案（明确告诉用户"不用重装、配置没动"） */
export function describeUpgrade(result, { version } = {}) {
  const lines = []
  if (result.written && result.written.length) {
    lines.push('已增量更新 ' + result.written.length + ' 个文件：' + result.written.slice(0, 8).join('、') +
      (result.written.length > 8 ? ' 等' : ''))
  } else {
    lines.push('已是最新（没有文件需要更新）')
  }
  if (version) lines.push('当前版本：' + version)
  if (result.failed && result.failed.length) lines.push('失败 ' + result.failed.length + ' 个：' + result.failed.join('；'))
  lines.push('配置与会议记录未改动（都在 ~/.dsh/soulmirror，升级只替换插件文件）')
  lines.push('重启 DSH 后生效（插件宿主代码只在启动时加载）')
  return lines.join('\n')
}
