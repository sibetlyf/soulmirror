/**
 * 决定"会议会话应该在哪个目录里工作"。
 *
 * 之前固定用插件的私有目录（~/.dsh/soulmirror/workspace/<会议key>），
 * 结果会议里的 agent 看不到用户的任何项目文件，只会说"当前目录只有两个文件"。
 *
 * 现在的优先级：
 *   1. 用户显式配置 twin.workspaceCwd（最可控）
 *   2. 当前活动会话的 cwd（开箱即用，权限与用户当前会话一致）
 *   3. 插件私有目录（兜底，保证永远有地方写）
 */

/** 不应被当作"用户工作区"的路径（插件自己的数据目录） */
export function looksLikePluginData(dir) {
  const s = String(dir || '').replace(/\\/g, '/').toLowerCase()
  return s.includes('/.dsh/soulmirror') || s.endsWith('/.dsh/soulmirror')
}

/**
 * @param {{ configured?: string, active?: string, fallback?: string }} input
 * @returns {{ cwd: string, source: 'configured'|'active-session'|'fallback'|'none' }}
 */
export function pickWorkspaceCwd({ configured = '', active = '', fallback = '' } = {}) {
  const cfg = String(configured || '').trim()
  if (cfg) return { cwd: cfg, source: 'configured' }

  const act = String(active || '').trim()
  if (act && !looksLikePluginData(act)) return { cwd: act, source: 'active-session' }

  const fb = String(fallback || '').trim()
  if (fb) return { cwd: fb, source: 'fallback' }

  return { cwd: '', source: 'none' }
}
