/**
 * 画像回填：用历史会议账本补出人格画像。
 *
 * 为什么需要：
 *   人格管线只在"会后整理"时生长。刚装上新版本时画像是空的，
 *   而机器上往往已经躺着几十场会议的账本——那些都是原料，
 *   却要再开几十场会才能把画像喂起来，这不合理。
 *
 * 设计要点：
 *   1. **只读账本**，不碰音频、不重转写（便宜、快、不占内存）
 *   2. 每场会只喂一段**裁剪过的文本**（首尾各若干句），控制 token
 *   3. 选择逻辑是纯函数，可测：跳过已整理过的、太短的、太旧的
 *   4. 明确返回"要花几次模型调用"，让用户知道自己点了什么
 */

/** 默认参数 */
export const BACKFILL_DEFAULTS = {
  limit: 5,           // 最多回填几场
  maxAgeDays: 120,    // 太旧的不算（人已经变了）
  minLines: 4,        // 少于这么多句没有信息量
  headLines: 24,      // 每场取开头多少句
  tailLines: 24,      // 每场取结尾多少句
  maxCharsPerMeeting: 3000,
}

/**
 * 从会议目录里挑选可以回填的场次（纯函数，只依赖传入的探测能力）。
 *
 * @param {{
 *   dirs: string[],
 *   now?: number,
 *   stat: (dir: string) => ({ mtimeMs: number, size: number } | null),
 *   readTailLines?: (dir: string, n: number) => number,
 *   options?: object,
 * }} o
 * @returns {{ picked: Array<{dir: string, mtimeMs: number}>, skipped: Array<{dir: string, why: string}> }}
 */
export function pickBackfillMeetings({ dirs = [], now = Date.now(), stat, options = {} } = {}) {
  const opt = { ...BACKFILL_DEFAULTS, ...options }
  const picked = []
  const skipped = []
  for (const dir of dirs) {
    const st = stat ? stat(dir) : null
    if (!st) { skipped.push({ dir, why: '读不到账本' }); continue }
    if (st.size < 200) { skipped.push({ dir, why: '账本太小（' + st.size + ' 字节）' }); continue }
    const ageDays = (now - st.mtimeMs) / 86400000
    if (ageDays > opt.maxAgeDays) { skipped.push({ dir, why: '超过 ' + opt.maxAgeDays + ' 天' }); continue }
    picked.push({ dir, mtimeMs: st.mtimeMs })
  }
  picked.sort((a, b) => b.mtimeMs - a.mtimeMs)   // 最近的优先
  const keep = picked.slice(0, opt.limit)
  for (const rest of picked.slice(opt.limit)) skipped.push({ dir: rest.dir, why: '超出本次上限 ' + opt.limit })
  return { picked: keep, skipped }
}

/**
 * 把一段账本文本裁成"喂给模型的样子"：开头 + 结尾，中间省略。
 * 会议里真正定调的话常在开头（背景/目标）与结尾（结论/待办）。
 *
 * @param {string[]} lines 已回放折叠的句子文本
 * @param {object} [options]
 * @returns {{text: string, used: number, omitted: number}}
 */
export function slimMeetingText(lines = [], options = {}) {
  const opt = { ...BACKFILL_DEFAULTS, ...options }
  const arr = (Array.isArray(lines) ? lines : []).map((x) => String(x || '').trim()).filter(Boolean)
  if (arr.length <= opt.headLines + opt.tailLines) {
    const text = arr.join('\n').slice(0, opt.maxCharsPerMeeting)
    return { text, used: arr.length, omitted: 0 }
  }
  const head = arr.slice(0, opt.headLines)
  const tail = arr.slice(-opt.tailLines)
  const omitted = arr.length - head.length - tail.length
  const text = (head.join('\n') + '\n…（中间省略 ' + omitted + ' 句）…\n' + tail.join('\n'))
    .slice(0, opt.maxCharsPerMeeting)
  return { text, used: head.length + tail.length, omitted }
}

/**
 * 回填用的提取提示词（与会后一致，但强调"这是在补历史"）。
 * @returns {Array<{role: string, content: string}>}
 */
export function buildBackfillPrompt({ meetingText = '', knownText = '', title = '' } = {}) {
  const sys = [
    '你在帮一个会议助理"长成用户本人"。下面是**一场历史会议**的记录。',
    '请只抽取**关于用户本人**的稳定信息，输出 JSON：',
    '{"items":[{"section":"stance","key":"上线节奏","value":"先小范围验证再全量","confidence":0.7}]}',
    '',
    'section 只能是：identity / style / stance / facts / state',
    '- identity：职位、团队、负责的项目',
    '- style：语气、句长、口头禅、忌讳的说法',
    '- stance：优先级、判断标准、红线',
    '- facts：稳定事实（习惯、工具、协作对象）',
    '- state：那段时间的进展（会过期，谨慎给）',
    '',
    '规则：',
    '1. key 用 2~8 个字概括主题，以后用来判重/取代，请稳定',
    '2. value 一句话、不超过 40 字、必须是**她本人**的事（不是会议内容摘要）',
    '3. confidence 0~1：明确表达给高分，推测给低分',
    '4. 历史会议的信息可能已过时：不确定的宁可不写；state 要谨慎',
    '5. 已经有的事实不要重复列举',
  ].join('\n')

  const msgs = [{ role: 'system', content: sys }]
  if (knownText) msgs.push({ role: 'user', content: '已知画像（避免重复）：\n' + knownText })
  msgs.push({ role: 'user', content: (title ? '会议：' + title + '\n\n' : '') + meetingText })
  return msgs
}

/** 汇总一次回填的战果（给用户看的一句话） */
export function summarizeBackfill(stats = {}) {
  const parts = []
  if (stats.meetings) parts.push('读了 ' + stats.meetings + ' 场会')
  if (stats.added != null) parts.push('新增 ' + stats.added + ' 条')
  if (stats.reinforced != null) parts.push('强化 ' + stats.reinforced + ' 条')
  if (stats.superseded != null) parts.push('取代 ' + stats.superseded + ' 条')
  if (stats.failed) parts.push('失败 ' + stats.failed + ' 场')
  if (stats.convergence) parts.push('相似程度 ' + Math.round(stats.convergence.score * 100) + '%（' + stats.convergence.label + '）')
  return parts.join('，') || '没有可回填的会议'
}
