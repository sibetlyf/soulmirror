/**
 * 把会议纪要交给 **DSH 后台任务**（独立 dsh 进程）去写。
 *
 * 为什么不该在主会话里写纪要（实测事故）：
 *   1. 主会话的补全器被"逐句判定/候选词/润色"共用，有闸门（maxPending=2、同内容合并、120s 超时）。
 *      纪要是一次性长输入长输出，正好被合并/超时 → 静默退化成"原文节选"。
 *   2. 纪要是重活（读整场转写 + 写长文），压在会议会话里会拖慢其它判断。
 *   3. 用户明确要求：**结束后的整理交给 dsh 的后台任务**。
 *
 * 做法：把转写写进文件，起一个 headless 进程读文件、写纪要文件，主进程只等结果。
 * 不走命令行传长文本（Windows 命令行有 32KB 上限），也不依赖主会话是否空闲。
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** 转写与纪要的落盘文件名 */
export const TASK_FILES = {
  transcript: 'minutes-source.txt',
  output: 'minutes-by-dsh.md',
}

/**
 * 生成给后台任务的指令。
 *
 * 关键约束（都是踩过的坑）：
 *   · 只允许写指定输出文件，避免它在会议目录里制造别的文件
 *   · 要求"只输出纪要正文"，否则回复里会带解释性废话
 *   · 明确"不要编造"，没有的条目写"无"
 *
 * @param {{transcriptPath: string, outputPath: string, title?: string, maxSentences?: number}} o
 */
export function buildMinutesTaskPrompt({ transcriptPath, outputPath, title = '', maxSentences = 600 } = {}) {
  return [
    '你在补写一场已经结束的会议纪要。这是机械任务，不要提问、不要解释、不要征求确认。',
    '',
    '步骤：',
    '1. 读取转写文件：' + transcriptPath,
    '2. 按下面的结构写出纪要，写到文件：' + outputPath,
    '3. 除了这个文件，不要创建或修改任何其它文件。',
    '',
    '纪要结构（Markdown，没有内容的小节写"无"）：',
    '## 一句话结论',
    '## 决议',
    '## 待办（负责人 · 时间）',
    '## 风险与阻塞',
    '## 未决问题',
    '',
    '要求：',
    '· 只依据转写文件内容，不要编造人名、时间、结论',
    '· 转写可能有识别错误与重复句：按语义归并，不要照抄',
    '· 待办要落到"谁 · 做什么 · 什么时候"，转写里没说的写"未指定"',
    '· 总长控制在 1200 字以内',
    '· 最多读取前 ' + Math.max(50, Number(maxSentences) || 600) + ' 句，超出部分按放弃处理',
    title ? '· 会议标题：' + title : '',
  ].filter(Boolean).join('\n')
}

/**
 * 把句子写成后台任务的输入文件。
 * @param {{dir: string, lines: string[]}} o
 * @returns {{path: string, sentences: number, chars: number}}
 */
export function writeMinutesSource({ dir, lines = [] }) {
  const list = (Array.isArray(lines) ? lines : [])
    .map((x) => String(x || '').trim())
    .filter(Boolean)
  const path = join(dir, TASK_FILES.transcript)
  writeFileSync(path, list.join('\n'), 'utf8')
  return { path, sentences: list.length, chars: list.join('\n').length }
}

/**
 * 读后台任务写的纪要，并做最小校验。
 *
 * 不接受"空文件"和"只有标题没有内容"——那等于没写。
 * @param {{dir: string, minChars?: number}} o
 * @returns {{ok: boolean, markdown: string, error?: string}}
 */
export function readMinutesResult({ dir, minChars = 80 } = {}) {
  const path = join(dir, TASK_FILES.output)
  if (!existsSync(path)) return { ok: false, markdown: '', error: '后台任务没有产出纪要文件' }
  let text = ''
  try { text = readFileSync(path, 'utf8').replace(/^\uFEFF/, '').trim() } catch (e) {
    return { ok: false, markdown: '', error: '读不到纪要文件：' + e.message }
  }
  if (!text) return { ok: false, markdown: '', error: '后台任务写出了空纪要' }
  if (text.length < minChars) {
    return { ok: false, markdown: text, error: '纪要过短（' + text.length + ' 字），可能没写成' }
  }
  // 去掉可能的外层代码围栏
  const fenced = /^```(?:markdown|md)?\s*\n([\s\S]*?)\n```\s*$/.exec(text)
  return { ok: true, markdown: (fenced ? fenced[1] : text).trim() }
}

/** 清掉上一次的产物，避免把旧纪要当成本次结果 */
export function resetMinutesOutput(dir) {
  const path = join(dir, TASK_FILES.output)
  try { if (existsSync(path)) writeFileSync(path, '', 'utf8') } catch { /* ignore */ }
}

/**
 * 判断这次要不要走后台任务。
 * @param {{minutesViaDsh?: boolean, dshBin?: boolean}} o
 */
export function shouldUseBackgroundTask({ minutesViaDsh = true, dshBin = true } = {}) {
  return minutesViaDsh !== false && dshBin !== false
}
