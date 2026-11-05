/**
 * 入会的输入校验与失败分类。
 *
 * 为什么单独拆出来：入会是**最容易让用户等 90 秒还没有结果**的路径——
 * 会议号输错、客户端不在首页、弹窗没弹出来，都会走到一串 UI 探测里。
 * 这里把"能在事前判断的"和"拿到客户端提示后能翻译的"做成纯函数，
 * 宿主里只负责在关键步骤之间查超时。
 */

/** 会议号归一化：去掉空格、横线、中文括号等 */
export function normalizeMeetingCode(code) {
  return String(code == null ? '' : code).replace(/[\s\-—–_、,，.。()（）]/g, '')
}

/**
 * 校验会议号。
 * 腾讯会议是 9~11 位数字（也接受带横线的 123-456-789 写法）；
 * 移动会议常见 6~9 位。这里放宽到 6~11 位纯数字。
 * @returns {{ ok: boolean, code: string, error: string }}
 */
export function validateMeetingCode(code) {
  const raw = String(code == null ? '' : code).trim()
  if (!raw) return { ok: false, code: '', error: '缺少会议号' }
  const digits = normalizeMeetingCode(raw)
  if (!/^\d{6,11}$/.test(digits)) {
    return {
      ok: false,
      code: digits,
      error: '会议号格式不对：「' + raw + '」应为 6~11 位数字（可以带横线，如 123-456-789）',
    }
  }
  if (/^0+$/.test(digits)) {
    return { ok: false, code: digits, error: '会议号不能全是 0：「' + raw + '」' }
  }
  return { ok: true, code: digits, error: '' }
}

/** 入会过程中各步骤的字面提示 → 给用户看的一句话 */
const FAILURE_HINTS = [
  [/会议已结束|已经结束/, '这个会议已经结束了'],
  [/会议不存在|不存在该会议|无效的会议/, '会议号不存在（检查一下是不是输错了）'],
  [/密码|入会密码/, '这个会议需要入会密码'],
  [/等候|主持人已同意|等待主持人/, '已在等候室，等主持人放行'],
  [/网络|连接失败/, '网络问题导致入会失败'],
  [/版本|升级/, '会议客户端版本过低，需要升级'],
]

/**
 * 把客户端界面上的提示或我们自己的步骤日志翻译成人话。
 * @param {string} text
 * @param {{ timedOut?: boolean }} opts
 */
export function classifyJoinFailure(text, { timedOut = false } = {}) {
  if (timedOut) return '入会超时：没有在限定时间内进入会议（可能是会议号不对，或客户端停在别的界面）'
  const t = String(text || '')
  for (const [re, human] of FAILURE_HINTS) {
    if (re.test(t)) return human
  }
  if (/找不到入会对话框|打不开入会对话框|没能打开入会对话框/.test(t)) {
    return '找不到入会对话框：确认会议客户端停在首页（未在会中），或跑一次 meeting_calibrate 标定「加入会议」的位置'
  }
  if (/没找到会议号输入框/.test(t)) return '弹窗里没找到会议号输入框：可能是客户端版本改版，需要重新标定'
  if (/点了加入但没进会/.test(t)) return '点了「加入会议」但没进去：会议号可能无效，或客户端弹了别的提示'
  return ''
}

/**
 * 生成带分类的失败结果。
 * @param {string} stepsText 已经做过的步骤
 * @param {{ timedOut?: boolean }} opts
 */
export function joinFailureResult(stepsText, opts = {}) {
  const reason = classifyJoinFailure(stepsText, opts)
  const body = String(stepsText || '').trim()
  return reason ? reason + (body ? '\n\n已尝试：\n' + body : '') : body
}
