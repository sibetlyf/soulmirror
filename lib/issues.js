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

/** 同级内的处理顺序：数字越小越先看 */
const ID_PRIORITY = {
  'host-stale': -1,  // 跑的是旧代码时，别的结论都不可信
  key: 0,          // 密钥缺失/读取失败：先解决它，否则一切白搭
  preflight: 1,    // 平台/桥接/端点/网络
  'no-transcript': 2,
  asr: 3,          // 识别断线
  capture: 4,      // 采集进程报错
  'post-meeting': 5,
  silent: 6,
  'asr-offline': 7,
  'preflight-info': 9,
}

function priorityOf(id) {
  const s = String(id || '')
  if (s.startsWith('key')) return ID_PRIORITY.key
  return ID_PRIORITY[s] === undefined ? 8 : ID_PRIORITY[s]
}

/**
 * 采集错误 → 该做什么。
 *
 * 以前所有采集错误都配同一句"常见是设备静音、端点选错、桥接被杀软拦"，
 * 于是"缺少密钥"也被配上了设备建议 —— 用户照着查设备，白费时间。
 */
export function fixForCaptureError(text) {
  const s = String(text || '')
  if (/DASHSCOPE|密钥|apiKey|api key|未配置.*key|unauthor|401/i.test(s)) {
    return '在「设置 → 会议助手」填自己的百炼 Key（或设环境变量 DASHSCOPE_API_KEY），然后点「开始录音」'
  }
  if (/mbridge|桥接|spawn|ENOENT/i.test(s)) {
    return '音频桥接不可用：重装插件或运行 soul_setup { action: "build" } 重新编译'
  }
  if (/设备|device|端点|endpoint|占用|busy|静音|silent/i.test(s)) {
    return '确认会议声音从当前采集设备出（常见是设备静音、端点选错、被别的程序独占）'
  }
  return '跑一次「一键体检」定位（平台 / 桥接 / 端点 / 密钥 / 网络）'
}

/** 这条错误是不是只是"密钥问题"的重复表述 */
function looksLikeKeyProblem(text) {
  return /密钥|apikey|api key|unauthor|401|缺少.*key/i.test(String(text || ''))
}


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

  // ⓪ 宿主还在跑旧代码：所有"改了没生效"的根源，必须最先报
  if (s.host && s.host.stale) {
    out.push(issue('host-stale', 'error', '宿主在跑旧代码，改动没生效', {
      detail: 'index.js 比正在运行的进程新（代码 ' + (s.host.codeMtime || '') + ' / 进程 ' + (s.host.bootedAt || '') + '）',
      fix: '重启 DSH（不是刷新页面）——插件宿主代码只在启动时加载',
    }))
  }

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
  // 但如果这条错误只是"缺少密钥"的表征，而上面/后面已有专门的密钥条目，
  // 就别重复——否则用户先看到"上次采集错误"，抓不到真正要做的动作。
  const keyIssuePresent = !!(s.keyErrors && Object.keys(s.keyErrors).some((k) => s.keyErrors[k]))
    || (pf && pf.ok === false && pf.blocked && /密钥/.test(String(pf.blocked.label || '')))
  if (s.captureError && !(keyIssuePresent && looksLikeKeyProblem(s.captureError))) {
    out.push(issue('capture', 'error', '采集出错', {
      detail: String(s.captureError).slice(0, 200),
      fix: fixForCaptureError(s.captureError),
    }))
  }

  // ③ 在采集但长时间没有转写 —— 最典型的"看起来在跑，其实没内容"
  if (s.capturing && (s.transcriptLines || 0) === 0 && (s.lastLineAgeSec == null || s.lastLineAgeSec > 60)) {
    out.push(issue('no-transcript', 'error', '采集了但没有转写内容', {
      detail: '已录 ' + (s.lastLineAgeSec == null ? '一段时间' : Math.round(s.lastLineAgeSec) + ' 秒') + '，一句都没有',
      fix: '跑一次「一键体检」：会分别告诉你缺 Key、端点不对、还是网络不通',
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

  // 排序：先按级别，再按"该先处理谁"。
  // 密钥必须在最前：别人装上后最常见的就是没填 Key，
  // 之前它排在"上次采集错误"后面，用户先看到一堆表征，抓不住要点。
  return out.sort((a, b) => {
    const byLevel = LEVEL_RANK[a.level] - LEVEL_RANK[b.level]
    if (byLevel !== 0) return byLevel
    return priorityOf(a.id) - priorityOf(b.id)
  })
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
