/**
 * 纪要落盘：唯一入口，防覆盖、防清空、可回溯。
 *
 * 以前的坑：4 处代码各自 writeFile 同一个 minutes.md，谁最后写谁赢。
 * 结果一次"最近 80 句摘要"就把 5KB 的完整纪要覆盖成 0.1KB 的寒暄。
 *
 * 规则：
 *   1. 原子写（临时文件 + rename），不会留下半截文件
 *   2. 变短保护：新内容明显短于旧内容时，不覆盖，另存为带时间戳的版本
 *   3. 历史保留：每次覆盖前把旧内容存一份 minutes-<时间>.md
 */
import { promises as fsp } from 'node:fs'
import { dirname, basename, join } from 'node:path'

/** 简单的中文安全文件名片段 */
function stamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

/**
 * 判断这次写入是否"明显缩水"。
 * @param {string} oldText 旧内容
 * @param {string} newText 新内容
 * @param {{ minRatio?: number, minBytes?: number }} opts
 * @returns {boolean} true = 应拒绝覆盖
 */
export function isShrinking(oldText, newText, { minRatio = 0.5, minBytes = 400 } = {}) {
  const oldLen = Buffer.byteLength(String(oldText || ''), 'utf8')
  const newLen = Buffer.byteLength(String(newText || ''), 'utf8')
  if (oldLen < minBytes) return false // 旧内容本来就小，怎么写都行
  if (newLen === 0) return true // 空内容绝不覆盖
  return newLen < oldLen * minRatio
}

/**
 * 原子写 + 变短保护 + 历史版本。
 * @returns {Promise<{ path: string, written: boolean, reason?: string, archived?: string }>}
 */
export async function saveMinutes(file, content, { allowShrink = false, keepHistory = true } = {}) {
  const text = String(content ?? '')
  if (!text.trim()) return { path: file, written: false, reason: '内容为空，拒绝写入' }

  let oldText = ''
  try { oldText = await fsp.readFile(file, 'utf8') } catch { /* 不存在 */ }

  let archived = ''
  if (keepHistory && oldText.trim()) {
    archived = join(dirname(file), basename(file, '.md') + '-' + stamp() + '.md')
    try { await fsp.writeFile(archived, oldText, 'utf8') } catch { archived = '' }
  }

  if (!allowShrink && isShrinking(oldText, text)) {
    const alt = join(dirname(file), basename(file, '.md') + '-short-' + stamp() + '.md')
    await fsp.writeFile(alt, text, 'utf8')
    return {
      path: alt,
      written: true,
      reason: '新内容明显短于已有纪要，已另存为 ' + basename(alt) + '，原文件保留',
      archived,
    }
  }

  const tmp = file + '.tmp-' + process.pid + '-' + Date.now()
  await fsp.writeFile(tmp, text, 'utf8')
  await fsp.rename(tmp, file)
  return { path: file, written: true, archived }
}
