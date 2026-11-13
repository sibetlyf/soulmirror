/** Single server-owned presentation model. UI surfaces render this; they never fold events. */
export const DEFAULT_DISPLAY = Object.freeze({ width: 420, density: 'comfortable', activityLimit: 30, showActivity: true, showDiagnostics: true, autoOpen: true })
const LABELS = Object.freeze({ offline: '整段转写', identify: '认出说话人', minutes: '生成纪要', knowledge: '写入知识库', persona: '更新画像' })
const STATE_LABELS = Object.freeze({ pending: '等待', running: '进行中', done: '完成', skipped: '已跳过', error: '失败' })
const textError = (v) => typeof v === 'string' ? v : v && (v.message || v.error) || ''
export function normalizeDisplay(value = {}) {
  return { ...DEFAULT_DISPLAY, ...value, width: Math.max(340, Math.min(640, Number(value.width) || DEFAULT_DISPLAY.width)), activityLimit: Math.max(5, Math.min(100, Number(value.activityLimit) || DEFAULT_DISPLAY.activityLimit)) }
}
/**
 * 这场会实际录了多久（秒）。
 *
 * 只认已落盘的事实：录音文件头里的时长（同一场会时最准），或 run 的开始/结束时间。
 * 「现在 - 开始时间」是墙钟，会议结束后还会继续涨（真实值 8103 秒 vs 录音 998 秒），
 * 不能当成录音时长展示。
 */
function recordedSec(run, recording) {
  if (!run) return null
  const seconds = Number(recording && recording.seconds)
  if (recording && recording.dir === run.run && Number.isFinite(seconds) && seconds > 0) return Math.round(seconds)
  const from = Date.parse(run.startedAt || '')
  const to = Date.parse(run.stoppedAt || '')
  if (Number.isFinite(from) && Number.isFinite(to) && to > from) return Math.round((to - from) / 1000)
  return null
}

/**
 * 没配置好时，主操作应该是「去配置」而不是「开始录音」。
 *
 * 只认能证明"真的录不了"的证据：桥接不可用、密钥读取失败、体检有致命项。
 * 不能只看 config.keys.asr === false：环境变量里的 Key 由宿主解析，这份缓存可能是旧的
 * （本机实测 keys.asr=false 但体检 asr-key 通过），拿它当依据会把人误判成没配置。
 */
function isConfigured(runtime) {
  if (runtime.bridge && runtime.bridge.ok === false) return false
  const keyErrors = runtime.config && runtime.config.keyErrors
  if (keyErrors && typeof keyErrors === 'object' && Object.keys(keyErrors).some((k) => keyErrors[k])) return false
  const checks = runtime.lastPreflight && runtime.lastPreflight.checks
  if (Array.isArray(checks) && checks.some((c) => c && c.fatal && !c.ok)) return false
  return true
}

/**
 * @param {{journal?:object,runtime?:object,display?:object}} input
 * runtime accepts the existing /status payload: enabled, auto, session, host, models,
 * issues, lastLlmError, lastSpeakError, pipelineQueue, meeting. Journal is project(events).
 * Only journal-derived fields drive durable capture/pipeline state. Runtime supplies
 * live diagnostics, not invented completion percentages or optimistic command state.
 */
export function buildViewModel({ journal = {}, runtime = {}, display = {} } = {}) {
  const cfg = normalizeDisplay(display)
  const runs = Object.values(journal.runs || {}).sort((a, b) => (b.lastSeq || 0) - (a.lastSeq || 0) || String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
  const queue = runtime.pipelineQueue || {}
  const activeDir = queue.current && queue.current.dir
  const enabled = journal.enabled == null ? runtime.enabled !== false : !!journal.enabled
  const capturing = !!journal.capturing
  // 采集中只看"正在录的这场"：否则上一场还在排队时，录音时长会算到别的场次头上
  const recordingRun = capturing && journal.currentRun && journal.runs ? journal.runs[journal.currentRun] || null : null
  const run = recordingRun || runs.find((r) => r.run === activeDir) || runs.find((r) => r.phase === 'running' || r.phase === 'queued') || runs.find((r) => r.run === journal.currentRun) || runs[0] || null
  const phase = run && run.phase || 'idle'
  const working = phase === 'running' || phase === 'queued'
  const error = phase === 'error' ? run.error || '整理失败' : journal.lastCaptureError || ''
  // 声纹就绪：宿主探测后带下来（模型校验过没、运行库可用没、总开关开没开）。
  // 界面只读这里，不在客户端重算"大概能用"。
  const vpRaw = runtime.voiceprint || null
  const voiceprint = vpRaw ? {
    enabled: vpRaw.enabled === true,
    usable: vpRaw.usable === true,
    ready: vpRaw.ready === true,
    reason: String(vpRaw.reason || ''),
    hint: String(vpRaw.hint || ''),
    modelId: String(vpRaw.modelId || ''),
  } : null
  // 这一场会认出几个人：只来自已落盘的 speakers.json（runtime.identities 由宿主读文件生成）
  const idRaw = run && runtime.identities && runtime.identities[run.run] || null
  const identity = idRaw ? {
    assigned: Number(idRaw.assigned) || 0,
    total: Number(idRaw.total) || 0,
    pending: Number.isFinite(Number(idRaw.pending)) ? Number(idRaw.pending) : Math.max(0, (Number(idRaw.total) || 0) - (Number(idRaw.assigned) || 0)),
  } : null
  let headline = !enabled ? '会议助手已关闭' : '等待会议'
  let detail = !enabled ? '开启后可自动检测会议；不会自动加入会议。' : '检测到会议时自动录音，也可立即开始。'
  let tone = 'neutral'
  if (capturing) { headline = '正在录音与实时转写'; detail = '音频与转写持续保存。结束后自动整段转写、生成纪要并落库。'; tone = 'success' }
  else if (working) { headline = phase === 'queued' ? '等待会后整理' : (LABELS[run.step] || '正在会后整理'); detail = run.stepDetail || '处理进度来自已落盘的事件；可关闭面板，后台继续。'; tone = 'info' }
  else if (phase === 'done') {
    // 数字只取已落盘的：句数/说话人数来自 offline 结果，认人数来自 speakers.json
    const done = []
    const sentences = Number(run.result && run.result.sentences) || 0
    const speakerCount = Number(run.result && run.result.speakers) || 0
    if (sentences) done.push(sentences + ' 句')
    if (speakerCount) done.push(speakerCount + ' 位')
    if (identity && identity.total) done.push('认出 ' + identity.assigned + ' 位')
    headline = '会后整理完成'
    detail = (done.length ? '整理完成 · ' + done.join(' · ') + '。' : '') + '产物已保存。各步骤结果可在下方查看。'
    tone = 'success'
  }
  if (error) { headline = phase === 'error' ? '会后整理需要处理' : '录音需要处理'; detail = error; tone = 'error' }
  const steps = Object.keys(LABELS).map((id) => {
    const item = run && run.steps && run.steps[id] || { state: 'pending' }
    return { id, label: LABELS[id], state: item.state || 'pending', stateLabel: STATE_LABELS[item.state] || STATE_LABELS.pending, detail: item.detail || '', progress: null }
  })
  // Providers rarely expose genuine progress. A clock-derived percentage must not be
  // shown as measured progress. Only explicit measuredProgress is accepted.
  if (run && Number.isFinite(run.measuredProgress)) {
    const step = steps.find((s) => s.id === run.step)
    if (step && phase === 'running' && step.state === 'running') step.progress = Math.max(0, Math.min(100, run.measuredProgress))
  }
  const diagnostics = []
  const add = (id, label, value, severity = 'neutral') => { if (value) diagnostics.push({ id, label, value: String(value), tone: severity }) }
  const session = runtime.session || {}
  const asr = session.asr || runtime.asr || {}
  add('capture', '音频采集', capturing
    ? (session.silentSec >= 10
      ? '连续静音 ' + session.silentSec + ' 秒'
      : (session.mixMic === true
        ? (session.micRunning === true ? '采集中（环回 + 麦克风）' : '采集中（只有环回：麦克风那一路没在跑）')
        : '采集中（只有环回）'))
    : '未在采集', capturing && (session.silentSec >= 10 || (session.mixMic === true && session.micRunning !== true)) ? 'warning' : 'neutral')
  add('asr', '实时识别', asr.failed ? '失败：' + (asr.lastError || '查看诊断') : asr.online ? '已连接' : capturing ? '等待连接' : '待命', asr.failed ? 'error' : 'neutral')
  add('audio', '音频写入', session.bytes ? Math.round(session.bytes / 1024) + ' KB 已接收' : '')
  // 模型来源必须如实显示：绑定会话 / DSH 默认 / 本场快照，不能只说"跟随"让人以为一定跟当前对话一致
  const modelSel = (run && run.model) || journal.models || null
  const modelSourceLabel = { session: '绑定会话', 'dsh-default': 'DSH 默认', snapshot: '本场快照', config: '显式自定义' }
  add('model', '非语音模型', modelSel
    ? (modelSel.provider + '/' + modelSel.model + '（' + (modelSourceLabel[modelSel.source] || modelSel.source || '来源未知') + '）')
    : (runtime.modelLabel || '等待首个请求后确定（默认跟随 DSH 会话模型）'))
  add('host', '宿主版本', runtime.host && runtime.host.stale ? '代码已更新，需要重启 DSH' : '', 'warning')
  add('model-error', '模型调用', textError(runtime.lastLlmError), 'error')
  add('voice-error', '语音输出', textError(runtime.lastSpeakError), 'error')
  // 问题分两档，别再混在一起：issues 只留 error/warn（要人动手的），
  // info 级（比如"当前没检测到会议窗口"这种正常上下文）进 notices，用中性色。
  // 以前 info 被统一映射成 warning，于是链路完全正常时首屏也顶着一条黄条。
  const issues = []
  const notices = []
  const pushRuntimeIssue = (v, i) => {
    const text = v.text || v.message || v.title || v.reason || ''
    if (!text) return
    const level = String(v.level || v.severity || '')
    const tone = level === 'error' ? 'error' : level === 'info' ? 'info' : 'warning'
    const item = {
      id: v.id || v.key || 'issue-' + i,
      text,
      // detail 是"为什么坏"的唯一线索（例如 mbridge.exe 不存在），不能在这一层丢掉
      detail: String(v.detail || ''),
      fix: v.fix || v.suggestion || '',
      tone,
    }
    if (tone === 'info') notices.push(item)
    else issues.push(item)
  }
  ;(runtime.issues || []).forEach(pushRuntimeIssue)
  for (const [id, issue] of Object.entries(journal.issues || {})) if (!issues.some((x) => x.id === id)) issues.push({ id, text: issue.text || '', detail: String(issue.detail || ''), fix: issue.fix || '', tone: 'warning' })
  // 主操作由状态决定，不再用"没在录音就让你开始录音"兜底：
  // 完成态还给「立即开始录音」是这轮要修的缺陷。只有真正空闲且配置齐了才出现它。
  const configured = isConfigured(runtime)
  let primary
  if (capturing) primary = { id: 'stop', label: '结束录音并整理', action: 'stop', disabled: false }
  else if (run && phase === 'done') primary = { id: 'minutes', label: '看纪要', action: 'minutes', disabled: false }
  else if (run && phase === 'error') primary = { id: 'retry', label: '重试失败步骤', action: 'offline', dir: run.run, restart: false, disabled: false }
  else if (run && phase === 'queued') primary = { id: 'organize', label: '开始整理', action: 'offline', dir: run.run, restart: false, disabled: false }
  else if (working) primary = { id: 'record', label: '开始录音', action: 'record', disabled: false }
  else if (!configured) primary = { id: 'setup', label: '去配置', action: 'settings', disabled: false }
  else primary = { id: 'record', label: '立即开始录音', action: 'record', disabled: false }
  // 主按钮只说"下一步该做什么"，但手动控制不能因此消失：
  // 自动检测失灵/想立刻录/刚看完纪要想再录一场，都需要一个随时可点的「开始录音」。
  // 放着主按钮同一个位置、但次级样式；主按钮本身就是它时不重复。
  const secondary = []
  if (!capturing && !(primary && primary.action === 'record')) {
    secondary.push({ id: 'record', label: run ? '再录一场' : '开始录音', action: 'record', disabled: false })
  }
  // elapsedSec 只在采集中才有意义（= 本次录音时长）；meetingDurationSec 是这场会录了多久。
  const elapsedStart = run ? Date.parse(run.startedAt || '') : NaN
  const elapsedSec = capturing && Number.isFinite(elapsedStart)
    ? Math.max(0, Math.floor(((Number(runtime.now) || Date.now()) - elapsedStart) / 1000))
    : null
  return {
    version: 1, display: cfg, headline, detail, tone, enabled, capturing, working,
    durableSeq: Number(journal.lastSeq) || 0,
    // 声纹状态与这一场会的认人结果（都是宿主探测/落盘的事实；null = 没有就不显示）
    voiceprint,
    identity,
    run: run ? { dir: run.run, name: run.name || '', phase, updatedAt: run.updatedAt || '', minutesPath: run.result && run.result.minutesPath || '', sentences: run.result && run.result.sentences || 0, speakers: run.result && run.result.speakers || 0 } : null,
    primary, secondary, steps, issues, notices, diagnostics,
    configured,
    elapsedSec,
    meetingDurationSec: recordedSec(run, runtime.recording),
    app: { name: runtime.activeApp || runtime.meeting && runtime.meeting.app || '—', source: runtime.activeApp ? '手动' : runtime.meeting && runtime.meeting.app ? '自动' : '未识别' },
    captureActivity: { lines: (runtime.transcript || []).length, sentSec: Math.floor((asr.sentMs || 0) / 1000), lastAt: (runtime.transcript || []).length ? runtime.transcript[runtime.transcript.length - 1].t || '' : '' },
    activity: cfg.showActivity ? (journal.activity || []).slice(-cfg.activityLimit).reverse() : [],
    // 录音/纪要/转写的真实位置（来自宿主 stat，不猜）
    artifacts: runtime.artifacts || null,
    // 这段录音能不能整理（no-capture / no-audio-file / silent 三类由宿主判定，界面如实显示）
    recording: runtime.recording || null,
    queueCount: Array.isArray(queue.queue) ? queue.queue.length : 0,
    transcriptNote: '实时转写是会中草稿；会后纪要使用整段非流式转写。',
    persistence: '先落盘后展示 · 可从事件日志恢复',
  }
}
