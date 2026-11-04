/**
 * 桌面宠物的"心情"映射：把 /status 翻译成一个表情 + 一句人话。
 *
 * 分开写的原因：这是唯一需要推理的部分（优先看整理、再看发言、再看采集），
 * 纯函数便于测试；C# 窗口只负责画和点，不掺业务判断。
 */

/** 五种形态：一眼能看出助手现在在干什么 */
export const PET_FACES = {
  idle: { face: 'idle', label: '待命中', color: '#8b95a5' },
  listening: { face: 'listening', label: '在听会议', color: '#2f7cf6' },
  thinking: { face: 'thinking', label: '在思考', color: '#a855f7' },
  speaking: { face: 'speaking', label: '正在说话', color: '#16a34a' },
  sweeping: { face: 'sweeping', label: '会后整理中', color: '#f59e0b' },
  error: { face: 'error', label: '出问题了', color: '#dc2626' },
}

const ACTIVE_MS = 20000

function ts(value) {
  // 两种时间格式都要认：ISO 字符串（后端记录）和毫秒数字（replyState.at）
  if (typeof value === 'number' && Number.isFinite(value)) return value
  const raw = String(value == null ? '' : value)
  if (/^\d{10,}$/.test(raw)) return Number(raw)
  const t = Date.parse(raw)
  return Number.isFinite(t) ? t : 0
}

/**
 * @param {object} status /api/soulmirror/status 的返回
 * @param {{ now?: number }} opts
 * @returns {{ key: string, face: string, label: string, color: string, text: string, hint: string }}
 */
export function petStateFromStatus(status, { now = Date.now() } = {}) {
  const s = status || {}
  const base = (key, text, hint = '') => ({
    key,
    face: PET_FACES[key].face,
    label: PET_FACES[key].label,
    color: PET_FACES[key].color,
    text: text || '',
    hint,
  })

  // 1) 会后整理优先：这是明确的长任务，用户最关心它跑到哪了
  const pm = s.postMeeting || {}
  if (pm.phase && pm.phase !== 'idle') {
    // 出错时把原因直接显示出来，别只写「失败了」
    if (pm.phase === 'error') return base('error', pm.error || '整理失败', '')
    if (pm.phase === 'done') {
      const bits = []
      if (pm.sentences) bits.push(pm.sentences + ' 句')
      if (pm.speakers) bits.push(pm.speakers + ' 位说话人')
      return base('idle', '整理完成' + (bits.length ? '：' + bits.join(' · ') : ''), pm.minutesPath || '')
    }
    const stage = pm.phase === 'stopping' ? '收尾中' : pm.phase === 'offline' ? '重转写中' : '生成纪要中'
    return base('sweeping', stage, '')
  }

  // 2) 刚说过话（20 秒内）→ 说话中
  const spokeAt = Math.max(ts(s.lastSpeakInfo && s.lastSpeakInfo.at), ts((s.replyState || {}).at))
  const speaking = s.replyState && s.replyState.spoken && now - spokeAt < ACTIVE_MS
  if (speaking) return base('speaking', String(s.replyState.spoken).slice(0, 24), '')

  // 3) 建议/候选正在生成 → 思考中
  const busyAt = Math.max(ts((s.replyState || {}).at), ts((s.adviceState || {}).at))
  if ((s.replyState && s.replyState.candidates && s.replyState.candidates.length === 0 && s.replyState.error === '')
    && busyAt && now - busyAt < 5000) {
    return base('thinking', '在想怎么回', '')
  }

  // 4) 出错
  const err = s.lastSpeakError || s.lastLlmError
  if (err && err.message) return base('error', String(err.message).slice(0, 24), '')
  if (s.postMeeting && s.postMeeting.error) return base('error', String(s.postMeeting.error).slice(0, 24), '')

  // 5) 采集中的会议 / 待命
  const sess = s.session || {}
  if (sess.capturing) {
    const n = Number(sess.lines || 0)
    const meeting = (s.meeting && (s.meeting.title || s.meeting.app)) || ''
    return base('listening', '在听' + (n ? ' · ' + n + ' 句' : ''), meeting)
  }

  const mode = s.reply && s.reply.enabled ? 'Agent 已开' : '只转录'
  return base('idle', mode, '')
}

/** 菜单里显示的开关状态（C# 侧只负责渲染，不判断业务） */
export function petMenuFromStatus(status) {
  const s = status || {}
  const reply = s.reply || {}
  const advice = s.advice || {}
  return {
    capturing: !!(s.session && s.session.capturing),
    replyEnabled: !!reply.enabled,
    adviceEnabled: advice.enabled !== false,
    autoSpeak: reply.autoSpeak !== false,
  }
}
