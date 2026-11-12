/**
 * 纪要的唯一格式与清洗。
 *
 * 用户的原话（据此固定结构，不再由模型自由发挥）：
 *   一、写明时间、地点、与会人员
 *   二、会议主题：XXXX会
 *   三、会议内容
 *       1、围绕主题说了什么，问题是什么
 *       2、进度或者解决办法
 *       3、领导有什么指示
 *       4、总结和检讨，总结经验／未来即将做的事情
 *   四、谁写的纪要、以及时间
 *
 * 另外两条硬要求（都是现场反馈）：
 *   · 纪要里不要出现英文——识别出来的英文句子要翻成中文表达，
 *     只有产品名/代码名这类确有必要才保留，并紧跟中文说明。
 *   · 不要出现"说话人1／说话人2"这种标签：读起来像草稿，不像纪要。
 *     无法确认姓名时，用"与会人员""主持人""领导"这类角色词，或直接"无"。
 */

/** 固定结构（同时用于提示词与校验） */
export const MINUTES_SECTIONS = Object.freeze([
  { key: 'basic', heading: '一、会议基本信息', hint: '时间、地点、与会人员；转写里没有的写"未提及"' },
  { key: 'topic', heading: '二、会议主题', hint: '会议主题，写成"XXXX会"' },
  { key: 'content', heading: '三、会议内容', hint: '围绕主题的讨论、进度、指示与总结' },
  { key: 'author', heading: '四、纪要人', hint: '谁写的纪要、写的时间' },
])

/** 三、会议内容下的四个小标题（编号用中文习惯） */
export const CONTENT_SECTIONS = Object.freeze([
  '1、围绕主题说了什么，问题是什么',
  '2、进度或者解决办法',
  '3、领导有什么指示',
  '4、总结和检讨（经验与接下来要做的事）',
])

/**
 * 有历史纪要时追加的"连续性要求"。
 * 只在拿到历史块（或非空历史数组）时追加；没有历史时提示词逐字节保持不变，
 * 免得新用户看到"要和上次衔接"这类无从执行的约束。
 */
const CONTINUITY_RULES = Object.freeze([
  '连续性要求（这次给了你之前的会议纪要摘要，必须按下面的方式用）：',
  '1. **衔接上次**：摘要里上次的待办/决议，这次要写明"做了／没做／变了"，放进"三、会议内容 → 2、进度或者解决办法"。',
  '2. **不重复问**：历史纪要里已经定过的事，不要当成新议题重新讨论式描述，直接写当前进展或口径变化。',
  '3. **任务落到人 · 时间**：下一步任务写成"谁 · 做什么 · 何时"；优先引用历史纪要里已经明确的角色、称呼、项目名，历史里没有的名字不要自己编。',
  '4. **冲突要指出**：历史信息与本次转写冲突时必须明确指出（例如上次说周三交付、这次说周五），并写清哪个是最新口径；不要默默采用新的。',
  '5. **只引用给定摘要**：摘要里没有的决定、数据、人名一律不写；本次转写里没提到的事，不能写成已完成。',
  '6. 四段式结构、语言与长度要求不变，历史摘要不要整段照抄进纪要。',
])

/** 是否有可用的历史输入（数组或已拼好的块）；空数组/空串都算"没有历史" */
function hasHistoryInput(history) {
  if (!history) return false
  if (Array.isArray(history)) return history.length > 0
  return String(history).trim().length > 0
}

/**
 * 给模型的系统提示：结构 + 语言 + 不编造。
 * 传入 history（历史数组或 historyBlock 文本）时，额外追加"连续性要求"。
 */
export function buildMinutesSystemPrompt({ history } = {}) {
  const base = [
    '你是中文会议纪要撰写者。只输出纪要正文（Markdown），不要解释、不要提问、不要输出代码围栏。',
    '',
    '必须严格按下面结构输出，标题文字照抄，内容没有就写"未提及"，不要删小节：',
    '',
    '# 会议纪要',
    '',
    '## 一、会议基本信息',
    '- 时间：',
    '- 地点：',
    '- 与会人员：',
    '',
    '## 二、会议主题',
    '（写成"XXXX会"的形式）',
    '',
    '## 三、会议内容',
    '### ' + CONTENT_SECTIONS[0],
    '### ' + CONTENT_SECTIONS[1],
    '### ' + CONTENT_SECTIONS[2],
    '### ' + CONTENT_SECTIONS[3],
    '',
    '## 四、纪要人',
    '- 整理：',
    '- 时间：',
    '',
    '硬性要求：',
    '1. **全篇用简体中文**。转写里的英文句子要翻成中文再写；只有产品名、代码名、专有名词可以保留，并紧跟中文说明。禁止整句英文。',
    '2. **不要出现"说话人1""说话人2""Speaker 1"这类标签**。无法确认姓名时用角色词（主持人／领导／与会人员）或直接省略。',
    '3. 只依据给定转写，不编造人名、时间、地点、数字、结论；转写里没有的信息写"未提及"。',
    '4. 转写有识别错误与重复句：按语义归并，不要照抄原句，不要罗列流水账。',
    '5. 三、会议内容要写"讨论了什么、问题是什么、进度如何、怎么解决、领导指示、经验与下一步"，不要只堆要点。',
    '6. 全文控制在 1200 字以内。',
  ].join('\n')
  return hasHistoryInput(history) ? [base, '', ...CONTINUITY_RULES].join('\n') : base
}

/**
 * 组装用户消息：先给会议已知信息（时间/地点/参与方），再给历史纪要摘要，最后给转写。
 * 已知信息能减少模型瞎填"时间/地点"；历史摘要放在转写**之前**，
 * 让模型先建立"上次到哪了"的参照，再读这次的转写。
 *
 * @param {{transcript: string, meta?: {title?: string, startedAt?: string, endedAt?: string,
 *   place?: string, attendees?: string[], author?: string, now?: string}, historyBlock?: string}} o
 */
export function buildMinutesUserPrompt({ transcript = '', meta = {}, historyBlock = '' } = {}) {
  const lines = []
  const known = []
  if (meta.title) known.push('- 会议标题：' + meta.title)
  if (meta.startedAt) known.push('- 开始时间：' + meta.startedAt)
  if (meta.endedAt) known.push('- 结束时间：' + meta.endedAt)
  if (meta.place) known.push('- 地点（本机采集）：' + meta.place)
  if (meta.attendees && meta.attendees.length) known.push('- 可能与会者：' + meta.attendees.join('、'))
  if (meta.author) known.push('- 纪要整理者：' + meta.author)
  if (known.length) {
    lines.push('已知会议信息（可直接使用；没写的不要编）：', ...known, '')
  }
  const history = String(historyBlock || '').trim()
  if (history) {
    lines.push(
      '以下是之前的会议纪要摘要，只用于衔接进度与判断冲突；它不是本次会议的转写，',
      '转写里没提到的事不要写成已完成，摘要里也没有的决定不要补。',
      '',
      history,
      '',
    )
  }
  lines.push('会议转写（每行前面的"说话人N"只是识别分轨标记，不要写进纪要）：', '')
  lines.push(String(transcript || '').trim())
  return lines.join('\n')
}

/** 行首/列表项里的说话人标签："说话人1："、"[说话人2]"、"Speaker 3:" */
const SPEAKER_LABEL = /^(\s*(?:[-*+]\s+|\d+[.、]\s+)?)(?:\[?)?(?:说话人|说话者|发言人|Speaker)\s*\d+(?:\])?\s*(?:[：:、.．-]\s*|\s+)/i

/**
 * 后处理：去掉说话人标签、压掉多余空行。
 *
 * 提示词已经要求模型不写标签，但模型不保证听话——这里做最后一道，
 * 而且**只删标签、不改内容**，避免把模型的意思改掉。
 */
export function normalizeMinutes(markdown = '') {
  let text = String(markdown || '').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n')
  // 去掉可能的外层代码围栏
  const fence = /^```(?:markdown|md)?\s*\n([\s\S]*?)\n```\s*$/.exec(text.trim())
  if (fence) text = fence[1]
  const out = []
  for (const raw of text.split('\n')) {
    let line = raw
    // 反复剥：有的模型会写成"说话人1：说话人2：内容"
    for (let i = 0; i < 3; i++) {
      const next = line.replace(SPEAKER_LABEL, '$1')
      if (next === line) break
      line = next
    }
    // 只剩标签的行直接丢掉（"说话人1："）
    if (/^\s*(?:[-*+]\s+)?(?:\[?)?(?:说话人|说话者|发言人|Speaker)\s*\d+(?:\])?\s*[：:]?\s*$/i.test(line)) continue
    out.push(line.replace(/\s+$/, ''))
  }
  // 三个以上连续空行压成两个（Markdown 空段落）
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

/** 时间按本机时区写成"2026-11-11 10:46" */
export function localStamp(value, { now = Date.now } = {}) {
  // 可能是毫秒数，也可能是 ISO 字符串：数字必须直接当时间戳用
  const t = typeof value === 'number' ? value : (value ? Date.parse(value) : NaN)
  const d = new Date(Number.isFinite(t) ? t : now())
  const p = (n) => String(n).padStart(2, '0')
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes())
}

/**
 * 收集能确定的会议信息（不猜）：
 * 时间取 meta.startedAt/endedAt；地点只写"本机采集"这个事实；与会人员只在配置里有名字时给出。
 */
export function minutesMeta({ meta = {}, cfg = {}, dir = '', now = Date.now } = {}) {
  const start = meta.startedAt || meta.startedAtMs || ''
  const end = meta.endedAt || ''
  const author = String(cfg.userName || '').trim()
  const attendees = []
  if (author) attendees.push(author)
  return {
    title: String(meta.title || '').trim(),
    startedAt: start ? localStamp(start, { now }) : '',
    endedAt: end ? localStamp(end, { now }) : '',
    place: '本机桌面音频采集（线上会议）',
    attendees,
    author: author || 'SoulMirror（自动整理）',
    dir,
  }
}

/**
 * 把"四、纪要人"补成真实值。
 * 模型没写、或写了占位符时补上；已写就不动（不覆盖模型的内容）。
 */
export function finalizeMinutes(markdown = '', { author = '', at = '' } = {}) {
  let text = normalizeMinutes(markdown)
  if (!text) return text
  const authorLine = '- 整理：' + (author || 'SoulMirror（自动整理）')
  const timeLine = '- 时间：' + (at || localStamp(''))
  const hasAuthor = /整理[:：]\s*\S/.test(text)
  const hasTime = /##\s*四、/.test(text)
  if (!hasTime) {
    text += '\n\n## 四、纪要人\n' + authorLine + '\n' + timeLine
    return text
  }
  text = text.replace(/(- 整理[:：])\s*(?=\n|$)/, '$1' + (author || 'SoulMirror（自动整理）'))
  text = text.replace(/(- 时间[:：])\s*(?=\n|$)/, '$1' + (at || localStamp('')))
  if (!hasAuthor) text = text.replace(/(##\s*四、[^\n]*\n)/, '$1' + authorLine + '\n')
  return text
}
