/**
 * 问题清单：把"现在到底哪里不对"汇总成可读、可复制的条目。
 *
 * 为什么需要：
 *   之前所有失败信息散落在各处——session.lastError、asr.failed、keyErrors、
 *   postMeeting.error、lastModelProbe……用户要挨个看，别人（远程）根本没法排查。
 *
 * 设计：
 *   · 统一成 {id, level, title, detail, fix, at} 五段式
 *   · level: error（现在就不能用）/ warn（能用但有风险）/ info（只是提示）
 *   · 按级别排序，最多显示前几条，界面上"第一条就是最该处理的"
 *   · 纯函数，输入全部由调用方注入，便于单测
 */

const LEVEL_RANK = { error: 0, warn: 1, info: 2 }

/** 单条问题 */
export function issue(id, level, title, { detail = '', fix = '', at = '' } = {}) {
  return {
    id: String(id),
    level: LEVEL_RANK[level] === undefined ? 'info' : level,
    title: String(title || ''),
    detail: String(detail || ''),
    fix: String(fix || ''),
    at: String(at || ''),
  }
}

/**
 * 汇总当前问题。
 *
 * @param {{
 *   preflight?: {ok?: boolean, verdict?: string, blocked?: {label?: string, detail?: string, fix?: string}},
 *   capturing?: boolean,
 *   transcriptLines?: number,
 *   lastLineAgeSec?: number | null,
 *   asr?: {online?: boolean, failed?: boolean, error?: string},
 *   keyErrors?: {asr?: string, tts?: string},
 *   postMeeting?: {phase?: string, error?: string, percent?: number, stageLabel?: string},
 *   lastModelProbe?: {ok?: boolean, at?: string, error?: string},
 *   captureDevice?: string,
 *   silentSec?: number,
 * }} s
 * @returns {Array<{id, level, title, detail, fix, at}>}
 */
export function collectIssues(s = {}) {
  const out = []

  // ① 采集链路硬故障（来自 preflight 的致命项）
  const pf = s.preflight
  if (pf && pf.ok === false) {
    const b = pf.blocked || {}
    out.push(issue('preflight', 'error', '采集中断：' + (b.label || '环境检查未通过'), {
      detail: b.detail || pf.verdict || '',
      fix: b.fix || '运行 /api/soulmirror/preflight 查看完整清单',
    }))
  } else if (pf && pf.verdict && pf.ok === true && /但/.test(pf.verdict)) {
    // 链路可用的提醒（比如"当前没在会议"）只在 info 级别
    out.push(issue('preflight-info', 'info', pf.verdict, {}))
  }

  // ② 采集进程自身的错误
  if (s.captureError) {
    out.push(issue('capture', 'error', '采集出错', {
      detail: String(s.captureError).slice(0, 200),
      fix: '看设备是否被占用、会议是否在播声音；必要时重开「启用」',
    }))
  }

  // ③ 在采集但长时间没有转写 —— 最典型的"看起来在跑，其实没内容"
  if (s.capturing && (s.transcriptLines || 0) === 0 && (s.lastLineAgeSec == null || s.lastLineAgeSec > 60)) {
    out.push(issue('no-transcript', 'error', '采集了但没有转写内容', {
      detail: '已录 ' + (s.lastLineAgeSec == null ? '一段时间' : Math.round(s.lastLineAgeSec) + ' 秒') + '，一句都没有',
      fix: '多半是采错端点/设备静音/密钥或网络问题 → 跑一次体检定位',
    }))
  }

  // ④ ASR 断线
  const asr = s.asr || {}
  if (asr.failed) {
    out.push(issue('asr', 'error', '语音识别断线', {
      detail: String(asr.error || '').slice(0, 200),
      fix: '检查密钥与网络；会自动重连，但这段音频可能没识别',
    }))
  } else if (s.capturing && asr.online === false) {
    out.push(issue('asr-offline', 'warn', '语音识别未连接', {
      detail: '正在采集，但识别通道没连上',
      fix: '稍等自动重连；持续不连就看密钥/网络',
    }))
  }

  // ⑤ 密钥读取失败（我特意改成了不静默）
  const ke = s.keyErrors || {}
  for (const slot of Object.keys(ke)) {
    if (!ke[slot]) continue
    out.push(issue('key-' + slot, 'error', '密钥读取失败（' + slot + '）', {
      detail: String(ke[slot]).slice(0, 200),
      fix: '检查 DSH 凭据存储的读写权限，或在设置里重新填一次',
    }))
  }

  // ⑥ 会后整理卡住/失败
  const pm = s.postMeeting || {}
  if (pm.phase === 'error') {
    out.push(issue('post-meeting', 'error', '会后整理失败', {
      detail: String(pm.error || '').slice(0, 200),
      fix: '数据仍在本地，可在「会后整理」里点「用录音重新整理」',
    }))
  }

  // ⑦ 静音过久（设备没声音，但采集正常）
  if (s.capturing && (s.silentSec || 0) >= 20) {
    out.push(issue('silent', 'warn', '当前设备长时间没有声音', {
      detail: '已静音 ' + Math.round(s.silentSec || 0) + ' 秒' + (s.captureDevice ? '（设备：' + s.captureDevice + '）' : ''),
      fix: '确认会议声音确实从这个设备出；可能需要改采集设备',
    }))
  }

  return out.sort((a, b) => (LEVEL_RANK[a.level] - LEVEL_RANK[b.level]))
}

/** 取最该处理的一条（界面横幅用） */
export function topIssue(issues = []) {
  const list = Array.isArray(issues) ? issues : []
  return list.find((x) => x.level === 'error') || list.find((x) => x.level === 'warn') || list[0] || null
}

/**
 * 渲染成一段可直接粘给别人的排查文本（含环境）。
 * @param {Array} issues
 * @param {object} [extra] 版本、平台、会议目录等
 */
export function describeIssues(issues = [], extra = {}) {
  const list = Array.isArray(issues) ? issues : []
  const head = Object.keys(extra).filter((k) => extra[k]).map((k) => k + ': ' + extra[k]).join(' · ')
  if (!list.length) return '当前没有检测到问题' + (head ? '\n' + head : '')
  const lines = [head, ''].filter(Boolean)
  list.forEach((it, i) => {
    lines.push((i + 1) + '. [' + it.level + '] ' + it.title)
    if (it.detail) lines.push('   - ' + it.detail)
    if (it.fix) lines.push('   → ' + it.fix)
  })
  return lines.join('\n')
}
