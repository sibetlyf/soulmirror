/**
 * 回收"没整理完"的会议。
 *
 * 场景：进程被强杀 / 用户直接关了窗口 —— 账本（transcript.jsonl）在，
 * 但没有 minutes.md。数据其实没丢，只是没人整理。
 *
 * 设计约束（性能优先，因为它会在 /status 轮询里出现）：
 *   - **只 stat，不读文件**：扫描阶段不碰 transcript 内容
 *   - 目录数有上限（默认 200），避免历史很多时拖慢
 *   - 结果由调用方缓存，本模块保持纯函数、无状态
 */

const DEFAULT_STALE_MS = 10 * 60 * 1000

/**
 * @param {{
 *   root: string,
 *   now?: number,
 *   staleMs?: number,
 *   maxDirs?: number,
 *   readdir: (p: string) => string[],
 *   exists: (p: string) => boolean,
 *   stat: (p: string) => { size: number, mtimeMs: number } | null,
 *   join: (...a: string[]) => string,
 * }} o
 * @returns {{ dir: string, name: string, bytes: number, mtimeMs: number, ageMin: number }[]}
 */
export function scanPendingRecovery({
  root,
  now = Date.now(),
  staleMs = DEFAULT_STALE_MS,
  maxDirs = 200,
  readdir,
  exists,
  stat,
  join,
}) {
  if (!root) return []
  let names = []
  try { names = readdir(root) || [] } catch { return [] }

  const out = []
  // 只看前 maxDirs 个（readdir 一般是字典序，配合下面按时间排序够用）
  for (const name of names.slice(0, maxDirs)) {
    if (!name || name === 'workspace') continue
    const dir = join(root, name)
    try {
      const logPath = join(dir, 'transcript.jsonl')
      if (!exists(logPath)) continue

      // 已经有纪要 → 整理过了
      if (exists(join(dir, 'minutes.md'))) continue
      // 会后重转写产出的纪要也算整理过
      if (exists(join(dir, 'minutes-offline.md'))) continue

      const st = stat(logPath)
      if (!st) continue
      // 太新 → 可能正在开，别慌着提示
      if (now - st.mtimeMs < staleMs) continue
      // 空账本（没收到任何句子）没整理价值
      if (st.size < 2) continue

      out.push({
        dir,
        name,
        bytes: st.size,
        mtimeMs: st.mtimeMs,
        ageMin: Math.max(0, Math.round((now - st.mtimeMs) / 60000)),
      })
    } catch { /* 单个目录出错不影响整体 */ }
  }

  // 最近的排前面
  return out.sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, 20)
}

/**
 * 判断某个会议目录是否"未整理"（供 /recover 的 POST 复核用，防止误触发）。
 */
export function isPendingRecovery({ dir, exists, stat, join, now = Date.now(), staleMs = DEFAULT_STALE_MS }) {
  if (!dir) return false
  try {
    const logPath = join(dir, 'transcript.jsonl')
    if (!exists(logPath)) return false
    if (exists(join(dir, 'minutes.md'))) return false
    if (exists(join(dir, 'minutes-offline.md'))) return false
    const st = stat(logPath)
    if (!st || st.size < 2) return false
    return now - st.mtimeMs >= staleMs
  } catch {
    return false
  }
}
