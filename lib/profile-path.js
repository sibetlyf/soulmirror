/**
 * 从插件自身的位置反推 profile 目录。
 *
 * 为什么不能只读环境变量：实测宿主进程里 `DSH_PROFILE` / `DSH_PROFILE_DIR`
 * 都是空的（它们在工具子进程里才有），于是 `node_modules` 一律拼不出来，
 * 已经装好的 dsh-pet / dsh-knowledge 全被判成"未安装"——门禁就把功能误杀了。
 *
 * 插件自己的路径永远是真的：
 *   <profile>/plugins/soulmirror/index.js  →  <profile>
 * 这条线索不受启动环境如何影响。
 */

/** 把 file URL 或普通路径切成段（同时兼容 Windows 反斜杠） */
export function pathSegments(input) {
  let p = String(input || '')
  if (p.startsWith('file://')) {
    p = p.slice('file://'.length)
    // Windows: file:///C:/a/b → /C:/a/b
    p = p.replace(/^\/(?=[A-Za-z]:)/, '')
  }
  try { p = decodeURIComponent(p) } catch { /* 保留原样 */ }
  return p.split(/[\\/]+/).filter(Boolean)
}

/**
 * 由插件自身路径推出 profile 目录。
 * @param {{ selfUrl?: string, exists?: (p: string) => boolean, join?: (...p: string[]) => string }} input
 * @returns {string} profile 目录；推不出来返回空串
 */
export function profileDirFromPluginPath({ selfUrl, exists = () => true, join } = {}) {
  const segs = pathSegments(selfUrl)
  if (!segs.length) return ''
  const i = segs.lastIndexOf('profiles')
  if (i < 0 || !segs[i + 1]) return ''
  const parts = segs.slice(0, i + 2)
  const isWin = /^[A-Za-z]:$/.test(segs[0])
  // 盘符本来就含在 parts[0] 里，不能再额外拼一个 'C:\' 前缀，否则会变成 C:\C:\...
  const dir = join ? join(...parts) : (isWin ? parts.join('\\') : '/' + parts.join('/'))
  const clean = dir.replace(/([\\/])\1+/g, '$1')
  return exists(clean) ? clean : ''
}

/**
 * 依次尝试多个线索，返回第一个真实存在的 profile 目录。
 * @param {{
 *   selfUrl?: string,
 *   env?: Record<string, string|undefined>,
 *   homeDir?: string,
 *   exists?: (p: string) => boolean,
 *   join?: (...p: string[]) => string,
 * }} input
 */
export function resolveProfileDir({ selfUrl, env = {}, homeDir = '', exists = () => true, join } = {}) {
  const mk = (parts) => {
    const p = join ? join(...parts) : parts.join('\\')
    return p.replace(/([\\/])\1+/g, '$1')
  }
  const candidates = []

  // ① 环境变量给的全路径（最直接）
  if (env.DSH_PROFILE_DIR) candidates.push(String(env.DSH_PROFILE_DIR))
  // ② 插件自身路径反推（最可靠）
  const derived = profileDirFromPluginPath({ selfUrl, exists, join })
  if (derived) candidates.push(derived)
  // ③ home + profiles + 名字
  if (homeDir && env.DSH_PROFILE) candidates.push(mk([homeDir, '.dsh', 'profiles', String(env.DSH_PROFILE)]))

  for (const c of candidates) {
    if (c && exists(c)) return c
  }
  return ''
}

/**
 * DSH 的安装根（即 profiles 的父目录）。
 *
 * 为什么不能只用 homedir()：
 *   真实部署里 DSH 不一定装在用户主目录下——例如 C:\dsh\instanceA\profiles。
 *   写死 homedir()/.dsh 就会去别处找 profile，于是"知识库明明装了却判定没装"。
 *
 * 优先级（从最可信到兜底）：
 *   ① 当前 profile 目录（DSH_PROFILE_DIR）的父目录 —— 最具体
 *   ② DSH_HOME 环境变量（DSH 自己会设）
 *   ③ 插件自身路径反推：<dshHome>/profiles/<name>/plugins/<pkg>/index.js
 *   ④ homedir()/.dsh（传统默认，最后兜底）
 */
export function resolveDshHome({ selfUrl, env = {}, homeDir = '', exists = () => true, join } = {}) {
  const mk = (parts) => {
    const p = join ? join(...parts) : parts.join('\\')
    return p.replace(/([\\/])\1+/g, '$1')
  }
  const candidates = []

  // ① 当前 profile 目录最可信：它明确指向"我现在运行在哪个实例里"，
  //    即使环境里还留着别的 DSH_HOME，也不该覆盖它。
  if (env.DSH_PROFILE_DIR) {
    const segs = pathSegments(env.DSH_PROFILE_DIR)
    if (segs.length >= 2) {
      const trimmed = segs.slice(0, -2) // 去掉 profiles/<name>
      candidates.push(mk(trimmed))
    }
  }

  // ② DSH 自己设的根目录
  if (env.DSH_HOME) candidates.push(String(env.DSH_HOME))

  // 从插件自身路径反推：找 'profiles' 前面的部分
  const segs = pathSegments(selfUrl)
  const at = segs.lastIndexOf('profiles')
  if (at > 0) candidates.push(mk(segs.slice(0, at)))

  if (homeDir) candidates.push(mk([homeDir, '.dsh']))

  for (const c of candidates) {
    if (c && exists(c)) return c
  }
  return candidates[candidates.length - 1] || ''
}

/**
 * profiles 根目录（DSH_HOME/profiles）。
 * 与 resolveDshHome 同一套优先级，只是多拼一层。
 */
export function resolveProfilesRoot(opts = {}) {
  const home = resolveDshHome(opts)
  if (!home) return ''
  const join = opts.join
  const p = join ? join(home, 'profiles') : home + '\\profiles'
  return p.replace(/([\\/])\1+/g, '$1')
}
