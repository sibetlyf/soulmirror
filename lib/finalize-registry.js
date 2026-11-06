/**
 * 会后整理的**按会议隔离**注册表。
 *
 * 原来用的是两个全局变量：
 *   finalizing       全局互斥
 *   lastFinalizedAt  全局 60 秒去抖
 *
 * 三个真实问题：
 *   1. A 会刚整理，B 会很快结束（<60s）→ B 被当成重复，直接跳过，用户没有 B 的纪要
 *   2. 整理过程中反复读可变的 session.dir —— 期间若开了新会议，B 的内容会被写进 A 的目录
 *   3. 没有幂等键，同一场会多次触发只能靠时间去猜
 *
 * 现在：以**会议目录 + 转写修订号**为键。
 *   · 不同会议：互不影响，各整理各的
 *   · 同一会议同一修订：去抖窗口内只做一次
 *   · 同一会议但转写又长了：允许再整理（内容是新的）
 */

/**
 * @param {{debounceMs?: number, now?: () => number}} [opts]
 */
export function createFinalizeRegistry({ debounceMs = 60000, now = Date.now } = {}) {
  /** dir → 正在整理的 token */
  const busy = new Map()
  /** `${dir}#${revision}` → 完成时间 */
  const done = new Map()
  let seq = 0

  const keyOf = (dir, revision) => String(dir || '') + '#' + String(revision ?? '')

  return {
    /**
     * 尝试开始一次整理。
     * @param {string} dir 会议目录（不可变快照）
     * @param {number|string} revision 转写修订号（句数或字节数）
     * @returns {{ok: true, token: object} | {ok: false, reason: string}}
     */
    tryBegin(dir, revision) {
      if (!dir) return { ok: false, reason: '没有会议目录，跳过整理' }
      if (busy.has(dir)) return { ok: false, reason: '这场会正在整理中' }

      const key = keyOf(dir, revision)
      const at = done.get(key)
      if (at != null && now() - at < debounceMs) {
        return { ok: false, reason: '同一场会的同一份转写刚整理过' }
      }

      const token = { id: ++seq, dir, revision, key, at: now() }
      busy.set(dir, token)
      return { ok: true, token }
    },

    /** 结束一次整理（成功、失败、超时都要调） */
    end(token) {
      if (!token) return
      if (busy.get(token.dir) === token) busy.delete(token.dir)
      done.set(token.key, now())
      // 只保留最近 200 个键，避免长时间运行无限增长
      if (done.size > 200) {
        const first = done.keys().next().value
        done.delete(first)
      }
    },

    /** 某场会是否正在整理 */
    isBusy(dir) {
      return busy.has(String(dir || ''))
    },

    /** 诊断用：谁在忙、最近整理过哪些 */
    snapshot() {
      return {
        busy: Array.from(busy.values()).map((t) => ({ dir: t.dir, revision: t.revision, at: t.at })),
        recent: Array.from(done.entries()).slice(-10).map(([k, at]) => ({ key: k, at })),
      }
    },

    reset() {
      busy.clear()
      done.clear()
    },
  }
}

/**
 * 会议身份快照：一旦开始整理，后续所有写入都用它，
 * 不再读可变的 session.dir（否则新会议会串场把内容写到旧目录）。
 *
 * @param {{dir?: string, startedAt?: number, display?: string, transcript?: Array}} session
 * @returns {{dir: string, startedAt: number, revision: string, title: string}}
 */
export function snapshotRun(session = {}) {
  const dir = String(session.dir || '')
  const startedAt = Number(session.startedAt) || Date.now()
  const lines = Array.isArray(session.transcript) ? session.transcript.length : 0
  const bytes = Number(session.bytes) || 0
  return {
    dir,
    startedAt,
    revision: lines + ':' + bytes,
    title: String(session.display || session.title || '').slice(0, 60),
  }
}
