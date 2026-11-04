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

/**
 * 找知识库（dsh-knowledge）的工作目录。
 *
 * 为什么要对齐：会议会话里让 agent 去查资料时，它的 cwd 决定了它能看见什么。
 * 知识库的文档/制品都在它自己的目录下（例如 G:\dsh-knowledge），
 * 而插件的默认工作区是 ~/.dsh/soulmirror/workspace —— 那边什么都没有。
 *
 * 判定依据是"有没有 documents/artifacts 子目录 + 最近有写入"，
 * 不写死盘符：换机器、换盘都能自己找。
 *
 * @param {string[]} candidates 候选目录（按优先级）
 * @param {{ existsSync?: Function, statSync?: Function, join?: Function }} deps 便于测试
 * @returns {string} 找到的目录，找不到返回空串
 */
export function detectKnowledgeCwd(candidates = [], deps = {}) {
  const exists = deps.existsSync
  const stat = deps.statSync
  const joinFn = deps.join
  if (!exists || !joinFn) return ''

  let best = ''
  let bestTime = -1
  for (const dir of candidates) {
    const d = String(dir || '').trim()
    if (!d) continue
    const docs = joinFn(d, 'documents')
    const arts = joinFn(d, 'artifacts')
    if (!exists(docs) && !exists(arts)) continue
    let newest = 0
    for (const probe of [docs, arts]) {
      try {
        if (!exists(probe)) continue
        const st = stat(probe)
        if (st && st.mtimeMs > newest) newest = st.mtimeMs
      } catch { /* ignore */ }
    }
    if (newest > bestTime) { bestTime = newest; best = d }
  }
  return best
}
