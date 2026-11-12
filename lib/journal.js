/**
 * lib/journal.js —— 只追加的事件日志（先落盘，后展示）
 *
 * 借鉴 DSH 会话日志的做法：状态不是一份可变的内存对象，而是事件日志的投影。
 *   · 每个状态变化先 appendFileSync 到磁盘，成功后才更新内存投影、才让界面看到
 *   · 界面上的一切都由 project(events) 这个纯函数推导，没有日志之外的黑盒状态
 *   · 宿主崩溃 / 重启后，重放日志得到同一份状态；没跑完的会后整理会被找出来续跑
 *
 * 两层日志，任何一层都能独立恢复：
 *   1. 全局日志  <root>/journal.jsonl            所有会议、所有运行状态
 *   2. 会议日志  <会议目录>/events.jsonl          只含这场会（目录拷到别处也能恢复）
 * 两份都没有时，还能从会议目录里的产物（audio.wav / transcript.jsonl / minutes.md）
 * 推断出这场会走到了哪一步（inferFromArtifacts）。
 *
 * 事件格式：{ seq, at, type, run?, ...data }
 *   run   会议目录（一场会的身份）；没有 run 的是全局事件（插件启用、宿主启动等）
 *   type  见下方 EVENT_TYPES
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, renameSync, openSync, closeSync, writeSync, fsyncSync, copyFileSync, fstatSync, readSync } from 'node:fs'
import { join, basename } from 'node:path'

export const JOURNAL_VERSION = 1

/** 所有事件类型（新增类型必须加在这里，并在 project() 里处理） */
export const EVENT_TYPES = Object.freeze([
  'journal.checkpoint', // 完整投影快照（轮转产生，seq 不增加）
  'host.boot',          // 宿主进程启动 { pid, version }
  'plugin.enabled',     // 总开关 { enabled }
  'capture.start',      // 开始录音 { run, reason }
  'capture.fail',       // 开录失败 { run?, error }
  'capture.stop',       // 停止录音 { run, reason, bytes, audio }
  'capture.error',      // 录音过程中的问题（不一定致命）{ run, error }
  'runtime.asr',        // ASR 连接/重连/丢帧状态 { run?, state }（字段白名单，不存凭据）
  'runtime.model',      // 非语音模型选择快照 { run?, selection }（不存凭据）
  'meeting.enter',      // 识别到进入会议 { reason }
  'meeting.exit',       // 识别到离开会议 { hadAudio }
  'pipeline.queued',    // 排队已落盘 { run, reason, from, restart }
  'pipeline.start',     // 会后整理开始 { run, reason }
  'pipeline.step',      // 进入某一步 { run, step, detail?, percent? }
  'pipeline.progress',  // 某一步内的进度 { run, step, detail?, percent? }
  'pipeline.stepDone',  // 某一步完成 { run, step, result? }
  'pipeline.stepSkip',  // 某一步跳过 { run, step, reason }
  'pipeline.done',      // 整理完成 { run, minutesPath?, knowledge?, sentences?, speakers? }
  'pipeline.error',     // 整理失败 { run, step?, error }
  'pipeline.resume',    // 重启后续跑 { run, from }
  'issue.raise',        // 出现问题 { key, text, fix? }
  'issue.clear',        // 问题解除 { key }
  'records.delete',     // 用户删除一条空会议记录 { dir, capture }（删除前落盘，便于追查）
])

/** 会后整理的步骤（顺序即执行顺序） */
// identify：把云端分出的说话人簇认成人（本地声纹，认不出不影响纪要）
export const PIPELINE_STEPS = Object.freeze(['offline', 'identify', 'minutes', 'knowledge', 'persona'])

/** 每个步骤完成后留在会议目录里的产物，用于从产物推断进度 */
const STEP_ARTIFACT = {
  offline: 'transcript-offline.jsonl',
  identify: 'speakers.json',
  minutes: 'minutes.md',
}

// ASR 的运行信息只存已知指标；不要把 SDK 配置、原始响应或 Key 带进日志。
function safeAsrState(input = {}) {
  const out = {}
  for (const k of ['online', 'failed']) if (typeof input?.[k] === 'boolean') out[k] = input[k]
  for (const k of ['attempt', 'reconnects', 'sentMs', 'droppedMs', 'bufferedMs']) {
    if (Number.isFinite(input?.[k])) out[k] = input[k]
  }
  if (typeof input?.phase === 'string') out.phase = input.phase.slice(0, 80)
  if (typeof input?.lastError === 'string') {
    out.lastError = input.lastError
      .replace(/\b(?:sk|ghp|gho)[-_][A-Za-z0-9_-]+\b/g, '[REDACTED]')
      .replace(/(bearer\s+)\S+/gi, '$1[REDACTED]')
      .replace(/((?:api[-_]?key|token|authorization|secret)\s*[=:]\s*)[^\s,;]+/gi, '$1[REDACTED]')
      .slice(0, 1000)
  }
  return out
}

function safeModelSelection(input = {}) {
  const out = {}
  for (const key of ['provider', 'model', 'reasoningEffort', 'sourceSessionId', 'source']) {
    if (typeof input?.[key] === 'string') out[key] = input[key].slice(0, 256)
  }
  return out
}

function safeParse(line) {
  try { return JSON.parse(line) } catch { return null }
}

/** 读一个 jsonl 日志；坏行（写到一半崩溃留下的残行）跳过，不影响其余事件 */
export function readJournalFile(file) {
  if (!file || !existsSync(file)) return []
  let text = ''
  try { text = readFileSync(file, 'utf8') } catch { return [] }
  const out = []
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    const e = safeParse(line)
    if (e && typeof e.type === 'string') out.push(e)
  }
  return out
}

/**
 * 创建日志。
 * @param {{ root: string, maxBytes?: number, now?: () => number }} opts
 */
export function createJournal({ root, maxBytes = 8 * 1048576, now = Date.now } = {}) {
  if (!root) throw new Error('journal 需要 root 目录')
  const file = join(root, 'journal.jsonl')
  let seq = 0
  const listeners = new Set()
  /** 内存里的完整事件序列（重放 + 本进程追加）；投影由它推导 */
  let events = []

  // 分隔残缺尾行；即使上次写盘只写了一半，新事件也必须是独立 JSON 行。
  function durableAppend(target, line) {
    const fd = openSync(target, 'a+')
    try {
      const size = fstatSync(fd).size
      const tail = Buffer.alloc(1)
      if (size) readSync(fd, tail, 0, 1, size - 1)
      const prefix = size && tail[0] !== 10 ? '\n' : ''
      const data = Buffer.from(prefix + line, 'utf8')
      let off = 0
      while (off < data.length) off += writeSync(fd, data, off, data.length - off)
      fsyncSync(fd)
    } finally { closeSync(fd) }
  }

  function rotateIfNeeded() {
    if (!(maxBytes > 0) || !existsSync(file) || statSync(file).size <= maxBytes) return
    // 先完整写入临时 checkpoint 并同步，再原子替换；原日志始终存在。
    const checkpoint = { seq, at: new Date(now()).toISOString(), type: 'journal.checkpoint', state: project(events) }
    const temp = file + '.checkpoint.tmp'
    try {
      const fd = openSync(temp, 'w')
      try { writeSync(fd, JSON.stringify(checkpoint) + '\n'); fsyncSync(fd) } finally { closeSync(fd) }
      copyFileSync(file, join(root, 'journal-' + seq + '-' + new Date(now()).toISOString().replace(/[:.]/g, '-') + '.jsonl'))
      renameSync(temp, file)
      events = [checkpoint]
    } catch { /* 原日志未删除，轮转失败也不会丢投影 */ }
  }

  return {
    file,
    /** 启动时调用：读回磁盘上的日志，接上 seq */
    load() {
      try { mkdirSync(root, { recursive: true }) } catch { /* ignore */ }
      events = readJournalFile(file)
      seq = events.reduce((m, e) => Math.max(m, Number(e.seq) || 0), 0)
      return events.length
    },

    /**
     * 追加一个事件：**先写磁盘，成功后才进内存、才通知界面**。
     * 写盘失败抛错 —— 调用方必须知道"这个状态没有落盘"，不能假装成功。
     */
    append(type, data = {}) {
      if (!EVENT_TYPES.includes(type)) throw new Error('未知事件类型：' + type)
      const identity = data.run ? { run: String(data.run) } : {}
      const payload = type === 'runtime.asr' ? { ...identity, state: safeAsrState(data.state) }
        : type === 'runtime.model' ? { ...identity, selection: safeModelSelection(data.selection) } : data
      const e = structuredClone({ ...payload, seq: seq + 1, at: new Date(now()).toISOString(), type })
      const line = JSON.stringify(e) + '\n'
      mkdirSync(root, { recursive: true })
      durableAppend(file, line)
      // 会议日志：目录还在才写（目录被删了不报错，全局日志里仍有）
      if (e.run && existsSync(e.run)) {
        try { durableAppend(join(e.run, 'events.jsonl'), line) } catch { /* 全局日志已落盘 */ }
      }
      seq = e.seq
      events.push(e)
      rotateIfNeeded()
      for (const fn of listeners) { try { fn(structuredClone(e)) } catch { /* ignore */ } }
      return structuredClone(e)
    },

    events() { return structuredClone(events) },
    projection() { return project(events) },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn) },
  }
}

function emptyRun(run) {
  return {
    run,
    name: basename(String(run || '')),
    phase: 'idle',          // idle | recording | queued | running | done | error
    startedAt: '',
    stoppedAt: '',
    step: '',
    stepDetail: '',
    percent: null,
    steps: Object.fromEntries(PIPELINE_STEPS.map((s) => [s, { state: 'pending', detail: '' }])),
    error: '',
    errorStep: '',
    result: {},
    updatedAt: '',
    lastSeq: 0,
  }
}

/**
 * 纯函数：事件 → 状态。界面、接口、工具输出都只读它。
 * 同一份事件永远得到同一份状态（可复现）。
 */
export function project(events = []) {
  let state = {
    version: JOURNAL_VERSION,
    bootedAt: '',
    enabled: null,
    inMeeting: false,
    meetingSince: '',
    capturing: false,
    currentRun: '',
    lastCaptureError: '',
    asr: {},
    models: {},
    runs: {},
    issues: {},
    activity: [],   // 最近 50 条，给"动态"时间线
    lastSeq: 0,
  }
  const runOf = (id) => {
    if (!state.runs[id]) state.runs[id] = emptyRun(id)
    return state.runs[id]
  }
  for (const e of events) {
    if (e.type === 'journal.checkpoint' && e.state) { state = structuredClone(e.state); continue }
    state.lastSeq = Math.max(state.lastSeq, Number(e.seq) || 0)
    const r = e.run ? runOf(e.run) : null
    if (r) { r.updatedAt = e.at; r.lastSeq = e.seq }
    switch (e.type) {
      case 'host.boot':
        state.bootedAt = e.at
        // 新进程：内存里的"正在录音"都不再成立（采集进程随宿主一起没了）
        state.capturing = false
        state.inMeeting = false
        for (const x of Object.values(state.runs)) {
          if (x.phase === 'recording') { x.phase = 'queued'; x.stoppedAt = x.stoppedAt || e.at }
        }
        break
      case 'plugin.enabled': state.enabled = !!e.enabled; break
      case 'meeting.enter': state.inMeeting = true; state.meetingSince = e.at; break
      case 'meeting.exit': state.inMeeting = false; state.meetingSince = ''; break
      case 'capture.start':
        state.capturing = true
        state.currentRun = e.run || ''
        state.lastCaptureError = ''
        if (r) {
          // 同一目录重新开录：之前的整理结果作废
          Object.assign(r, emptyRun(r.run), { phase: 'recording', startedAt: e.at, updatedAt: e.at, lastSeq: e.seq })
        }
        break
      case 'capture.fail':
        state.capturing = false
        state.lastCaptureError = e.error || '开录失败'
        break
      case 'runtime.model': {
        const selection = safeModelSelection(e.selection)
        state.models = selection
        if (r) r.model = selection
        break
      }
      case 'runtime.asr': {
        const asr = safeAsrState(e.state)
        state.asr = asr
        if (r) r.asr = asr
        break
      }
      case 'capture.error':
        if (r) r.error = e.error || ''
        state.lastCaptureError = e.error || ''
        break
      case 'capture.stop':
        state.capturing = false
        if (r) {
          r.stoppedAt = e.at
          if (r.phase === 'recording') r.phase = 'queued'
          r.result.bytes = e.bytes || 0
          r.result.audio = !!e.audio
        }
        break
      case 'pipeline.queued':
        if (r) { r.phase = 'queued'; r.queuedFrom = e.from || ''; r.restart = !!e.restart }
        break
      case 'pipeline.start':
        if (r) {
          r.phase = 'running'; r.error = ''; r.errorStep = ''; r.restart = false
          for (const s of PIPELINE_STEPS) r.steps[s] = { state: 'pending', detail: '' }
          r.step = ''; r.percent = 0
        }
        break
      case 'pipeline.resume':
        if (r) { r.phase = 'running'; r.error = ''; r.errorStep = '' }
        break
      case 'pipeline.step':
      case 'pipeline.progress':
        if (r && e.step) {
          r.phase = 'running'
          r.step = e.step
          if (e.detail != null) r.stepDetail = String(e.detail)
          if (typeof e.percent === 'number') r.percent = e.percent
          const s = r.steps[e.step] || (r.steps[e.step] = { state: 'pending', detail: '' })
          s.state = 'running'
          if (e.detail != null) s.detail = String(e.detail)
        }
        break
      case 'pipeline.stepDone':
        if (r && e.step) {
          r.steps[e.step] = { state: 'done', output: structuredClone(e.output || {}), detail: e.result != null ? String(e.result) : (r.steps[e.step]?.detail || '') }
          if (r.step === e.step) { r.stepDetail = ''; r.percent = null }
        }
        break
      case 'pipeline.stepSkip':
        if (r && e.step) r.steps[e.step] = { state: 'skipped', detail: String(e.reason || '') }
        break
      case 'pipeline.done':
        if (r) {
          r.phase = 'done'; r.step = ''; r.stepDetail = ''; r.percent = 100
          for (const k of ['minutesPath', 'knowledge', 'sentences', 'speakers', 'minutesSource']) {
            if (e[k] != null) r.result[k] = e[k]
          }
        }
        break
      case 'pipeline.error':
        if (r) {
          r.phase = 'error'; r.error = e.error || '未知原因'; r.errorStep = e.step || r.step || ''
          if (r.errorStep && r.steps[r.errorStep]) r.steps[r.errorStep] = { state: 'error', detail: r.error }
        }
        break
      case 'issue.raise': if (e.key) state.issues[e.key] = { text: e.text || '', fix: e.fix || '', at: e.at }; break
      case 'issue.clear': if (e.key) delete state.issues[e.key]; break
      default: break
    }
    if (e.type !== 'pipeline.progress') {
      state.activity.push({ seq: e.seq, at: e.at, type: e.type, run: e.run || '', text: describeEvent(e) })
      if (state.activity.length > 50) state.activity.shift()
    }
  }
  return state
}

const STEP_LABEL = { offline: '整段转写', minutes: '生成纪要', knowledge: '写入知识库', persona: '更新画像' }
export function stepLabel(step) { return STEP_LABEL[step] || step || '' }

/** 一句人话描述事件（时间线用） */
export function describeEvent(e) {
  switch (e.type) {
    case 'host.boot': return 'DSH 启动，插件已加载'
    case 'plugin.enabled': return e.enabled ? '会议助手已开启' : '会议助手已关闭'
    case 'meeting.enter': return '识别到会议开始' + (e.reason ? '（' + String(e.reason).slice(0, 40) + '）' : '')
    case 'meeting.exit': return '识别到会议结束'
    case 'capture.start': return '开始录音' + (e.reason ? '（' + e.reason + '）' : '')
    case 'capture.fail': return '录音没有启动：' + (e.error || '')
    case 'runtime.model': return '模型：' + (e.selection?.provider || '') + '/' + (e.selection?.model || '') + ' · ' + (e.selection?.source || 'unknown')
    case 'runtime.asr': return '语音识别：' + (e.state?.failed ? '连接失败' : e.state?.online ? '已连接' : (e.state?.phase || '连接中')) + (e.state?.lastError ? ' · ' + safeAsrState(e.state).lastError : '')
    case 'capture.error': return '录音出现问题：' + (e.error || '')
    case 'capture.stop': return '停止录音' + (e.reason ? '（' + e.reason + '）' : '') + (e.audio ? '' : ' · 没有录到音频文件')
    case 'pipeline.queued': return '会后整理已排队' + (e.reason ? '（' + e.reason + '）' : '')
    case 'pipeline.start': return '开始会后整理' + (e.reason ? '（' + e.reason + '）' : '')
    case 'pipeline.resume': return '继续上次没完成的整理（从「' + stepLabel(e.from) + '」开始）'
    case 'pipeline.step': return stepLabel(e.step) + (e.detail ? '：' + e.detail : '')
    case 'pipeline.stepDone': return stepLabel(e.step) + ' 完成' + (e.result ? ' · ' + e.result : '')
    case 'pipeline.stepSkip': return stepLabel(e.step) + ' 跳过：' + (e.reason || '')
    case 'pipeline.done': return '会后整理完成' + (e.sentences ? ' · ' + e.sentences + ' 句' : '')
    case 'pipeline.error': return (e.step ? stepLabel(e.step) + ' ' : '') + '失败：' + (e.error || '')
    case 'issue.raise': return '问题：' + (e.text || e.key)
    case 'issue.clear': return '已解决：' + (e.key || '')
    case 'records.delete': return '删除空记录：' + basename(String(e.dir || '')) + (e.capture && e.capture.verdict ? '（' + String(e.capture.verdict).slice(0, 60) + '）' : '')
    default: return e.type
  }
}

/**
 * 没有任何日志时，从会议目录的产物推断进度（第三层恢复）。
 * 仅推断实际存在的产物；诊断日志不能恢复已丢失的音频。文件存在不代表知识库写入成功。
 */
export function inferFromArtifacts(dir) {
  const r = emptyRun(dir)
  if (!dir || !existsSync(dir)) return r
  const has = (f) => { try { return statSync(join(dir, f)).size > 0 } catch { return false } }
  const audio = has('audio.wav')
  const live = has('transcript.jsonl')
  let meta = {}
  try { meta = JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8')) } catch { /* ignore */ }
  r.startedAt = meta.startedAt || ''
  r.stoppedAt = meta.endedAt || ''
  r.result.audio = audio
  if (has(STEP_ARTIFACT.offline)) r.steps.offline = { state: 'done', detail: '' }
  else if (!audio) r.steps.offline = { state: 'skipped', detail: '没有录音文件' }
  if (has(STEP_ARTIFACT.minutes)) r.steps.minutes = { state: 'done', detail: '' }
  if (meta.knowledgeAt) r.steps.knowledge = { state: 'done', detail: String(meta.knowledge || '') }
  const minutesDone = r.steps.minutes.state === 'done'
  if (minutesDone && r.steps.knowledge.state === 'done') r.phase = 'done'
  else if (audio || live) r.phase = 'queued'
  r.inferred = true
  return r
}

/** 第一步还没完成的步骤（续跑从这里开始） */
export function nextStep(run) {
  for (const s of PIPELINE_STEPS) {
    const st = run.steps && run.steps[s] && run.steps[s].state
    if (st !== 'done' && st !== 'skipped') return s
  }
  return ''
}

/**
 * 找出需要续跑的会议：整理开始了但没结束（宿主中途退出），或停了录音还没整理。
 * 只看最近 maxAgeMs 内的，避免把几周前的旧会议全部翻出来重跑。
 */
export function findInterrupted(proj, { now = Date.now(), maxAgeMs = 24 * 3600 * 1000 } = {}) {
  const out = []
  for (const r of Object.values(proj.runs || {})) {
    if (r.phase !== 'running' && r.phase !== 'queued') continue
    const t = Date.parse(r.updatedAt || r.stoppedAt || '') || 0
    if (t && now - t > maxAgeMs) continue
    out.push(r)
  }
  return out.sort((a, b) => (a.lastSeq || 0) - (b.lastSeq || 0))
}

/**
 * 从一份会议日志（events.jsonl）恢复单场会的状态。
 * 用于：全局日志丢了 / 目录被拷到别的机器。
 */
export function recoverRun(dir) {
  const ev = readJournalFile(join(dir, 'events.jsonl'))
  if (ev.length) {
    const p = project(ev)
    const r = p.runs[dir] || Object.values(p.runs)[0]
    if (r) return { ...r, run: dir, source: 'events.jsonl' }
  }
  return { ...inferFromArtifacts(dir), source: 'artifacts' }
}

/**
 * 全局日志缺失时，从各会议事件恢复。只恢复确实记录过的状态，不能制造音频。
 * knowledge 开始但没有确认回执：结果不确定，必须人工核对，不能自动重发。
 * 调用顺序 recoverJournal(root, dirs); journal.load()。
 */
export function recoverJournal(root, dirs = listRunDirs(root)) {
  const file = join(root, 'journal.jsonl')
  if (existsSync(file)) return { recovered: false, eventCount: 0, uncertain: [] }
  const merged = []
  for (const dir of [...new Set(dirs)]) {
    const events = readJournalFile(join(dir, 'events.jsonl'))
    for (let index = 0; index < events.length; index++) {
      const event = events[index]
      if (!EVENT_TYPES.includes(event.type) || event.type === 'journal.checkpoint') continue
      const safe = event.type === 'runtime.asr' ? { ...event, state: safeAsrState(event.state) }
        : event.type === 'runtime.model' ? { seq: event.seq, at: event.at, type: event.type, selection: safeModelSelection(event.selection) } : event
      merged.push({ event: { ...safe, run: dir }, index, dir })
    }
  }
  if (!merged.length) return { recovered: false, eventCount: 0, uncertain: [] }
  merged.sort((a, b) => (Date.parse(a.event.at) || 0) - (Date.parse(b.event.at) || 0)
    || (Number(a.event.seq) || 0) - (Number(b.event.seq) || 0) || a.dir.localeCompare(b.dir) || a.index - b.index)
  const events = merged.map(({ event }, i) => ({ ...event, seq: i + 1 }))
  const uncertain = []
  for (const r of Object.values(project(events).runs)) {
    if (r.steps.knowledge?.state !== 'running') continue
    uncertain.push(r.run)
    events.push({ seq: events.length + 1, at: new Date().toISOString(), type: 'pipeline.error', run: r.run,
      step: 'knowledge', error: '知识库写入结果不确定：请先核对知识库回执，确认未写入后再重试；未自动重发' })
  }
  mkdirSync(root, { recursive: true })
  const temp = file + '.recover.tmp'
  const fd = openSync(temp, 'w')
  try {
    const buffer = Buffer.from(events.map((e) => JSON.stringify(e)).join('\n') + '\n')
    let offset = 0
    while (offset < buffer.length) offset += writeSync(fd, buffer, offset, buffer.length - offset)
    fsyncSync(fd)
  } finally { closeSync(fd) }
  renameSync(temp, file)
  return { recovered: true, eventCount: events.length, uncertain }
}

/** 列出数据目录下所有会议目录（含 meta.json 或录音/转写的才算） */
export function listRunDirs(root) {
  try {
    return readdirSync(root, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => join(root, d.name))
      .filter((d) => ['meta.json', 'audio.wav', 'transcript.jsonl', 'events.jsonl'].some((f) => existsSync(join(d, f))))
  } catch { return [] }
}
