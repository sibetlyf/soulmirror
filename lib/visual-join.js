/**
 * lib/visual-join.js —— 程序路径失败后，让 computer-use 看屏幕把会入进去。
 *
 * 为什么需要：入会按钮在各版本/各机器上位置不同，写死坐标或"附近乱试"都不可靠
 * （v1.5.7 已彻底去掉盲点）。插件自己不能调用 computer-use 的工具——那是另一个插件的工具，
 * 只有会话里的 agent 能调用。宿主有现成的"派一个子会话并把提示词交给它"的通道
 * （index.js 的 runCalibrationSession），这里只负责把任务描述清楚、行为约束写死。
 *
 * 约束（必须写进提示词，否则 agent 会四处乱点）：
 *   · 只允许做与"入会"有关的操作：打开客户端、点「加入会议」、填会议号、点「加入」、确认进入
 *   · 每一轮先截图，再按截图里看到的位置点；不许猜坐标
 *   · 不点无关按钮，不改设置，不发消息
 *   · 结束后必须给一行明确结论（进入/未进入 + 看到的界面文字）
 */

/** 组提示词。只放事实与约束，不放具体坐标。 */
export function buildVisualJoinPrompt({ app = '腾讯会议', code = '', link = '', winHint = '' } = {}) {
  const lines = []
  lines.push('【任务：用 computer-use 帮我把会议入进去（只做这一件事）】')
  lines.push('')
  lines.push('目标客户端：' + app)
  if (code) lines.push('会议号：' + code)
  if (link) lines.push('入会链接（如果能直接打开就优先用它）：' + link)
  if (winHint) lines.push('窗口提示：' + winHint)
  lines.push('')
  lines.push('必须遵守：')
  lines.push('1. 每一步都先 `computer screenshot` 看屏幕，**按截图里真实看到的控位置点**，不许凭经验猜坐标；')
  lines.push('2. 只做与入会相关的动作：打开客户端 → 点「加入会议」→ 输入会议号 → 点「加入」；')
  lines.push('   **不要点**无关按钮，不要改设置，不要发消息，不要关别人的窗口；')
  lines.push('3. 如果客户端没启动：用 `open_application` 打开「腾讯会议」，不要用命令行启动；')
  lines.push('4. 如果「加入会议」对话框已经开着，直接在里面填号，不要再点首页；')
  lines.push('5. 如果出现权限/初始化异常弹窗（例如「程序初始化异常」），先把该弹窗关掉，再重启客户端；')
  lines.push('6. 全程最多 8 次点击；点完没反应就停下来报告，不要继续乱点；')
  lines.push('7. 结束时只回三行：`RESULT: joined|failed`、`DETAIL: <一句说明>`、`EVIDENCE: <最后看到的窗口文字/标题>`。')
  lines.push('')
  lines.push('注意：这是真实会议客户端，会真的进入会议；进不去也没关系，如实报告即可。')
  return lines.join('\n')
  }

/** 从子会话输出里判断是否入会成功 */
export function visualJoined(text = '') {
  const s = String(text || '')
  if (/RESULT:\s*joined/i.test(s)) return true
  // 兜底：明确出现"已进入会议""已入会"也算
  if (/已进入会议|已入会|已成功加入会议/.test(s) && !/未进入|failed/i.test(s)) return true
  return false
}

/** 从子会话输出里抽取一句结论（给工具返回值用） */
export function visualVerdict(text = '') {
  const s = String(text || '').replace(/\r/g, '')
  const detail = /DETAIL:\s*(.+)/.exec(s)
  const evidence = /EVIDENCE:\s*(.+)/.exec(s)
  const parts = []
  if (detail) parts.push(detail[1].trim())
  if (evidence) parts.push('界面：' + evidence[1].trim())
  return parts.join('｜') || s.trim().slice(0, 200) || '（子会话没有返回内容）'
}
