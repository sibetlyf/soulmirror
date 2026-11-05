/**
 * 转写账本的回放层。
 *
 * 账本是"只增不改"的（对齐 DSH 的会话日志）：每来一句追加一行；
 * 合并与升级不覆盖旧行，而是**追加一行并标注 replaces 指向旧行的 t**。
 *
 * 于是"读回来"必须做两件事，否则账本只是半成品：
 *   1. 按 replaces 把被替换的旧行折叠掉（否则会同时看到截断版和完整版）
 *   2. 容忍最后一行写坏（进程被强杀时可能只写了半行 JSON）
 *
 * 这一层不依赖任何运行时状态，纯函数，便于测试。
 */

/**
 * 逐行解析 JSONL。
 * - 跳过空行
 * - 跳过**解析失败的行**（典型场景：强杀时最后一行不完整）
 * @returns {{ records: object[], badLines: number }}
 */
export function parseLog(text) {
  const records = []
  let badLines = 0
  for (const raw of String(text || '').split('\n')) {
    const line = raw.trim()
    if (!line) continue
    try {
      const obj = JSON.parse(line)
      if (obj && typeof obj === 'object') records.push(obj)
      else badLines += 1
    } catch {
      badLines += 1
    }
  }
  return { records, badLines }
}

/**
 * 折叠账本，得到"当前有效"的句子序列。
 *
 * 规则：
 *   - 普通行：追加
 *   - 带 replaces 的行：用它的内容**替换**被指向的那一句（保留原位置与原始 t），
 *     而不是当成新的一句追加
 *   - 指向的目标不存在（目标行在更早的文件里/被损坏）：按普通追加处理，不丢内容
 *
 * @param {object[]} records parseLog 的结果
 * @returns {{ lines: object[], replaced: number, orphanReplaces: number }}
 */
export function replayLog(records = []) {
  const lines = []
  const byT = new Map()   // 原始 t → lines 下标
  let replaced = 0
  let orphanReplaces = 0

  for (const rec of records) {
    if (!rec) continue
    const target = rec.replaces

    if (target && byT.has(target)) {
      const idx = byT.get(target)
      const prev = lines[idx]
      // 保留原始时间与位置（它是"同一句"），只更新文本与元信息
      lines[idx] = { ...prev, ...rec, t: prev.t, replaces: undefined }
      if (lines[idx].replaces === undefined) delete lines[idx].replaces
      replaced += 1
      continue
    }

    if (target) orphanReplaces += 1   // 目标找不到：当新句子收下，别丢内容
    const copy = { ...rec }
    if (copy.replaces !== undefined) delete copy.replaces
    lines.push(copy)
    if (rec.t) byT.set(rec.t, lines.length - 1)
  }

  return { lines, replaced, orphanReplaces }
}

/** 一步到位：文本 → 有效句子 */
export function readLogText(text) {
  const { records, badLines } = parseLog(text)
  const r = replayLog(records)
  return { ...r, records: records.length, badLines }
}

/**
 * 给人看的纯文本（纪要/回看用）。
 * 断点（gap）会保留成一行标记，方便知道"这里断过"。
 * @param {object[]} lines replayLog().lines
 */
export function linesToText(lines = []) {
  return lines
    .map((x) => {
      const speaker = x.speaker ? x.speaker + '：' : ''
      const text = String(x.text || '').trim()
      if (!text) return ''
      return speaker + text
    })
    .filter(Boolean)
    .join('\n')
}
