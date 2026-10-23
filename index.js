/**
 * soulmirror —— 数字分身插件（桌面会议/音频 + DSH 任务执行）。
 *
 * 能力：
 *   1. 操作桌面会议软件（UIAutomation + 键盘/鼠标）：启动、加入、静音、离开、任意控件点击
 *   2. 环回采集系统声音（WASAPI loopback），按固定时长切片
 *   3. 切片送云端 ASR（OpenAI 兼容 /audio/transcriptions），形成实时转写
 *   4. 离线 TTS（SAPI 中文音色）合成后播放到虚拟声卡，作为"会议麦克风"发言
 *
 * 依赖：tools/mbridge.exe（WASAPI + SAPI）、tools/ui.ps1（UIAutomation，Windows PowerShell 5.1）
 */
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { appendFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { homedir } from 'node:os'
import { join } from 'node:path'

const execFileAsync = promisify(execFile)

import { bridge, listDevices, toolsDir, micUsage } from './lib/bridge.js'
import {
  listWindows, pickMeetingWindows, dump, focus, click, setText, pressKey, typeText,
  ensureApp, resolveAppPath, setWindowSelector, toggleMic, currentSpeaker, clickXY, clickRatio, clientRect, shotWindow,
} from './lib/desktop.js'
import { MeetingSession } from './lib/session.js'
import { pickLocalModel } from './lib/asr.js'
import { speak, sayToMeeting } from './lib/tts.js'
import { synthesizeStream } from './lib/dashscope-tts.js'
import { startDashScopeAsr } from './lib/dashscope.js'
import { MeetingBrain, createCompleter, makeCorrector } from './lib/brain.js'
import { MeetingLifecycle } from './lib/lifecycle.js'
import { runDshTask, runShell } from './lib/twin.js'
import { loadPersona, personaBlock, readPersonaFile, writePersonaFile, appendPersonaSection, PERSONA_FILES } from './lib/persona.js'
import { profileHasKnowledge, pickKnowledgeProfile, isHostProfile, linkStatus, writeToKnowledge, detectKnowledge, hostHasKnowledge, writeViaHostApi } from './lib/knowledge.js'
import { MemoryStore } from './lib/memory.js'
import { LivingWorld } from './lib/living.js'
import { installAutoAnswer, pickRecommended } from './lib/auto-answer.js'
import { UiMap, pixelToRatio, ratioToPixel, probeOffsets, validRatio } from './lib/uimap.js'
import { isJoinUrl, isBareCode, extractJoinUrl, joinedAfterOpening } from './lib/join-url.js'
import { normalizeApps, detectRunningApps, pickAutoApp, inferProc, listPresets, scoreWindow } from './lib/apps.js'
import { deriveMeetingKey, safeName, SessionMap } from './lib/meeting-id.js'
import { getController, createSession, promptSession } from './lib/dsh-session.js'
import { detectEnv, buildBridge, autoSetup, formatEnv } from './lib/setup.js'
import { detectVirtualAudio, installPlan, installVirtualAudio, formatVirtualAudio } from './lib/vcard.js'

export const name = 'soulmirror'

export const inject = ['tools', 'webServer']

export const Config = z.object({
  /** 总开关：关闭后所有写操作工具直接拒绝。 */
  enabled: z.boolean().default(true),
  /** 会议客户端 exe 路径（空 = 自动探测腾讯会议）。 */
  appPath: z.string().default(''),
  /** 窗口标题片段。 */
  windowTitle: z.string().default('腾讯会议'),
  /** 会议窗口类名片段（| 分隔）：会议中标题往往变成会议主题，需靠类名定位。 */
  windowClass: z.string().default('VideoMainWindow|FloatSpeakingWnd|MeetingMainWindow|MeetingView'),
  /** 进程名过滤，防止误操作其他同名窗口。 */
  processName: z.string().default('wemeetapp'),
  /** 音频设备。 */
  devices: z.object({
    /** 环回采集的目标渲染设备（空 = 系统默认）；会议声音从哪个设备出，就填哪个。 */
    capture: z.string().default(''),
    /** 采集模式：loopback（采系统声音）或 device（采某个采集端点）。 */
    captureMode: z.union(['loopback', 'device']).default('loopback'),
    /** 发言播放到的虚拟声卡输入端点（渲染设备）。 */
    speak: z.string().default('CABLE Input'),
    /** 会议客户端里应选的麦克风名字（仅用于状态提示）。 */
    micName: z.string().default(''),
    /** 真实麦克风设备名：发言后恢复默认录音设备用。 */
    micRestore: z.string().default(''),
    /** 进入会议时腾讯会议是否为静音状态（用于发言前自动开麦的判断）。 */
    micInitiallyMuted: z.boolean().default(true),
  }),
  /** 文本转语音。 */
  tts: z.object({
    /** sapi = 本机离线；openai = 任意 OpenAI 兼容 /audio/speech（流式 pcm） */
    provider: z.union(['sapi', 'openai', 'dashscope']).default('dashscope'),
    voice: z.string().default('longxiaochun_v2'),
    rate: z.number().default(0),
    baseUrl: z.string().default(''),
    model: z.string().default('cosyvoice-v2'),
    apiKeyEnv: z.string().default('OPENAI_API_KEY'),
    speed: z.number().default(1),
    /** 云端 pcm 采样率（OpenAI 返回 24000） */
    sampleRate: z.number().default(24000),
  }),
  /** 语音识别。local = 插件自带的 whisper.cpp 离线模型；openai = OpenAI 兼容云端；none = 关闭。 */
  asr: z.object({
    provider: z.union(['none', 'openai', 'local', 'dashscope']).default('dashscope'),
    baseUrl: z.string().default(''),
    model: z.string().default('whisper-1'),
    /** dashscope 用：阿里云百炼实时识别模型。 */
    dashscopeModel: z.string().default('paraformer-realtime-v2'),
    /** 读取密钥的环境变量名。 */
    apiKeyEnv: z.string().default('DSH_ASR_API_KEY'),
    /** 每片时长（秒）。 */
    chunkSeconds: z.number().default(6),
    lang: z.string().default('zh'),
    /** 本地 whisper 可执行文件（空 = tools/whisper/Release/whisper-cli.exe）。 */
    whisperBin: z.string().default(''),
    /** 本地模型路径（空 = tools/whisper/models/ggml-base.bin）。 */
    whisperModel: z.string().default(''),
    silenceRms: z.number().default(0.004),
    hotwords: z.array(z.string()).default([]),
    vocabularyId: z.string().default(''),
    context: z.string().default(''),
    sentenceSilenceMs: z.number().default(800),
    punctuation: z.boolean().default(true),
    itn: z.boolean().default(true),
    disfluencyRemoval: z.boolean().default(true),
    speakerDiarization: z.boolean().default(false),
    languageHints: z.array(z.string()).default(['zh', 'en']),
    llmCorrect: z.boolean().default(true),
  }),
  /** 后台大脑：转写流 → 判定是否插话（LLM 走 OpenAI 兼容接口，不配则用规则+模板）。 */
  brain: z.object({
    baseUrl: z.string().default(''),
    model: z.string().default(''),
    apiKeyEnv: z.string().default('BRAIN_API_KEY'),
    apiKey: z.string().default(''),
    profile: z.string().default('会议助手'),
    minGapMs: z.number().default(8000),
    /** rules = 只靠关键词触发；llm = 每句都交给模型判断（默认，更准但更费） */
    gate: z.string().default('llm'),
  }),
  /** 支持的会议软件：按进程名识别，插件自动选正在运行的那个。 */
  apps: z.array(z.object({
    name: z.string().default('腾讯会议'),
    proc: z.string().default('wemeetapp'),
    title: z.string().default('腾讯会议'),
    classes: z.string().default('VideoMainWindow|FloatSpeakingWnd|MeetingMainWindow|MeetingView|BaseDialog'),
    path: z.string().default(''),
  })),
  /** 自动监听：检测到会议开始就自动采集+托管，结束后自动出纪要。 */
  autoWatch: z.boolean().default(true),
  /** 入会按钮相对窗口的坐标（0~1）。Qt 自绘界面点不到控件名时用它兜底。 */
  joinClickRatio: z.object({
    x: z.number().default(0.18),
    y: z.number().default(0.28),
  }).default({ x: 0.18, y: 0.28 }),
  /** 自动跟随：哪个会议软件在开会就用哪个（activeApp 为空时生效）。 */
  autoAppSelect: z.boolean().default(true),
  /** 只盯某个会议软件（填 apps 里的 name 或 proc；空 = 任意支持的软件都盯）。 */
  activeApp: z.string().default(''),
  /** 页面/工具里人工确认的会议号；manual=true 时优先于自动识别。 */
  meetingCode: z.string().default(''),
  meetingCodeManual: z.boolean().default(false),
  /** 数字分身：允许把任务交给 DSH 执行（headless）。 */
  twin: z.object({
    enabled: z.boolean().default(true),
    /** 会上被交代任务时，自动起一个 DSH 任务去执行。 */
    autoDelegate: z.boolean().default(true),
    /** 任务完成后是否在会议里播报结果。 */
    reportSpeak: z.boolean().default(true),
    /** 任务结果汇报前先用模型压缩成"总结"，不硬截断。 */
    summarize: z.boolean().default(true),
    /** 会议一开始就建一个 DSH 会话，方便端侧立刻看到。 */
    autoSession: z.boolean().default(true),
    /** dsh 的 profile 名。 */
    profile: z.string().default('headless'),
    /** 单次任务超时（毫秒）。 */
    timeoutMs: z.number().default(180000),
    /** 允许执行的本机 shell 白名单命令前缀（空 = 禁用 shell）。 */
    allowShell: z.array(z.string()).default([]),
  }),
  /** 无人值守：DSH 弹确认卡片时，超时按推荐项自动应答，避免整轮卡死。 */
  autoAnswer: z.object({
    enabled: z.boolean().default(true),
    /** 等多久没人答就自动选（毫秒）。 */
    timeoutMs: z.number().default(5000),
  }),
  /** 会后写回知识库（通过 DSH 的 knowledge 工具完成）。 */
  knowledge: z.object({
    enabled: z.boolean().default(true),
    /** 交给哪个 profile 去写（需要该 profile 装了 dsh-knowledge）。 */
    profile: z.string().default('headless'),
    /** 文档标题前缀。 */
    titlePrefix: z.string().default('会议纪要'),
    /**
     * off       = 完全不碰知识库
     * agent     = 只把纪要存盘并记成待办，由会话里的 agent 用知识库工具写入（默认）
     * headless  = 由插件起一个装了 dsh-knowledge 的 profile 去写（需目标 profile 里也装了知识库）
     */
    mode: z.string().default('host'),
  }),
  /** 会后用人格文件沉淀（USER.md / STATE.md）。 */
  personaAutoUpdate: z.boolean().default(true),
  /** 用户名字：作为默认唤醒词。 */
  userName: z.string().default(''),
  /** 额外唤醒词（覆盖默认推导；留空则用 用户名+称呼+通用词）。 */
  wakeWords: z.array(z.string()).default([]),
  /** 发言策略：observe 只记不说 / suggest 草稿待确认 / auto 自动播报。 */
  policy: z.union(['observe', 'suggest', 'auto']).default('suggest'),
  /** 数据目录（空 = ~/.dsh/soulmirror）。 */
  dataDir: z.string().default(''),
  /** 保留音频切片（默认删）。 */
  keepAudio: z.boolean().default(false),
})

const OUT = (extra = {}) => ({
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      ok: { type: 'boolean', required: true },
      result: { type: 'string', required: true },
      ...extra,
    },
  },
  render: (_a, v) => [{ type: 'text', text: v.result }],
})

export function apply(ctx, config) {
  const logger = ctx.logger
  const cfg = {
    enabled: config.enabled !== false,
    appPath: config.appPath || '',
    windowTitle: config.windowTitle || '腾讯会议',
    windowClass: config.windowClass || 'VideoMainWindow|FloatSpeakingWnd|MeetingMainWindow|MeetingView',
    processName: config.processName || 'wemeetapp',
    devices: { capture: '', captureMode: 'loopback', speak: 'CABLE Input', micName: '', micRestore: '', ...(config.devices || {}) },
    tts: {
      provider: 'dashscope', voice: 'longxiaochun_v2', rate: 0,
      baseUrl: '', model: 'cosyvoice-v2', apiKeyEnv: 'DASHSCOPE_API_KEY', apiKey: '', speed: 1, sampleRate: 16000,
      ...(config.tts || {}),
    },
    brain: { baseUrl: '', model: '', apiKeyEnv: 'BRAIN_API_KEY', apiKey: '', profile: 'SoulMirror', minGapMs: 8000, gate: 'llm', ...(config.brain || {}) },
    twin: { enabled: true, autoDelegate: true, reportSpeak: true, summarize: true, autoSession: true, profile: 'headless', timeoutMs: 180000, allowShell: [], ...(config.twin || {}) },
    autoAnswer: { enabled: true, timeoutMs: 5000, ...(config.autoAnswer || {}) },
    knowledge: { enabled: true, profile: 'headless', titlePrefix: '会议纪要', mode: 'host', ...(config.knowledge || {}) },
    personaAutoUpdate: config.personaAutoUpdate !== false,
    apps: Array.isArray(config.apps) && config.apps.length
      ? config.apps
      : [
        { name: '腾讯会议', proc: 'wemeetapp', title: '腾讯会议', classes: 'VideoMainWindow|FloatSpeakingWnd|MeetingMainWindow|MeetingView|BaseDialog' },
        { name: '移动会议', proc: 'CloudVideo', title: '移动会议', classes: 'VideoMainWindow|MeetingMainWindow|BaseDialog' },
      ],
    asr: {
      provider: 'dashscope', baseUrl: '', model: 'whisper-1', dashscopeModel: 'paraformer-realtime-v2', apiKeyEnv: 'DASHSCOPE_API_KEY', apiKey: '',
      chunkSeconds: 6, lang: 'zh', whisperBin: '', whisperModel: '', silenceRms: 0.004,
      hotwords: [], vocabularyId: '', context: '', sentenceSilenceMs: 800,
      punctuation: true, itn: true, disfluencyRemoval: true, speakerDiarization: false,
      languageHints: ['zh', 'en'], llmCorrect: true, ...(config.asr || {}),
    },
    policy: config.policy || 'suggest',
    autoWatch: config.autoWatch !== false,
    joinClickRatio: { x: 0, y: 0, ...(config.joinClickRatio || {}) },
    autoAppSelect: config.autoAppSelect !== false,
    activeApp: config.activeApp || '',
    meetingCode: config.meetingCode || '',
    meetingCodeManual: config.meetingCodeManual === true,
    userName: config.userName || '',
    wakeWords: Array.isArray(config.wakeWords) ? config.wakeWords : [],
    dataDir: config.dataDir || '',
    keepAudio: config.keepAudio === true,
    silenceRms: (config.asr && config.asr.silenceRms) || 0.004,
  }

  // ── 持久化配置 + 页面 API ────────────────────────────────────────────
  const CONFIG_DIR = join(homedir(), '.dsh', 'soulmirror')
  const CONFIG_FILE = join(CONFIG_DIR, 'config.json')

  function deepMerge(base, patch) {
    const out = { ...base }
    for (const [k, v] of Object.entries(patch || {})) {
      if (v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object') {
        out[k] = { ...base[k], ...v }
      } else if (v !== undefined) {
        out[k] = v
      }
    }
    return out
  }

  let stored = {}
  function loadPersisted() {
    try {
      const raw = readFileSync(CONFIG_FILE, 'utf8').replace(/^\\uFEFF/, '')
      stored = JSON.parse(raw)
      Object.assign(cfg, deepMerge(cfg, stored))
      logger?.info?.('[soulmirror] 已加载持久化配置 ' + CONFIG_FILE)
    } catch { /* 没有就用默认 */ }
  }
  loadPersisted()

  function publicConfig() {
    return {
      enabled: cfg.enabled,
      policy: cfg.policy,
      devices: cfg.devices,
      asr: {
        provider: cfg.asr.provider,
        model: cfg.asr.dashscopeModel,
        baseUrl: cfg.asr.baseUrl,
        apiKeyEnv: cfg.asr.apiKeyEnv,
        apiKey: '',
        keySet: !!(cfg.asr.apiKey || process.env[cfg.asr.apiKeyEnv || 'DASHSCOPE_API_KEY']),
        keySource: cfg.asr.apiKey ? 'config' : (process.env[cfg.asr.apiKeyEnv || 'DASHSCOPE_API_KEY'] ? 'env' : 'none'),
        chunkSeconds: cfg.asr.chunkSeconds,
        lang: cfg.asr.lang,
      },
      tts: {
        provider: cfg.tts.provider,
        model: cfg.tts.model,
        voice: cfg.tts.voice,
        sampleRate: cfg.tts.sampleRate,
        apiKeyEnv: cfg.tts.apiKeyEnv,
        apiKey: '',
        keySet: !!(cfg.tts.apiKey || process.env[cfg.tts.apiKeyEnv || 'DASHSCOPE_API_KEY']),
        keySource: cfg.tts.apiKey ? 'config' : (process.env[cfg.tts.apiKeyEnv || 'DASHSCOPE_API_KEY'] ? 'env' : 'none'),
      },
      brain: {
        baseUrl: cfg.brain.baseUrl,
        model: cfg.brain.model,
        apiKeyEnv: cfg.brain.apiKeyEnv,
        apiKey: '',
        keySet: !!(cfg.brain.apiKey || process.env[cfg.brain.apiKeyEnv || 'BRAIN_API_KEY']),
        keySource: cfg.brain.apiKey ? 'config' : (process.env[cfg.brain.apiKeyEnv || 'BRAIN_API_KEY'] ? 'env' : 'none'),
        profile: cfg.brain.profile || 'SoulMirror',
        minGapMs: cfg.brain.minGapMs,
      },
      apps: cfg.apps || [],
      activeApp: cfg.activeApp || '',
      meetingCode: cfg.meetingCode || '',
      meetingCodeManual: cfg.meetingCodeManual === true,
      userName: cfg.userName || '',
      wakeWords: cfg.wakeWords || [],
      autoWatch: cfg.autoWatch === true,
      extra: cfg._extra || {},
    }
  }

  function savePersisted(patch) {
    const keep = patchToStore(patch)
    // 关键：把历史配置合并进来，别用补丁覆盖整个文件
    stored = deepMerge(stored, keep)
    Object.assign(cfg, deepMerge(cfg, keep))
    try {
      mkdirSync(CONFIG_DIR, { recursive: true })
      writeFileSync(CONFIG_FILE, JSON.stringify(stored, null, 2), 'utf8')
    } catch (e) {
      logger?.warn?.('[soulmirror] 保存配置失败: ' + e.message)
    }
  }

  const EDITABLE = {
    asr: ['provider', 'model', 'dashscopeModel', 'baseUrl', 'apiKeyEnv', 'apiKey', 'chunkSeconds', 'lang'],
    tts: ['provider', 'model', 'voice', 'sampleRate', 'apiKeyEnv', 'apiKey', 'speed'],
    brain: ['baseUrl', 'model', 'apiKeyEnv', 'apiKey', 'profile', 'minGapMs'],
    devices: ['capture', 'captureMode', 'speak', 'micName', 'micRestore', 'micInitiallyMuted'],
  }
  function pick(obj, keys) {
    const out = {}
    for (const k of keys) if (obj && obj[k] !== undefined) out[k] = obj[k]
    return out
  }
  function patchToStore(patch) {
    const keep = {}
    for (const k of ['enabled', 'policy', 'apps', 'activeApp', 'meetingCode', 'meetingCodeManual', 'userName', 'wakeWords', 'autoWatch']) if (patch[k] !== undefined) keep[k] = patch[k]
    for (const k of Object.keys(EDITABLE)) if (patch[k] !== undefined) keep[k] = pick(patch[k], EDITABLE[k])
    return keep
  }

  // webServer 可能在 apply 之后才挂载，轮询拿服务再注册
  const apiHandler = async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://local')
    const sub = url.pathname.replace(/^\/api\/soulmirror\/?/, '')
    const json = (code, data) => {
      res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
      res.end(JSON.stringify(data))
    }
    try {
      if (req.method === 'GET' && (sub === '' || sub === 'config')) return json(200, publicConfig())
      if (req.method === 'GET' && sub === 'status') {
        const liveApp = await detectMeetingApp()
        const codeInfo = await currentMeetingCode(liveApp)
        const statusWins = await listWindows()
        const liveWin = pickMeetingWindows(statusWins, liveApp.title, liveApp.proc)
          .sort((a, b) => (b.w * b.h) - (a.w * a.h))[0]
        return json(200, {
          session: session.snapshot(),
          transcript: session.transcript.slice(-60),
          tasks: (agent.tasks || []).slice(0, 10),
          apps: (cfg.apps || []).map((a) => ({ name: a.name, proc: a.proc || '', active: (cfg.activeApp || '') === a.name })),
          autoAppSelect: cfg.autoAppSelect !== false,
          activeApp: cfg.activeApp || '',
          pendingKnowledge: (agent.pendingKnowledge || []).slice(0, 5),
          world: (() => { try { return living.snapshot() } catch { return null } })(),
          partial: session.partial || '',
          meeting: {
            app: liveApp.name || cfg.activeApp || '全部',
            title: (liveWin && liveWin.title) || lifecycle.lastWindowTitle || '',
            since: lifecycle.startedAt,
            code: codeInfo.code,
            codeSource: codeInfo.source,
            inMeeting: meetingInProgress(liveApp, statusWins),
          },
          models: { asr: cfg.asr.provider + ' / ' + (cfg.asr.dashscopeModel || cfg.asr.model), tts: cfg.tts.provider + ' / ' + cfg.tts.model + ' / ' + cfg.tts.voice },
          devices: { capture: cfg.devices.capture || '默认渲染设备', speak: cfg.devices.speak },
          brain: brain.stats,
          agent,
          mic: mic.state,
          auto: !!(cfg.autoWatch && lifecycle.timer),
          lifecycle: lifecycle.snapshot(),
        })
      }
      if (req.method === 'POST' && sub === 'app') {
        const bufApp = []
        for await (const chunk of req) bufApp.push(chunk)
        const body = JSON.parse(Buffer.concat(bufApp).toString('utf8') || '{}')
        const pickName = String(body.name || '').trim()
        if (!pickName) {
          cfg.activeApp = ''
          cfg.autoAppSelect = true
          savePersisted({ activeApp: '', autoAppSelect: true })
          return json(200, { ok: true, activeApp: '', autoAppSelect: true })
        }
        let hit = (cfg.apps || []).find((x) => x.name === pickName || x.proc === pickName)
        if (!hit) {
          const preset = listPresets().find((x) => x.name === pickName || x.id === pickName || (x.procs || []).includes(pickName))
          if (!preset) return json(400, { ok: false, error: '未知会议软件：' + pickName })
          hit = { name: preset.name, proc: (preset.procs || [])[0] || '', title: preset.name, classes: '' }
          cfg.apps = [...(cfg.apps || []), hit]
          savePersisted({ apps: cfg.apps })
        }
        cfg.activeApp = hit.name
        cfg.autoAppSelect = false
        savePersisted({ activeApp: hit.name, autoAppSelect: false })
        logger?.info?.('[soulmirror] 手动切换会议软件：' + hit.name)
        return json(200, { ok: true, activeApp: hit.name, apps: (cfg.apps || []).map((a) => ({ name: a.name, proc: a.proc || '' })) })
      }
      if (req.method === 'POST' && sub === 'auto') {
        const bufA = []
        for await (const chunk of req) bufA.push(chunk)
        const action = JSON.parse(Buffer.concat(bufA).toString('utf8') || '{}').action
        if (action === 'start') {
          cfg.autoWatch = true
          if (!lifecycle.timer) lifecycle.start()
        } else if (action === 'stop') {
          cfg.autoWatch = false
          lifecycle.stop()
        }
        try { savePersisted({ autoWatch: cfg.autoWatch }) } catch { /* ignore */ }
        return json(200, { ok: true, auto: !!(cfg.autoWatch && lifecycle.timer), lifecycle: lifecycle.snapshot() })
      }
      if (req.method === 'POST' && sub === 'test') {
        const buf = []
        for await (const chunk of req) buf.push(chunk)
        const kind = (JSON.parse(Buffer.concat(buf).toString('utf8') || '{}').kind || 'tts')
        if (kind === 'tts') {
          const key = cfg.tts.apiKey || process.env[cfg.tts.apiKeyEnv || 'DASHSCOPE_API_KEY']
          if (!key) return json(200, { ok: false, error: '未配置 Key' })
          try {
            let bytes = 0
            const s = await synthesizeStream({
              apiKey: key,
              model: cfg.tts.model || 'cosyvoice-v2',
              voice: cfg.tts.voice || 'longxiaochun_v2',
              sampleRate: 16000,
              onAudio: (b) => { bytes += b.length },
            })
            s.speak('测试')
            await s.finish()
            return json(200, { ok: bytes > 0, bytes })
          } catch (e) { return json(200, { ok: false, error: e.message }) }
        }
        if (kind === 'asr') {
          const key = cfg.asr.apiKey || process.env[cfg.asr.apiKeyEnv || 'DASHSCOPE_API_KEY']
          if (!key) return json(200, { ok: false, error: '未配置 Key' })
          try {
            const a = startDashScopeAsr({ apiKey: key, model: cfg.asr.dashscopeModel || 'paraformer-realtime-v2' })
            await a.open()
            await a.finish()
            return json(200, { ok: true })
          } catch (e) { return json(200, { ok: false, error: e.message }) }
        }
        return json(200, { ok: false, error: '未知测试类型' })
      }
      if (req.method === 'POST' && sub === 'config') {
        const buf2 = []
        for await (const chunk of req) buf2.push(chunk)
        const patch = JSON.parse(Buffer.concat(buf2).toString('utf8') || '{}')
        savePersisted(patch)
        return json(200, publicConfig())
      }
      if (req.method === 'POST' && sub === 'meeting') {
        const bufM = []
        for await (const chunk of req) bufM.push(chunk)
        const body = JSON.parse(Buffer.concat(bufM).toString('utf8') || '{}')
        if (body.detect) {
          const app = await detectMeetingApp()
          const code = await detectMeetingCode(app)
          codeCache = { at: Date.now(), app: app.name, code, source: code ? 'auto' : 'none' }
          return json(200, { ok: !!code, app: app.name, code, source: code ? 'auto' : 'none' })
        }
        const code = normalizeMeetingCode(body.code || '')
        const manual = body.manual !== false
        cfg.meetingCode = manual ? code : ''
        cfg.meetingCodeManual = manual && !!code
        codeCache = { at: Date.now(), app: '', code: cfg.meetingCode, source: cfg.meetingCodeManual ? 'manual' : 'none' }
        savePersisted({ meetingCode: cfg.meetingCode, meetingCodeManual: cfg.meetingCodeManual })
        return json(200, { ok: true, code: cfg.meetingCode, source: cfg.meetingCodeManual ? 'manual' : 'none' })
      }
      if (req.method === 'POST' && sub === 'join') {
        const bufJ = []
        for await (const chunk of req) bufJ.push(chunk)
        const body = JSON.parse(Buffer.concat(bufJ).toString('utf8') || '{}')
        const app = await detectMeetingApp(body.app)
        const urlIn = String(body.url || '').trim()
    const code = normalizeMeetingCode(body.code || '') || await detectMeetingCode(app)
    if (!code && !urlIn) return json(200, { ok: false, result: '没有会议号或入会链接' })
        if (!code) return json(200, { ok: false, result: '没有会议号，请先识别或手动输入' })
        cfg.meetingCode = code
        cfg.meetingCodeManual = true
        savePersisted({ meetingCode: code, meetingCodeManual: true })
        const r = await joinTool.execute({ code, app: app.name, displayName: cfg.userName || '', confirm: true })
        return json(200, { ...r, code, app: app.name })
      }
      return json(404, { error: 'not found' })
    } catch (e) {
      return json(500, { error: e.message })
    }
  }

  const api = { registered: false }
  try {
    ctx.webServer.register({ kind: 'prefix', path: '/api/soulmirror', handler: apiHandler })
    api.registered = true
    logger?.info?.('[soulmirror] 配置 API 已注册 /api/soulmirror')
  } catch (e) {
    logger?.warn?.('[soulmirror] 配置 API 注册失败: ' + e.message)
  }


  // ── 当前发言人：读腾讯会议"正在讲话"悬浮窗 ─────────────────────────
  let spkCache = { name: '', at: 0 }
  async function speakerNow() {
    const now = Date.now()
    if (now - spkCache.at < 2000) return spkCache.name
    try {
      const name = await currentSpeaker({ proc: cfg.processName || 'wemeetapp' })
      spkCache = { name: name || '', at: now }
    } catch { spkCache = { name: spkCache.name, at: now } }
    return spkCache.name
  }
  const session = new MeetingSession(cfg, logger)

  /** 把任务结果压成一句口语化总结（不硬截断） */
  async function summarizeTask(prompt, output) {
    const raw = String(output || '').trim()
    if (!raw) return '任务完成，但没有拿到有效结果。'
    if (!completer || cfg.twin.summarize === false) {
      const first = raw.split(/\n+/).filter(Boolean).slice(0, 2).join(' ')
      return '任务完成：' + first
    }
    try {
      const out = await completer([
        { role: 'system', content: '把下面的任务结果压缩成 1-3 句中文口语总结，直接说结论和关键数字，不要客套、不要分点、不要超过 150 字。' },
        { role: 'user', content: '任务：' + prompt + '\n\n结果：\n' + raw.slice(0, 4000) },
      ])
      const clean = String(out || '').trim()
      return clean || ('任务完成：' + raw.slice(0, 80))
    } catch {
      return '任务完成：' + raw.split(/\n+/)[0]
    }
  }

  /** 任务去重键：忽略空白、标点和大小写，避免 ASR 把同一句话重复触发。 */
  function taskKey(text) {
    return String(text || '')
      .toLowerCase()
      .replace(/[\s，。！？、；：,.!?;:'"“”‘’（）()【】\[\]]+/g, '')
      .slice(0, 240)
  }

  /** 后台跑一个 DSH 任务，完成后（可选）在会议里汇报。 */
  async function startTaskInBackground(prompt) {
    const clean = String(prompt || '').trim()
    if (!clean) return null
    const key = taskKey(clean)
    const tasks = agent.tasks || []
    const running = tasks.filter((x) => x.status === 'running').length
    if (running >= 2) {
      logger?.warn?.('[soulmirror] 已有 2 个任务在跑，先排队放弃：' + clean.slice(0, 40))
      return null
    }
    const duplicate = tasks.find((x) => {
      if (taskKey(x.prompt || '') !== key) return false
      if (x.status === 'running') return true
      const at = Date.parse(x.at || '')
      return x.status === 'done' && Number.isFinite(at) && Date.now() - at < 120_000
    })
    if (duplicate) {
      logger?.info?.('[soulmirror] 跳过重复任务（' + duplicate.status + '）：' + clean.slice(0, 40))
      return duplicate
    }
    const ws = ensureMeetingWorkspace()
    const item = {
      at: new Date().toISOString(), prompt: clean, ok: null, status: 'running',
      ms: 0, sessionId: ws.dshSessionId || '', output: '',
    }
    agent.tasks = [item, ...(agent.tasks || [])].slice(0, 20)
    const t0 = Date.now()
    logger?.info?.('[soulmirror] 开始执行任务：' + clean.slice(0, 60))
    const r = await runInMeetingSession(clean, {
      timeoutMs: cfg.twin.timeoutMs,
      onEvent: (ev) => {
        if (ev.stage === 'tool') item.lastTool = ev.name
      },
    }).catch((e) => ({ ok: false, error: e.message }))
    if (r.sessionId) item.sessionId = r.sessionId

    item.ms = Date.now() - t0
    item.ok = !!r.ok
    item.status = r.ok ? 'done' : 'failed'
    item.error = r.error || ''
    item.outcome = r.outcome || null
    item.events = (r.events || []).slice(-15)
    item.via = r.via || ''
    item.sessionId = r.sessionId || item.sessionId
    item.output = String(r.text || r.output || r.error || '').slice(0, 800)
    logger?.info?.('[soulmirror] 任务' + (r.ok ? '完成' : '失败') + '（' + item.ms + 'ms，' + (r.via || '?') + '）' + (r.error ? '：' + String(r.error).slice(0, 120) : ''))
    try {
      const { writeFileSync } = await import('node:fs')
      writeFileSync(join(ws.dir, 'last-task.json'), JSON.stringify(item, null, 1), 'utf8')
    } catch { /* ignore */ }

    if (!r.ok && cfg.twin.reportSpeak) {
      const why = '这个任务没跑成：' + String(r.error || '原因未知').slice(0, 60)
      try {
        addAssistantLine(why, '任务失败')
        brain.markSpoken(why)
        await sayToMeeting(why, cfg.tts, {
          speakDevice: cfg.devices.speak,
          micRestore: cfg.devices.micRestore,
          windowTitle: cfg.windowTitle,
          logger,
        })
      } catch { /* ignore */ }
    }
    if (r.ok && cfg.twin.reportSpeak) {
      // 先等会议安静：有人正在说话就等他说完，再给简要总结
      await waitQuiet(2500, 180000)
      const brief = await summarizeTask(clean, item.output)
      try {
        addAssistantLine(brief, '任务汇报')
        brain.markSpoken(brief)
        await sayToMeeting(brief, cfg.tts, {
          speakDevice: cfg.devices.speak,
          micRestore: cfg.devices.micRestore,
          windowTitle: cfg.windowTitle,
          logger,
        })
        agent.spoken += 1
      } catch (e) {
        logger?.warn?.('[soulmirror] 汇报失败: ' + e.message)
      }
    }
    return item
  }

  /** 把分身的发言写进转写流，面板按角色区分显示。 */
  function addAssistantLine(text, reason = '') {
    const clean = String(text || '').trim()
    if (!clean) return
    const item = { t: new Date().toISOString(), text: clean, role: 'assistant', reason }
    session.transcript.push(item)
    session.partial = ''
    if (session.dir) {
      appendFile(join(session.dir, 'transcript.jsonl'), JSON.stringify(item) + '\n', 'utf8').catch(() => {})
    }
    return item
  }
  // 麦克风状态：UIA 读不到腾讯会议的静音态，只能自己记账
  const mic = { state: cfg.devices.micInitiallyMuted ? 'muted' : 'unmuted' }

  // 只在会议客户端自己的窗口上操作，避免误点其他应用的同名/同类窗口
  setWindowSelector({ cls: cfg.windowClass, proc: cfg.processName })


  // ── 唤醒词：用户名 + 可能的称呼 + 通用词 ────────────────────────────
  function resolveWakeWords() {
    if (cfg.wakeWords && cfg.wakeWords.length) return cfg.wakeWords.filter(Boolean)
    const base = ['DSH', '助手', '会议助手', '小助手']
    const name = (cfg.userName || '').trim()
    if (!name) return base
    const extra = [name]
    if (name.length >= 3) extra.push(name.slice(1))          // 张三丰 → 三丰
    if (name.length >= 2) extra.push(name.slice(-2))          // 张三丰 → 三丰
    return Array.from(new Set([...extra, ...base]))
  }

  /** 当前要盯的会议软件；activeApp 为空表示所有配置里的软件 */
  function activeApps() {
    const all = cfg.apps || []
    const pick = (cfg.activeApp || '').trim()
    if (pick) {
      const hit = all.filter((a) => a.name === pick || a.proc === pick)
      if (hit.length) return hit
    }
    return all
  }

  /** 自动识别当前该盯哪个会议软件（只在没手动指定时生效） */
  async function autoPickApp() {
    if (!cfg.autoAppSelect) return null
    if ((cfg.activeApp || '').trim()) return null
    try {
      const wins = await listWindows()
      const hit = pickAutoApp(wins, cfg.apps || [])
      if (!hit) return null
      cfg.activeApp = hit.app.name
      logger?.info?.('[soulmirror] 自动跟随会议软件：' + hit.app.name + '（' + hit.confidence + '，proc=' + hit.proc + '）')
      try { savePersisted({ activeApp: cfg.activeApp }) } catch { /* ignore */ }
      return hit
    } catch { return null }
  }
  /** 选中一个会议软件（可显式指定），并统一出 title/proc/classes/path 供 UIA 使用。 */
  function meetingApp(requested = '') {
    const all = cfg.apps || []
    const pick = String(requested || cfg.activeApp || '').trim()
    const app = all.find((a) => a.name === pick || a.proc === pick)
      || all.find((a) => a.name === '腾讯会议')
      || all[0]
      || {}
    return {
      name: app.name || '腾讯会议',
      proc: app.proc || cfg.processName || 'wemeetapp',
      title: app.title || cfg.windowTitle || '腾讯会议',
      classes: app.classes || cfg.windowClass || '',
      path: app.path || cfg.appPath || '',
    }
  }
  function meetingOpts(app) {
    return { cls: app.classes, proc: app.proc }
  }

  /** 自动识别当前正在运行的会议软件：显式 app > activeApp > 配置顺序。 */
  async function detectMeetingApp(requested = '') {
    const wins = await listWindows()
    const all = cfg.apps || []
    const preferred = String(requested || cfg.activeApp || '').trim()
    const ordered = []
    if (preferred) {
      for (const app of all) {
        if (app.name === preferred || app.proc === preferred) ordered.push(app)
      }
    }
    for (const app of all) if (!ordered.includes(app)) ordered.push(app)
    for (const app of ordered) {
      const proc = String(app.proc || '').toLowerCase()
      const hit = wins.some((w) => {
        if (proc && String(w.proc || '').toLowerCase() === proc) return true
        const title = String(w.title || '')
        return (app.title && title.includes(app.title)) || (app.name && title.includes(app.name))
      })
      if (hit) return meetingApp(app.name)
    }
    return meetingApp(requested)
  }

  async function clipboardText() {
    if (process.platform !== 'win32') return ''
    try {
      const { stdout } = await execFileAsync('powershell.exe', [
        '-NoProfile',
        '-Command',
        '[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-Clipboard -Raw',
      ], { timeout: 3000, windowsHide: true })
      return String(stdout || '')
    } catch {
      return ''
    }
  }

  function normalizeMeetingCode(text) {
    const raw = String(text || '')
    const patterns = [
      /(?:会议号|会议\s*ID|会议ID|Meeting\s*ID)[：:\s]*([0-9][0-9\s-]{6,}[0-9])/i,
      /\b(\d{3}[\s-]\d{3}[\s-]\d{3,4})\b/,
      /\b(\d{9,11})\b/,
    ]
    for (const re of patterns) {
      const m = raw.match(re)
      if (m) {
        const code = m[1].replace(/[^0-9]/g, '')
        if (code.length >= 8 && code.length <= 12) return code
      }
    }
    return ''
  }

  /** 从窗口标题和剪贴板里找会议号；没有就返回空串。 */
  /** 列出窗口里可点的控件名（诊断 + 模糊匹配） */
  async function listClickableNames(app) {
    try {
      const text = await dump(app.title, 260, meetingOpts(app))
      const out = []
      for (const line of String(text).split(/\r?\n/)) {
        const cols = line.split('\t')
        if (cols.length < 4) continue
        const type = cols[1] || ""
        const name = (cols[2] || "").trim()
        if (!name) continue
        if (!/Button|Group|Text|MenuItem|ListItem/i.test(type)) continue
        if (out.includes(name)) continue
        out.push(name)
        if (out.length >= 40) break
      }
      return out
    } catch { return [] }
  }

  /** 列出可编辑控件（找会议号输入框） */
  async function listEditableNames(app) {
    try {
      const text = await dump(app.title, 260, meetingOpts(app))
      const out = []
      for (const line of String(text).split(/\r?\n/)) {
        const cols = line.split('\t')
        if (cols.length < 4) continue
        const type = cols[1] || ""
        const name = (cols[2] || "").trim()
        const aid = (cols[3] || "").trim()
        if (!/Edit|Document/i.test(type)) continue
        const label = name || aid
        if (!label || out.includes(label)) continue
        out.push(label)
        if (out.length >= 12) break
      }
      return out
    } catch { return [] }
  }

  async function detectMeetingCode(app) {
    // 1) 先看窗口标题，2) 再看界面控件文本，3) 最后看剪贴板
    try {
      const text = await dump(app.title, 320, meetingOpts(app))
      const fromUi = normalizeMeetingCode(String(text || '').replace(/\t/g, ' '))
      if (fromUi) return fromUi
    } catch { /* ignore */ }
    const wins = await listWindows()
    const titles = wins
      .filter((w) => !app.proc || String(w.proc || '').toLowerCase() === String(app.proc).toLowerCase() || String(w.title || '').includes(app.title))
      .map((w) => w.title)
      .join(' ')
    const fromTitle = normalizeMeetingCode(titles)
    if (fromTitle) return fromTitle
    return normalizeMeetingCode(await clipboardText())
  }

  let codeCache = { at: 0, app: '', code: '', source: 'none' }
  async function currentMeetingCode(app) {
    if (cfg.meetingCodeManual && cfg.meetingCode) return { code: cfg.meetingCode, source: 'manual' }
    if (Date.now() - codeCache.at < 4000 && codeCache.app === app.name) return codeCache
    const code = await detectMeetingCode(app)
    codeCache = { at: Date.now(), app: app.name, code, source: code ? 'auto' : 'none' }
    return codeCache
  }

  function meetingInProgress(app, wins) {
    const list = pickMeetingWindows(wins, app.title, app.proc)
    return list.some((w) => {
      // 1) 专用类名（悬浮窗、视频窗、会议视图）
      if (/FloatSpeakingWnd|VideoMainWindow|MeetingView|ParticipantWnd|VideoCellWnd/.test(w.cls)) return true
      // 2) 标题不再是软件名 —— 腾讯会议会把它换成会议主题
      const title = String(w.title || '').trim()
      if (!title) return false
      const appNames = [app.name, app.title].filter(Boolean)
      const isHome = appNames.some((n) => title === n || title === n + ' ')
      return !isHome && !/^wemeetapp$/i.test(title)
    })
  }
  function detectApp(wins) {
    for (const app of activeApps()) {
      if (!app.proc) continue
      const proc = (app.proc || '').toLowerCase()
      const procHit = proc && wins.some((w) => (w.proc || '').toLowerCase() === proc)
      if (procHit) return app
      // proc 没配或对不上时，用窗口标题/类名兜底（移动会议这类自定义客户端常见）
      const nameHit = wins.find((w) => {
        const title = (w.title || '')
        const cls = (w.cls || '')
        return (app.name && title.includes(app.name)) || (app.title && title.includes(app.title)) || (app.name && cls.includes(app.name))
      })
      if (nameHit) {
        app.proc = nameHit.proc
        return app
      }
    }
    return null
  }

  /** 用系统默认方式打开链接（会交给会议客户端处理，不需要点界面） */
  async function openExternal(url) {
    const { spawn } = await import('node:child_process')
    const cmd = process.platform === 'win32'
      ? ['cmd', ['/c', 'start', '', url]]
      : process.platform === 'darwin'
        ? ['open', [url]]
        : ['xdg-open', [url]]
    await new Promise((resolve, reject) => {
      const child = spawn(cmd[0], cmd[1], { detached: true, stdio: 'ignore' })
      child.on('error', reject)
      child.on('spawn', () => { child.unref(); resolve() })
    })
  }

  const wrap = (toolName, impl) => async (args) => {
    try {
      return await impl(args || {})
    } catch (err) {
      logger?.warn?.(`[soulmirror] ${toolName}: ${err.message}`)
      return { ok: false, result: `✗ ${err.message}` }
    }
  }

  // ── 状态 ────────────────────────────────────────────────────────────
  ctx.tools.register(defineTool({
    name: 'meeting_status',
    description: '会议代理状态：识别当前桌面上的会议窗口、音频设备与转写/发言配置是否就绪。操作会议前先调用它确认环境。',
    parameters: {},
    output: OUT({
      windows: {
        type: 'array',
        items: {
          type: 'object', additionalProperties: false,
          properties: { title: { type: 'string' }, cls: { type: 'string' }, pid: { type: 'integer' } },
        },
      },
      inMeeting: { type: 'boolean' },
    }),
    execute: wrap('meeting_status', async () => {
      const app = await detectMeetingApp()
      const wins = await listWindows()
      const codeInfo = await currentMeetingCode(app)
      const meeting = pickMeetingWindows(wins, app.title, app.proc)
      const inMeeting = meeting.some((w) => /FloatSpeakingWnd|VideoMainWindow|MeetingView|ParticipantWnd|VideoCellWnd/.test(w.cls))
      const lines = []
      lines.push(`当前会议软件：${app.name}（${app.proc}）`)
      lines.push(`会议号：${codeInfo.code || '未识别'}${codeInfo.code ? '（' + (codeInfo.source === 'manual' ? '手动' : '自动') + '）' : ''}`)
      lines.push('可用软件：')
      for (const item of cfg.apps || []) {
        const ws = pickMeetingWindows(wins, item.title, item.proc)
        const im = ws.some((w) => /FloatSpeakingWnd|VideoMainWindow|MeetingView|ParticipantWnd|VideoCellWnd/.test(w.cls))
        lines.push(`  ${im ? '[会议中]' : ws.length ? '[运行中]' : '[未运行]'} ${item.name} (${item.proc})`)
      }
      lines.push(`客户端：${resolveAppPath(app.path) || '未找到 ' + app.proc + '.exe'}`)
      lines.push(`会议窗口：${meeting.length} 个${inMeeting ? '（检测到进行中的会议）' : ''}`)
      for (const w of meeting.slice(0, 5)) lines.push(`  · [${w.cls}] ${w.title}`)
      lines.push(`采集：${cfg.devices.capture || '系统默认渲染设备'}（${cfg.devices.captureMode}）`)
      lines.push(`发言设备：${cfg.devices.speak || '未配置（TTS 只会播给扬声器，进不了会议）'}`)
      lines.push(`TTS：${cfg.tts.provider} / ${cfg.tts.voice}`)
      lines.push(`ASR：${cfg.asr.provider === 'none' ? '未配置' : cfg.asr.provider === 'local' ? '本地 whisper.cpp（离线）' : cfg.asr.provider + ' / ' + cfg.asr.baseUrl + ' / ' + cfg.asr.model}`)
      const s = session.snapshot()
      lines.push(`转写：${s.capturing ? '采集中' : '未开始'}，已 ${s.chunks} 片 / ${s.lines} 行${s.lastError ? '，最后错误：' + s.lastError : ''}`)
      return {
        ok: true,
        result: lines.join('\n'),
        windows: meeting.map((w) => ({ title: w.title, cls: w.cls, pid: w.pid })),
        inMeeting,
        code: codeInfo.code,
        codeSource: codeInfo.source,
      }
    }),
  }))

  // ── 设备 ────────────────────────────────────────────────────────────
  ctx.tools.register(defineTool({
    name: 'meeting_devices',
    description: '列出本机音频端点（渲染/采集），用于选择"采会议声音"的设备与"发言"的虚拟声卡。',
    parameters: {},
    output: OUT(),
    execute: wrap('meeting_devices', async () => {
      const devs = await listDevices()
      const lines = devs.map((d) => `${d.flow === 'RENDER' ? '▶' : '●'} ${d.name}`)
      return { ok: true, result: lines.join('\n') || '（未发现音频端点）' }
    }),
  }))

  // ── 桌面 UI 通用操作 ────────────────────────────────────────────────
  ctx.tools.register(defineTool({
    name: 'meeting_ui',
    description:
      '操作桌面会议软件的通用入口（UIAutomation）：list 列窗口 / dump 列控件树 / focus 聚焦 / click 点击（按控件名或 AutomationId 子串）/ key 按键（如 ctrl+m）/ type 输入文字 / settext 设置输入框。遇到不确定的界面，先 dump 看控件再操作。',
    parameters: {
      action: { type: 'string', enum: ['list', 'dump', 'focus', 'click', 'key', 'type', 'settext'], required: true, description: '操作类型。' },
      title: { type: 'string', description: '窗口标题片段，默认取配置里的 windowTitle。' },
      name: { type: 'string', description: 'click/settext 的控件名或 AutomationId 子串。' },
      value: { type: 'string', description: 'settext 的目标文本。' },
      keys: { type: 'string', description: 'key 的按键组合，如 ctrl+m、enter。' },
      text: { type: 'string', description: 'type 的输入文本。' },
      max: { type: 'integer', description: 'dump 最多返回多少控件，默认 60。' },
      app: { type: 'string', description: '会议软件名（可选，如 移动会议）；默认取 activeApp。' },
    },
    output: OUT(),
    execute: wrap('meeting_ui', async (a) => {
      const app = meetingApp(a.app)
      const title = a.title || app.title
      const opts = meetingOpts(app)
      switch (a.action) {
        case 'list': {
          const wins = await listWindows()
          return { ok: true, result: wins.map((w) => `${w.pid}\t[${w.cls}]\t${w.title}`).join('\n') }
        }
        case 'dump': return { ok: true, result: await dump(title, a.max || 60, opts) }
        case 'focus': return { ok: true, result: await focus(title, opts) }
        case 'click': return { ok: true, result: await click(title, a.name || '', opts) }
        case 'settext': return { ok: true, result: await setText(title, a.name || '', a.value || '', opts) }
        case 'key': return { ok: true, result: await pressKey(title, a.keys || '', opts) }
        case 'type': return { ok: true, result: await typeText(title, a.text || '', opts) }
        default: return { ok: false, result: `未知 action: ${a.action}` }
      }
    }),
  }))

  // ── 启动 / 加入 / 离开 ──────────────────────────────────────────────
  ctx.tools.register(defineTool({
    name: 'meeting_open',
    description: '启动会议客户端（已运行则只返回窗口信息），不加入任何会议。',
    parameters: {
      app: { type: 'string', description: '会议软件名（可选，如 移动会议）；默认取 activeApp。' },
    },
    output: OUT(),
    execute: wrap('meeting_open', async (a) => {
      const app = meetingApp(a.app)
      const path = resolveAppPath(app.path)
      if (!path) return { ok: false, result: `未找到 ${app.name} 客户端，请在配置里填写 apps[].path` }
      const r = await ensureApp(path, app.title, app.proc)
      const lines = r.windows.map((w) => `[${w.cls}] ${w.title}`)
      return { ok: true, result: (r.launched ? '已启动：' : '已运行：') + app.name + '\n' + (lines.join('\n') || '(窗口尚未出现)') }
    }),
  }))

  const joinTool = defineTool({
    name: 'meeting_join',
    description:
      '加入会议。优先走入会链接（给 url，或 code 里贴邀请文案）：打开链接即可入会，完全不碰屏幕。只有拿不到链接时才退回界面操作（会议号 → 找入会对话框 → 填号 → 点加入）。必须传 confirm=true。',
    parameters: {
      code: { type: 'string', description: '会议号（如 123-456-789）。用 url 时可不填。' },
      url: { type: 'string', description: '入会链接（https://meeting.tencent.com/dm/… 或整段邀请文案）。给了它就不碰界面，直接打开链接入会。' },
      password: { type: 'string', description: '入会密码（可选）。' },
      displayName: { type: 'string', description: '入会昵称（可选）。' },
      app: { type: 'string', description: '会议软件名（可选，如 移动会议）；默认取 activeApp。' },
      confirm: { type: 'boolean', description: '确认执行，必须为 true。' },
    },
    output: OUT(),
    execute: wrap('meeting_join', async (a) => {
      if (!cfg.enabled) return { ok: false, result: '插件已禁用' }
      if (a.confirm !== true) return { ok: false, result: '拒绝：meeting_join 会操作真实客户端，请传 confirm=true 再执行。' }
      // ── 首选：入会链接（不依赖屏幕）──────────────────────────────
    const rawUrl = String(a.url || '').trim() || extractJoinUrl(a.code || '')
    if (rawUrl && isJoinUrl(rawUrl)) {
      if (a.confirm !== true) return { ok: false, result: '拒绝：打开会议链接会真的入会，请传 confirm=true。' }
      // 这里 app 还没解析，先按参数/自动识别拿一份用于结果判定
      const urlApp = a.app ? meetingApp(a.app) : await detectMeetingApp()
      try {
        await openExternal(rawUrl)
      } catch (e) {
        return { ok: false, result: '打不开链接：' + e.message }
      }
      for (let i = 0; i < 15; i++) {
        await new Promise((r) => setTimeout(r, 1000))
        const wins0 = await listWindows().catch(() => [])
        if (joinedAfterOpening(wins0, urlApp)) return { ok: true, result: '已通过链接入会：' + rawUrl }
      }
      return { ok: false, result: '已打开链接但没检测到入会：' + rawUrl + '\n（可能需要在客户端里确认一下，或链接已过期）' }
    }
    if (!a.code) return { ok: false, result: '缺少会议号（也可以直接给入会链接 url）' }
      const app = a.app ? meetingApp(a.app) : await detectMeetingApp()
      const opts = meetingOpts(app)
      const path = resolveAppPath(app.path)
      if (path) await ensureApp(path, app.title, app.proc)
      await focus(app.title, opts)
      const steps = []
      const cloudVideo = /移动会议|CloudVideo/i.test(app.name + ' ' + app.proc)

      if (cloudVideo) {
        // 移动会议是自绘 Qt 界面。首页的加入按钮和弹窗里的输入框/加入按钮
        // 都能通过 AutomationId 找到，但弹窗不是顶层窗口，必须从主窗口往下找。
        for (let i = 0; i < 2; i++) {
          await pressKey(app.title, 'escape', opts).catch(() => undefined)
          await new Promise((r) => setTimeout(r, 250))
        }
        try {
          steps.push(await click(app.title, '加入会议', opts))
        } catch (e) {
          steps.push('点击首页「加入会议」失败: ' + e.message)
        }
        await new Promise((r) => setTimeout(r, 700))
        try {
          await setText(app.title, 'lineEditLeft', a.code, opts)
          steps.push('已填会议号')
        } catch (e) {
          steps.push('未找到会议号输入框: ' + e.message)
        }
        if (a.displayName) {
          // 移动会议的入会弹窗通常不带昵称输入；保留尝试，失败不阻塞。
          for (const cand of ['昵称', '姓名', 'name', 'lineEditRight']) {
            try { await setText(app.title, cand, a.displayName, opts); steps.push('已填昵称'); break } catch { /* next */ }
          }
        }
        try {
          steps.push(await click(app.title, 'MeetJoinClass.widget.pushButton', opts))
        } catch (e) {
          steps.push('点击弹窗「加入会议」失败: ' + e.message)
        }
        await new Promise((r) => setTimeout(r, 2500))
        const text = await dump(app.title, 220, opts).catch(() => '')
        const errLine = text.split(/\r?\n/).find((l) => /会议已结束|会议不存在|HY\d{4,}/.test(l))
        const err = errLine ? (errLine.split('\t')[2] || errLine) : ''
        const wins = await listWindows()
        const joined = wins.some((w) => w.proc === app.proc && /ParticipantWnd|VideoCellWnd/.test(w.cls))
        if (err) {
          await click(app.title, 'Close', opts).catch(() => undefined)
          return { ok: false, result: steps.join('\n') + '\n移动会议返回：' + err }
        }
        return { ok: true, result: steps.join('\n') + '\n' + (joined ? '已进入会议' : '尚未确认进入会议，可用 meeting_status 复查') }
      }

    // 腾讯会议首页是 Qt 自绘：「加入会议」按钮点不到名字，只能按客户区相对坐标点。
    // 点开后会弹出「加入会议」对话框，那里面的控件都是有名字的。
    const JOIN_DIALOG = '加入会议'
    const dialogOpen = async () => {
      const wins = await listWindows().catch(() => [])
      return wins.some((w) => w.proc === app.proc && /JoinMeetingDialog/.test(w.cls || ''))
    }

    // 已在对话框里就不重复点首页，避免关掉它
    let opened = await dialogOpen()
    if (opened) steps.push('入会对话框已打开')

    if (!opened) {
      // 先试具名按钮（有的版本会暴露），失败再按比例点
      for (const cand of ['加入会议', '加入', 'Join']) {
        try {
          await click(app.title, cand, opts)
          await new Promise((r) => setTimeout(r, 600))
          if (await dialogOpen()) { opened = true; steps.push('已点「' + cand + '」'); break }
        } catch { /* next */ }
      }
    }

    if (!opened) {
      // 坐标不写死：查标定表；没有就返回"去标定"，绝不盲点
      const saved = uiMap.get(app.name, 'join')
      if (!saved) {
        steps.push('首页按钮没有可点的控件名，也还没有标定过坐标')
        steps.push('跑一次 meeting_calibrate 截图，看完图用 meeting_set_ui_map 存下「加入会议」位置即可')
        return { ok: false, result: steps.join('\n') }
      }
      // 点一次 → 验证 → 失败就在附近小范围重试
      for (const off of probeOffsets(0.02, 2)) {
        const rx = saved.x + off.dx
        const ry = saved.y + off.dy
        if (!validRatio(rx, ry)) continue
        try {
          const hit = await clickRatio(app.title, rx, ry, opts)
          await new Promise((r) => setTimeout(r, 900))
          if (await dialogOpen()) {
            opened = true
            if (off.dx || off.dy) {
              // 记住修正后的位置，下次一步到位
              uiMap.set(app.name, 'join', { x: rx, y: ry }, { via: 'probe' })
              steps.push('标定位置有偏移，已修正到 ' + rx.toFixed(3) + ', ' + ry.toFixed(3))
            }
            steps.push('已按标定坐标打开入会对话框（' + rx.toFixed(3) + ', ' + ry.toFixed(3) + ' → ' + hit.x + ',' + hit.y + '）')
            break
          }
        } catch (e) {
          steps.push('点击失败: ' + e.message)
          break
        }
      }
    }

    if (!opened) {
      const names = await listClickableNames(app)
      steps.push('没能打开入会对话框。首页可见控件：' + (names.slice(0, 10).join(' / ') || '（读不到）'))
      steps.push('排查：确认会议客户端停在首页（不是已入会状态），或调 config.joinClickRatio')
      return { ok: false, result: steps.join('\n') }
    }

    // 对话框里：会议号 → 昵称 → 自动连音频 → 加入
    let filled = false
    for (const cand of ['请输入会议号', 'meeting_code', '会议号']) {
      try {
        await setText(JOIN_DIALOG, cand, a.code, opts)
        filled = true
        steps.push('已填会议号(' + cand + ')')
        break
      } catch { /* next */ }
    }
    if (!filled) steps.push('没找到会议号输入框')

    if (a.displayName) {
      for (const cand of ['请输入您的名字', 'nick_name', '您的名称']) {
        try { await setText(JOIN_DIALOG, cand, a.displayName, opts); steps.push('已填昵称'); break } catch { /* next */ }
      }
    }

    // 自动连接音频：入会就有声音，否则采集到的是静音
    try { await click(JOIN_DIALOG, '自动连接音频', opts); steps.push('已勾选自动连接音频') } catch { /* 已勾选或不存在 */ }

    let confirmed = false
    for (const cand of ['加入会议', 'join_meeting_btn', '加入']) {
      try { await click(JOIN_DIALOG, cand, opts); confirmed = true; steps.push('已点「' + cand + '」'); break } catch { /* next */ }
    }
    if (!confirmed) {
      try { await pressKey(JOIN_DIALOG, 'Return', opts); steps.push('已回车提交（兜底）') } catch { /* ignore */ }
    }

    await new Promise((r) => setTimeout(r, 3000))
    const wins = await listWindows()
    const joined = meetingInProgress(app, wins)
    // 入会失败常见于会议号不存在/已结束，读一下对话框里的提示
    const text = joined ? '' : await dump(JOIN_DIALOG, 120, opts).catch(() => '')
    const errLine = String(text).split(/\r?\n/).find((l) => /会议号|不存在|已结束|错误|无效/.test(l))
    if (!joined) {
      try { await pressKey(JOIN_DIALOG, 'escape', opts); steps.push('已按 Esc 关闭对话框') } catch { /* ignore */ }
    }
    return { ok: joined, result: steps.join('\n') + '\n' + (joined ? '已进入会议' : '尚未确认进入会议' + (errLine ? '\n客户端提示：' + errLine.split('\t').slice(1, 3).join(' ') : '；可用 meeting_status 复查')) }
    }),
  })
  ctx.tools.register(joinTool)

  ctx.tools.register(defineTool({
    name: 'meeting_auto_join',
    description:
      '自动加入会议：先识别正在运行的腾讯会议/移动会议，再从剪贴板或窗口标题读取会议号，然后调用 meeting_join。会议号也可显式传入。必须传 confirm=true。',
    parameters: {
      code: { type: 'string', description: '会议号（可选；不填则从剪贴板/窗口标题识别）' },
      app: { type: 'string', description: '会议软件名（可选，如 移动会议）；不填则自动识别' },
      confirm: { type: 'boolean', description: '确认执行，必须为 true。' },
    },
    output: OUT(),
    execute: wrap('meeting_auto_join', async (a) => {
      if (a.confirm !== true) return { ok: false, result: '拒绝：meeting_auto_join 会操作真实客户端，请传 confirm=true 再执行。' }
      const app = await detectMeetingApp(a.app)
      const code = String(a.code || '').trim() || (cfg.meetingCodeManual ? cfg.meetingCode : '') || await detectMeetingCode(app)
      if (!code) {
        return { ok: false, result: `已识别：${app.name}\n但剪贴板/窗口标题里没有会议号。请复制会议号或会议链接后重试，或显式传 code。` }
      }
      const wins = await listWindows()
      if (meetingInProgress(app, wins)) {
        return { ok: false, result: `已识别：${app.name}，会议号 ${code}\n但当前已经在会议中，请先 meeting_leave 再自动加入。` }
      }
      const r = await joinTool.execute({ code, app: app.name, confirm: true })
      return { ok: !!r.ok, result: `已识别：${app.name}\n会议号：${code}\n${r.result || ''}` }
    }),
  }))

  ctx.tools.register(defineTool({
    name: 'meeting_leave',
    description: '离开当前会议（点「离开」→ 确认）。必须传 confirm=true。',
    parameters: {
      app: { type: 'string', description: '会议软件名（可选，如 移动会议）；默认取 activeApp。' },
      confirm: { type: 'boolean', description: '确认执行，必须为 true。' },
    },
    output: OUT(),
    execute: wrap('meeting_leave', async (a) => {
      if (a.confirm !== true) return { ok: false, result: '拒绝：请传 confirm=true。' }
      const app = a.app ? meetingApp(a.app) : await detectMeetingApp()
      const opts = meetingOpts(app)
      await session.stopCapture().catch(() => undefined)
      const steps = []
      for (const cand of ['离开会议', '离开', '结束会议']) {
        try { await click(app.title, cand, opts); steps.push('点了「' + cand + '」'); break } catch { /* next */ }
      }
      await new Promise((r) => setTimeout(r, 600))
      for (const cand of ['离开会议', '确定', '离开']) {
        try { await click(app.title, cand, opts); steps.push('确认「' + cand + '」'); break } catch { /* next */ }
      }
      if (steps.length === 0 && /移动会议|CloudVideo/i.test(app.name + ' ' + app.proc)) {
        // 移动会议的自绘会议窗口没有可读的离开按钮；关闭窗口即离开。
        await pressKey(app.title, 'alt+f4', opts).catch(() => undefined)
        steps.push('未找到离开按钮，已用 Alt+F4 关闭移动会议窗口')
      }
      return { ok: true, result: steps.join('\n') || '未找到离开按钮，请用 meeting_ui dump 查看' }
    }),
  }))

  // ── 麦克风 ──────────────────────────────────────────────────────────
  ctx.tools.register(defineTool({
    name: 'meeting_set_mute',
    description: '开/闭会议麦克风：点击会议窗口里的麦克风控件（按 mic 关键字匹配 AutomationId）。必须传 confirm=true。',
    parameters: {
      state: { type: 'string', enum: ['mute', 'unmute', 'toggle'], description: '目标状态，默认 toggle。' },
      app: { type: 'string', description: '会议软件名（可选，如 移动会议）；默认取 activeApp。' },
      confirm: { type: 'boolean', description: '确认执行，必须为 true。' },
    },
    output: OUT(),
    execute: wrap('meeting_set_mute', async (a) => {
      if (a.confirm !== true) return { ok: false, result: '拒绝：开关麦克风会影响真实会议，请传 confirm=true。' }
      const app = meetingApp(a.app)
      const opts = meetingOpts(app)
      const text = await dump(app.title, 200, opts)
      const micLines = text.split(/\r?\n/).filter((l) => /mic/i.test(l) && /Button/i.test(l))
      if (micLines.length === 0) return { ok: false, result: '没找到麦克风控件，请用 meeting_ui dump 确认控件树' }
      const r = await click(app.title, 'mic', opts)
      mic.state = mic.state === 'muted' ? 'unmuted' : 'muted'
      return { ok: true, result: '点击麦克风控件：' + micLines[0].split('\t').slice(1, 3).join(' ') + '\n' + r + '\n当前记录状态：' + mic.state }
    }),
  }))

  // ── 采集与转写 ──────────────────────────────────────────────────────
  ctx.tools.register(defineTool({
    name: 'meeting_capture_start',
    description: '开始采集会议声音并分批转写（需先配置 ASR）。采集的是所选渲染设备的环回音频，不录摄像头。',
    parameters: { label: { type: 'string', description: '本次会话标签（可选）。' } },
    output: OUT(),
    execute: wrap('meeting_capture_start', async (a) => {
      if (cfg.asr.provider === 'none') {
        return {
          ok: false,
          result: '拒绝启动：ASR 未配置（asr.provider=none），采下来也无法转写。\n'
            + '请先设置 asr.provider=openai、asr.baseUrl（OpenAI 兼容网关）、asr.model 与密钥环境变量 asr.apiKeyEnv。',
        }
      }
      const r = await session.startCapture(a.label)
      return { ok: true, result: `已开始采集 → ${r.dir}` }
    }),
  }))

  ctx.tools.register(defineTool({
    name: 'meeting_capture_stop',
    description: '停止采集与转写。',
    parameters: {},
    output: OUT(),
    execute: wrap('meeting_capture_stop', async () => {
      const r = await session.stopCapture()
      return { ok: true, result: `已停止，共 ${r.chunks} 片，目录 ${r.dir || '-'}` }
    }),
  }))

  ctx.tools.register(defineTool({
    name: 'meeting_transcript',
    description: '读取当前/本次会议的转写文本（最近 N 行）。',
    parameters: {
      limit: { type: 'integer', description: '返回最近多少行，默认 30。' },
      since_ms: { type: 'integer', description: '只取该毫秒时间戳之后的（可选）。' },
    },
    output: OUT(),
    execute: wrap('meeting_transcript', async (a) => ({
      ok: true,
      result: session.formatTranscript(a.limit || 30, a.since_ms || 0),
    })),
  }))

  // ── 发言 ────────────────────────────────────────────────────────────
  ctx.tools.register(defineTool({
    name: 'meeting_say',
    description:
      '用 TTS 说一句话：合成 16k WAV → 播放到配置的虚拟声卡输入端点（会议麦克风收到）→ 可选自动开麦/闭麦。未配置 devices.speak 时只会播到扬声器，请先用 meeting_devices 选择虚拟声卡。',
    parameters: {
      text: { type: 'string', required: true, description: '要说的话。' },
      unmute: { type: 'boolean', description: '播放前解除静音（默认 false）。' },
      mute_after: { type: 'boolean', description: '播放后重新静音（默认 false）。' },
    },
    output: OUT(),
    execute: wrap('meeting_say', async (a) => {
      if (!cfg.enabled) return { ok: false, result: '插件已禁用' }
      if (cfg.policy === 'observe') return { ok: false, result: '当前 policy=observe（只记不说），如需发言请切到 suggest/auto' }
      const steps = []
      let unmuted = false
      if (cfg.devices.speak && mic.state !== 'unmuted') {
        try { await toggleMic(cfg.windowTitle, { cls: cfg.windowClass, proc: cfg.processName }); mic.state = 'unmuted'; unmuted = true; steps.push('已开麦') } catch (e) { steps.push('开麦失败: ' + e.message) }
      }
      if (a.unmute) {
        try { await click(cfg.windowTitle, 'mic'); steps.push('已开麦') } catch (e) { steps.push('开麦失败: ' + e.message) }
        await new Promise((r) => setTimeout(r, 400))
      }
      const useMeeting = !!(cfg.devices.speak && cfg.devices.micRestore)
      const t0 = Date.now()
      const r = useMeeting
        ? await sayToMeeting(a.text, cfg.tts, {
          speakDevice: cfg.devices.speak,
          micRestore: cfg.devices.micRestore,
          windowTitle: cfg.windowTitle,
          logger,
        })
        : await speak(a.text, cfg.tts, { device: cfg.devices.speak })
      steps.push('按住空格发言：' + (r.ptt ? '是' : '否'))
      steps.push(useMeeting
        ? `已送进会议（${Date.now() - t0}ms，${r.mode}${r.verified ? '，设备已跟随' : ''}）`
        : `已播放 → ${cfg.devices.speak || '系统默认设备'}（${r.mode}）`)
      if (a.mute_after || unmuted) {
        try { await click(cfg.windowTitle, 'mic'); steps.push('已闭麦') } catch (e) { steps.push('闭麦失败: ' + e.message) }
      }
      const warn = cfg.devices.speak ? '' : '\n⚠ 未配置虚拟声卡：声音只播到本机扬声器，会议里听不到。'
      return { ok: true, result: steps.join('；') + warn }
    }),
  }))


  // ── 探测哪个设备有声音 ──────────────────────────────────────────────
  ctx.tools.register(defineTool({
    name: 'meeting_probe_audio',
    description: '逐个环回采集每个渲染设备 N 秒并计算音量，用来判断"会议声音到底从哪个设备出"。选出声的那个填进 devices.capture，再开采集。',
    parameters: { seconds: { type: 'integer', description: '每个设备采多久，默认 3 秒。' } },
    output: OUT(),
    execute: wrap('meeting_probe_audio', async (a) => {
      const seconds = Math.max(2, Math.min(10, a.seconds || 3))
      const devs = (await listDevices()).filter((d) => d.flow === 'RENDER')
      if (devs.length === 0) return { ok: false, result: '没有可用的渲染设备' }
      const tmp = join(session.dataRoot() || '.', '_probe')
      await mkdir(tmp, { recursive: true })
      const rows = []
      let best = ''
      let bestRms = 0
      for (const d of devs) {
        const wav = join(tmp, 'probe-' + d.index + '.wav')
        let rms = -1
        let err = ''
        try {
          await bridge(['capture', '--out', wav, '--seconds', String(seconds), '--mode', 'loopback', '--device', d.name],
            { timeoutMs: (seconds + 12) * 1000 })
          const out = await bridge(['rms', '--file', wav], { timeoutMs: 15000 })
          const m = /RMS\s+([0-9.]+)/.exec(out)
          if (m) rms = Number(m[1])
        } catch (e) { err = e.message }
        if (rms > bestRms) { bestRms = rms; best = d.name }
        rows.push((rms >= 0.004 ? '[有声] ' : '[静音] ') + d.name + '  RMS=' + (rms >= 0 ? rms.toFixed(4) : 'n/a') + (err ? '  错误:' + err.slice(0, 60) : ''))
      }
      const tail = bestRms >= 0.004
        ? '\n建议：devices.capture = ' + best
        : '\n所有设备都静音：确认会议正在出声（未静音、有人在说话），或检查会议客户端的扬声器设备。'
      return { ok: true, result: rows.join('\n') + tail }
    }),
  }))
  // ── 实时电平（判断会议此刻有没有出声）────────────────────────────────
  ctx.tools.register(defineTool({
    name: 'meeting_levels',
    description: '读每个渲染设备的实时峰值（200ms 内采样），秒级判断"现在有没有声音、在哪个设备"。比采集探测快，不落盘。',
    parameters: {},
    output: OUT(),
    execute: wrap('meeting_levels', async () => {
      const out = await bridge(['meters'], { timeoutMs: 20000 })
      const rows = []
      let loud = ''
      let max = 0
      for (const line of out.split(/\r?\n/)) {
        const parts = line.split('\t')
        if (parts.length < 2) continue
        const peak = Number(parts[1])
        if (peak > max) { max = peak; loud = parts[0] }
        rows.push((peak >= 0.004 ? '[有声] ' : '[静音] ') + parts[0] + '  peak=' + parts[1])
      }
      const tail = max >= 0.004
        ? '\n当前有声音：' + loud
        : '\n当前所有渲染设备都没有声音：会议静音 / 没人说话 / 声音去了别的设备。'
      return { ok: true, result: rows.join('\n') + tail }
    }),
  }))
  // ── 后台大脑：实时听 → 判断 → 自动回复 ─────────────────────────────
  // ── 人格与长期记忆（四层文件 + JSON 记忆库）──────────────────────────
  // ── 会议工作区：一场会议 = 一个目录 + 一个 DSH session ───────────────
  const workspaceRoot = join(CONFIG_DIR, 'workspace')
  let meeting = { id: '', dir: '', dshSessionId: '', startedAt: '', key: '', display: '' }
  const sessionMap = new SessionMap(join(CONFIG_DIR, 'sessions.json'))
  let meetingIdOverride = ''

  /** 以会议身份为准：显式 id > 标题里的会议号 > 标题 */
  function currentMeetingKey(title) {
    const ttl = title || lifecycle?.lastWindowTitle || ''
    return deriveMeetingKey({ explicit: meetingIdOverride, title: ttl })
  }

  function ensureMeetingWorkspace(label = '', title = '') {
    if (meeting.id) return meeting
    const ident = currentMeetingKey(title)
    const winTitle = title || lifecycle?.lastWindowTitle || ''
    const hit = (cfg.apps || []).find((x) => x.name && winTitle.includes(x.name))
      || (cfg.apps || []).find((x) => x.title && winTitle.includes(x.title))
    const appPrefix = (cfg.activeApp || (hit && hit.name) || '').trim()
    if (appPrefix && ident.key && !ident.key.includes(':')) ident.key = appPrefix + ':' + ident.key
    const key = ident.key || ('time:' + new Date().toISOString().slice(0, 16))
    const prev = sessionMap.get(key)
    const now = new Date().toISOString()
    meeting = {
      id: safeName(key),
      key,
      display: ident.display || label || key,
      dir: join(workspaceRoot, safeName(key)),
      dshSessionId: prev?.dshSessionId || '',
      startedAt: now,
    }
    try { mkdirSync(meeting.dir, { recursive: true }) } catch { /* ignore */ }
    sessionMap.set(key, {
      dshSessionId: meeting.dshSessionId,
      dir: meeting.dir,
      title: meeting.display,
      source: ident.source,
      lastStarted: now,
    })
    return meeting
  }

  function resetMeetingWorkspace() {
    meeting = { id: '', dir: '', dshSessionId: '', startedAt: '', key: '', display: '' }
  }

  let sessionBootstrapping = null
  /** 会议一开始就建一个 DSH 会话（跑一句极短任务拿 sessionId），端侧立刻可见 */
  /**
   * 在会议会话里跑一轮：优先用宿主内的 sessionController（会话在界面上可见），
   * 拿不到再回退到 headless 子进程。
   */
  async function runInMeetingSession(prompt, { title, timeoutMs, onEvent } = {}) {
    const ws = ensureMeetingWorkspace('', lifecycle?.lastWindowTitle || '')
    // 会议会话是长期复用的，历史里还留着之前的任务。每轮都明确“只做这一条”，
    // 否则模型看到旧任务后会重复查资料、重复总结、重复汇报。
    const guarded = `[本轮任务]\n只执行下面这一条；本会话里之前已经完成或汇报过的任务不要重做、不要重复汇报。历史消息只作上下文参考。\n\n${prompt}`
    const controller = getController(ctx)
    if (controller) {
      try {
        if (!ws.dshSessionId) {
          ws.dshSessionId = await createSession(ctx, {
            cwd: ws.dir,
            title: title || (ws.display ? '会议 · ' + ws.display : '会议'),
          })
          sessionMap.set(ws.key || ws.id, { dshSessionId: ws.dshSessionId, dir: ws.dir, title: ws.display })
          logger?.info?.('[soulmirror] 已建会话（宿主内）' + ws.dshSessionId)
        }
        const r = await promptSession(ctx, ws.dshSessionId, guarded, { timeoutMs, onEvent })
        return {
          ok: r.ok,
          text: r.text,
          error: r.error,
          sessionId: ws.dshSessionId,
          via: 'in-process',
          outcome: r.outcome || null,
          events: r.events || [],
          tools: r.tools || [],
        }
      } catch (e) {
        logger?.warn?.('[soulmirror] 宿主内会话失败，回退 headless：' + e.message)
      }
    }
    const r = await runDshTask(guarded, { profile: cfg.twin.profile, cwd: ws.dir, sessionId: ws.dshSessionId || undefined, timeoutMs })
    if (r.sessionId) {
      ws.dshSessionId = r.sessionId
      sessionMap.set(ws.key || ws.id, { dshSessionId: r.sessionId, dir: ws.dir, title: ws.display })
    }
    return { ok: r.ok, text: r.text, error: r.error, sessionId: r.sessionId, via: 'headless' }
  }

  /** 会议一开始就建一个 DSH 会话（宿主内创建，界面立即可见，不花模型调用） */
  async function ensureMeetingSession(reason = '', title = '') {
    if (cfg.twin.enabled === false) return ''
    const ws = ensureMeetingWorkspace(reason, title)
    if (ws.dshSessionId) return ws.dshSessionId
    if (sessionBootstrapping) return sessionBootstrapping
    sessionBootstrapping = (async () => {
      try {
        const controller = getController(ctx)
        if (controller) {
          ws.dshSessionId = await createSession(ctx, {
            cwd: ws.dir,
            title: ws.display ? '会议 · ' + ws.display : '会议',
          })
          sessionMap.set(ws.key || ws.id, { dshSessionId: ws.dshSessionId, dir: ws.dir, title: ws.display })
          logger?.info?.('[soulmirror] 已创建会议会话（宿主内）' + ws.dshSessionId)
          return ws.dshSessionId
        }
      } catch (e) {
        logger?.warn?.('[soulmirror] 宿主内建会话失败：' + e.message)
      } finally {
        sessionBootstrapping = null
      }
      // 回退：headless 建会话
      if (cfg.twin.autoSession === false) return ''
      try {
        const r = await runDshTask('会议开始。用一句话确认你已就位。', {
          profile: cfg.twin.profile,
          cwd: ws.dir,
          timeoutMs: Math.min(cfg.twin.timeoutMs, 60000),
        })
        if (r.sessionId) {
          ws.dshSessionId = r.sessionId
          sessionMap.set(ws.key || ws.id, { dshSessionId: r.sessionId, dir: ws.dir, title: ws.display })
          return r.sessionId
        }
      } catch (e) {
        logger?.warn?.('[soulmirror] headless 建会话失败: ' + e.message)
      }
      return ''
    })()
    return sessionBootstrapping
  }

  const personaDir = join(CONFIG_DIR, 'persona')
  const memory = new MemoryStore(join(CONFIG_DIR, 'memory.json'), { maxEntries: 2000 })
  const uiMap = new UiMap(join(CONFIG_DIR, 'uimap.json'))
  const calibDir = join(CONFIG_DIR, 'calib')
  const living = new LivingWorld(join(CONFIG_DIR, 'living'))
  let personaAt = 0
  let personaCache = ''
  function currentPersona() {
    const now = Date.now()
    if (now - personaAt < 1500 && personaCache) return personaCache
    try { personaCache = personaBlock(loadPersona(personaDir)) } catch { personaCache = '' }
    personaAt = now
    return personaCache
  }

  const brain = new MeetingBrain({ minGapMs: cfg.brain.minGapMs, names: resolveWakeWords() })

  // ── ASR 纠错：用大模型把同音错字改回正确人名/术语 ──────────────
  const fixNames = Array.from(new Set([cfg.userName, ...(cfg.wakeWords || []), ...((cfg.apps || []).map((a) => a.name))].filter(Boolean)))

  const completer = createCompleter(cfg.brain)

  // 注意：必须在 completer 初始化之后再装配纠错器，否则会踩 TDZ
  session.correctText = (cfg.asr.llmCorrect === false || !completer)
    ? null
    : makeCorrector({ names: fixNames, context: (cfg.asr.context || '') + (currentPersona() ? '\n' + currentPersona().slice(0, 800) : ''), completer })
  const agent = { running: false, lastDecision: null, spoken: 0, errors: 0 }

  // ── 谁在说话：用于「有人说话就等他说完」 ─────────────────────────────
  let lastSpeechAt = 0
  function noteSpeech() { lastSpeechAt = Date.now() }
  function speechBusy(quietMs = 2500) {
    return Date.now() - lastSpeechAt < quietMs
  }
  /** 等会议安静下来再说；最多等 maxWaitMs，超时照说 */
  async function waitQuiet(quietMs = 2500, maxWaitMs = 180000) {
    const t0 = Date.now()
    while (speechBusy(quietMs) && Date.now() - t0 < maxWaitMs) {
      await new Promise((r) => setTimeout(r, 500))
    }
    const waited = Date.now() - t0
    if (waited > 800) logger?.info?.('[soulmirror] 等安静 ' + Math.round(waited / 1000) + 's 后播报')
    return waited
  }

  session.acceptLine = () => Date.now() >= brain.muteUntil
  /** 决策落地：先表态 → 后台跑任务 → 说完再汇报 */
  async function applyDecision(d, item) {
    agent.lastDecision = { at: new Date().toISOString(), text: (item.text || "").slice(0, 60), ...d }
    logger?.info?.('[soulmirror] 决策: speak=' + d.speak + " task=" + (d.task ? "有" : "无") + " / " + d.reason)
    const wantTask = !!(d.task && cfg.twin.enabled && cfg.twin.autoDelegate)
    if (wantTask) {
      startTaskInBackground(d.task).catch((e) => logger?.warn?.('[soulmirror] 任务异常: ' + e.message))
    }
    if (!d.speak || !d.text) return
    if (cfg.policy !== 'auto') return
    await waitQuiet(2500, 120000)
    brain.markSpoken(d.text)
    let unmutedByUs = false
    if (cfg.devices.speak && mic.state !== 'unmuted') {
      try {
        await toggleMic(cfg.windowTitle, { cls: cfg.windowClass, proc: cfg.processName })
        mic.state = 'unmuted'
        unmutedByUs = true
      } catch (e) { logger?.warn?.('开麦失败: ' + e.message) }
    }
    try {
      await sayToMeeting(d.text, cfg.tts, {
        speakDevice: cfg.devices.speak,
        micRestore: cfg.devices.micRestore,
        windowTitle: cfg.windowTitle,
        logger,
      })
      brain.muteUntil = Date.now() + 1500
      agent.spoken += 1
      addAssistantLine(d.text, d.reason)
      try { memory.add({ role: 'assistant', text: d.text, session: session.dir }) } catch { /* ignore */ }
    } catch (e) {
      agent.errors += 1
      logger?.warn?.('[soulmirror] 自动回复失败: ' + e.message)
    } finally {
      if (unmutedByUs) {
        try {
          await toggleMic(cfg.windowTitle, { cls: cfg.windowClass, proc: cfg.processName })
          mic.state = 'muted'
        } catch { /* ignore */ }
      }
    }
  }

  session.onLine = async (item) => {
    noteSpeech()
    try {
      const spk = await speakerNow()
      if (spk) item.speaker = spk
    } catch { /* ignore */ }
    if (!agent.running) return
    try { memory.add({ role: 'user', text: item.text, session: session.dir }) } catch { /* ignore */ }
    try { living.absorb(item.text, { speaker: item.speaker || '', source: 'meeting' }) } catch { /* ignore */ }
    const trig = brain.push(item)
    if (!trig && cfg.brain.gate !== 'llm') return
    // gate=llm：不靠关键字，整句+上下文交给模型判断要不要接
    const trigger = trig || { kind: 'context', reason: '新转写', line: item, confidence: 0.5 }
    if (!trig) logger?.info?.('[soulmirror] 规则未命中，交给模型判定')
    const d = await brain.decide(trigger, { complete: completer, profile: cfg.brain.profile || 'SoulMirror', persona: currentPersona(), memory: memory.digest(8) })
    // 兜底：问自身环境/外部事实但模型没给 task 时，强制委派
    if (!d.task && cfg.twin.enabled && cfg.twin.autoDelegate) {
      const FACT_RE = /插件|工具|能力|配置|安装|版本|几点|时间|天气|日程|汇率|股价|新闻|查一下|看一下|帮我查|告诉我/
      const SELF_RE = /你(自己|这边|现在|安装了|有哪些|能|会)|你的(插件|工具|能力|配置)/
      if (FACT_RE.test(item.text) && (SELF_RE.test(item.text) || /帮我|看一下|查一下|告诉我/.test(item.text))) {
        d.task = item.text
        if (!d.text) d.text = '收到，我去查，稍后告诉你。'
      }
    }
    await applyDecision(d, item)
  }
  ctx.tools.register(defineTool({
    name: 'meeting_agent_start',
    description: '开启后台会议大脑：持续采集会议声音 → 转写 → 判断是否该插话 → policy=auto 时自动用 TTS 回复（流式）。',
    parameters: { label: { type: 'string', description: '会话标签（可选）。' } },
    output: OUT(),
    execute: wrap('meeting_agent_start', async (a) => {
      if (cfg.asr.provider === 'none') return { ok: false, result: 'ASR 未配置，无法开启' }
      if (cfg.asr.provider === 'dashscope') {
        const key = cfg.asr.apiKey || process.env[cfg.asr.apiKeyEnv || 'DASHSCOPE_API_KEY']
        if (!key) {
          return { ok: false, result: '缺少 DashScope Key：环境变量 ' + (cfg.asr.apiKeyEnv || 'DASHSCOPE_API_KEY') + ' 未设置，配置里也没有填。\n在「会议 → 配置」里填 Key 并保存，或 setx 后重启 DSH。' }
        }
      }
      agent.running = true
      await session.startCapture(a.label || 'agent')
      return {
        ok: true,
        result: `后台大脑已启动\n· 策略：${cfg.policy}（auto 才会自动播报）\n· LLM：${completer ? '已配置' : '未配置，用规则+模板'}\n· 唤醒词：${brain.names.join('/')}`,
      }
    }),
  }))

  ctx.tools.register(defineTool({
    name: 'meeting_agent_stop',
    description: '停止后台会议大脑与采集。',
    parameters: {},
    output: OUT(),
    execute: wrap('meeting_agent_stop', async () => {
      agent.running = false
      await session.stopCapture()
      return { ok: true, result: `已停止：听过 ${brain.stats.seen} 句，触发 ${brain.stats.triggered} 次，播报 ${agent.spoken} 次` }
    }),
  }))

  ctx.tools.register(defineTool({
    name: 'meeting_agent_status',
    description: '后台大脑状态：是否在听、最近一次判定、累计统计。',
    parameters: {},
    output: OUT(),
    execute: wrap('meeting_agent_status', async () => {
      const d = agent.lastDecision
      const lines = [
        `运行：${agent.running ? '是' : '否'} · 采集：${session.snapshot().capturing ? '是' : '否'}`,
        `策略：${cfg.policy} · LLM：${completer ? '已配置' : '未配置'}`,
        `统计：听 ${brain.stats.seen} · 触发 ${brain.stats.triggered} · 播报 ${agent.spoken} · 错误 ${agent.errors}`,
      ]
      if (d) lines.push(`最近判定：${d.speak ? '说话' : '沉默'}（置信 ${d.confidence}）${d.reason}\n草稿：${d.text || '-'}`)
      return { ok: true, result: lines.join('\n') }
    }),
  }))

  // ── 界面标定：首用截一张图，交给会看图的一方确定按钮位置 ──────────────
  ctx.tools.register(defineTool({
    name: 'meeting_calibrate',
    description:
      '首次使用或界面改版后标定按钮位置。会截一张客户端窗口图并存盘，返回图片路径、窗口尺寸和已有坐标；随后看图确认按钮位置，再用 meeting_set_ui_map 写回。',
    parameters: {
      app: { type: 'string', description: '会议软件名（可选，默认当前）' },
      action: { type: 'string', description: '要标定的动作：join / quick / schedule / share / leave（默认 join）' },
    },
    output: OUT(),
    execute: wrap('meeting_calibrate', async (a) => {
      const app = a.app ? meetingApp(a.app) : await detectMeetingApp()
      const action = String(a.action || 'join')
      const opts = meetingOpts(app)
      const name = String(app.name || 'meeting').replace(/[\\/:*?"<>|]/g, '_')
      const out = join(calibDir, name + '-' + action + '-' + Date.now().toString(36) + '.png')
      let shot = null
      try {
        shot = await shotWindow(app.title, out, opts)
      } catch (e) {
        return { ok: false, result: '截不到 ' + app.name + ' 的窗口：' + e.message + '\n先把客户端打开并切到首页' }
      }
      const rect = await clientRect(app.title, opts).catch(() => null)
      const cur = uiMap.get(app.name, action)
      const lines = []
      lines.push('已截图：' + shot.path)
      lines.push('窗口内容 ' + shot.w + '×' + shot.h + (rect ? '（屏幕位置 ' + rect.x + ',' + rect.y + '）' : ''))
      lines.push('当前 ' + action + ' 坐标：' + (cur ? cur.x + ', ' + cur.y : '未标定'))
      lines.push('')
      lines.push('下一步：看这张图，找到目标按钮的中心（像素坐标 px, py），然后调用')
      lines.push('  meeting_set_ui_map { app: "' + app.name + '", action: "' + action + '", px: ' + 'X' + ', py: ' + 'Y' + ', w: ' + shot.w + ', h: ' + shot.h + ' }')
      lines.push('插件会换算成相对比例存起来，以后不再需要看图。')
      return { ok: true, result: lines.join('\n'), image: shot.path }
    }),
  }))

  ctx.tools.register(defineTool({
    name: 'meeting_set_ui_map',
    description: '保存界面按钮坐标。可用截图像素（配 w/h）或直接给相对比例（x/y，0~1）。存好之后入会等流程直接用它。',
    parameters: {
      app: { type: 'string', required: true, description: '会议软件名' },
      action: { type: 'string', description: 'join / quick / schedule / share / leave（默认 join）' },
      px: { type: 'number', description: '截图里的 x 像素' },
      py: { type: 'number', description: '截图里的 y 像素' },
      w: { type: 'number', description: '截图宽度（与 px/py 配套）' },
      h: { type: 'number', description: '截图高度（与 px/py 配套）' },
      x: { type: 'number', description: '相对比例 0~1' },
      y: { type: 'number', description: '相对比例 0~1' },
    },
    output: OUT(),
    execute: wrap('meeting_set_ui_map', async (a) => {
      const app = meetingApp(a.app)
      const action = String(a.action || 'join')
      let ratio = null
      if (Number.isFinite(a.px) && Number.isFinite(a.py) && a.w > 0 && a.h > 0) {
        ratio = pixelToRatio(a.px, a.py, a.w, a.h)
      } else if (Number.isFinite(a.x) && Number.isFinite(a.y)) {
        ratio = { x: a.x, y: a.y }
      }
      if (!ratio || !validRatio(ratio.x, ratio.y)) {
        return { ok: false, result: '坐标不合法：需要 px/py/w/h，或 x/y 在 0~1 之间' }
      }
      const saved = uiMap.set(app.name, action, ratio, { via: 'calibrate' })
      if (!saved) return { ok: false, result: '保存失败（action 是否拼错？）' }
      return { ok: true, result: app.name + ' · ' + action + ' 已存：' + saved.x + ', ' + saved.y }
    }),
  }))
  // ── 手动切换会议软件 ────────────────────────────────────────────────
  ctx.tools.register(defineTool({
    name: 'meeting_app_select',
    description: '手动指定盯哪个会议软件（腾讯会议 / 移动会议 / 飞书会议 / 钉钉会议 …），传空字符串表示恢复自动跟随。',
    parameters: {
      name: { type: 'string', required: true, description: 'apps 里的 name 或 proc；空串 = 自动跟随' },
    },
    output: OUT(),
    execute: wrap('meeting_app_select', async (a) => {
      const pick = String(a.name || '').trim()
      if (!pick) {
        cfg.activeApp = ''
        cfg.autoAppSelect = true
        savePersisted({ activeApp: '', autoAppSelect: true })
        return { ok: true, result: '已恢复自动跟随：哪个会议软件在开会就用哪个' }
      }
      const all = cfg.apps || []
      let hit = all.find((x) => x.name === pick || x.proc === pick)
      if (!hit) {
        // 不在配置里但属于内置预设：按预设补一条
        const preset = listPresets().find((x) => x.name === pick || x.id === pick || x.procs.includes(pick))
        if (!preset) {
          return { ok: false, result: '没找到会议软件：' + pick + '\n可选：' + all.map((x) => x.name).join('、') + '\n或内置：' + listPresets().map((x) => x.name).join('、') }
        }
        hit = { name: preset.name, proc: preset.procs[0], title: preset.name, classes: (preset.capabilities && '') || '' }
        cfg.apps = [...all, hit]
        savePersisted({ apps: cfg.apps })
      }
      cfg.activeApp = hit.name
      savePersisted({ activeApp: hit.name })
      const wins = await listWindows().catch(() => [])
      const running = wins.some((w) => (w.proc || '').toLowerCase() === (hit.proc || '').toLowerCase())
      return { ok: true, result: '当前抓取：' + hit.name + '（proc=' + (hit.proc || '未配置') + '）' + (running ? ' · 已在运行' : ' · 未检测到进程') }
    }),
  }))
  // ── 按比例点击窗口（Qt 自绘界面标定用）──────────────────────────────
  ctx.tools.register(defineTool({
    name: 'meeting_click_ratio',
    description: '按窗口相对坐标点击（0~1），用于标定腾讯会议这类自绘界面的按钮位置。返回点击前后的窗口变化，方便确认点到了什么。',
    parameters: {
      x: { type: 'number', required: true, description: '横向比例 0~1' },
      y: { type: 'number', required: true, description: '纵向比例 0~1' },
      app: { type: 'string', description: '会议软件名（可选）' },
      save: { type: 'boolean', description: '把这个比例存为 joinClickRatio' },
    },
    output: OUT(),
    execute: wrap('meeting_click_ratio', async (a) => {
      const app = a.app ? meetingApp(a.app) : await detectMeetingApp()
      const opts = meetingOpts(app)
      const before = await listWindows()
      const wins = pickMeetingWindows(before, app.title, app.proc)
      const win = wins.sort((m, n) => (n.w * n.h) - (m.w * m.h))[0]
      if (!win) return { ok: false, result: '没找到 ' + app.name + ' 的窗口' }
      const x = Math.round(win.x + win.w * Math.max(0, Math.min(1, a.x)))
      const y = Math.round(win.y + win.h * Math.max(0, Math.min(1, a.y)))
      await clickXY(app.title, x, y, opts).catch((e) => { throw new Error('点击失败: ' + e.message) })
      await new Promise((r) => setTimeout(r, 800))
      const after = await listWindows()
      const beforeKeys = new Set(before.map((w) => w.proc + '|' + w.cls + '|' + w.title))
      const added = after.filter((w) => !beforeKeys.has(w.proc + '|' + w.cls + '|' + w.title))
      const rectNow = await clientRect(app.title, opts).catch(() => null)
      if (a.save) {
        // 存成相对客户区的比例（与窗口大小无关）
        if (rectNow) {
          const rx = (x - rectNow.x) / rectNow.w
          const ry = (y - rectNow.y) / rectNow.h
          if (validRatio(rx, ry)) uiMap.set(app.name, 'join', { x: rx, y: ry }, { via: 'click_ratio' })
        }
      }
      const lines = ['点击 (' + x + ', ' + y + ')，窗口 ' + win.w + '×' + win.h + ' @' + win.x + ',' + win.y]
      lines.push(added.length ? '新窗口：' + added.map((w) => w.title + '[' + w.cls + ']').join(' / ') : '没有新窗口出现')
      if (a.save) lines.push('已存为 ' + app.name + ' 的 join 坐标')
      return { ok: true, result: lines.join('\n') }
    }),
  }))
  // ── 会议软件列表 ────────────────────────────────────────────────────
  ctx.tools.register(defineTool({
    name: 'meeting_apps',
    description: '列出配置支持的会议软件，并标出当前正在运行的那个。移动会议等新软件只要在配置里加一条 proc 即可。',
    parameters: {},
    output: OUT(),
    execute: wrap('meeting_apps', async () => {
      const wins = await listWindows()
      const detected = detectRunningApps(wins, cfg.apps || [])
      const detectedMap = new Map(detected.map((d) => [d.app.name, d]))
      const rows = (cfg.apps || []).map((a) => {
        const d = detectedMap.get(a.name)
        const strong = d && d.score >= 60
        const weak = d && d.score < 60
        const mark = strong ? '[运行中]' : weak ? '[疑似]' : '[未运行]'
        const tail = d ? '（' + d.confidence + '，proc=' + d.proc + '）' : '  proc=' + (a.proc || '(未配置)')
        const active = (cfg.activeApp || '') === a.name ? ' ★当前' : ''
        return mark + ' ' + a.name + tail + active
      })
      const lines = []
      lines.push('当前抓取：' + (cfg.activeApp || '自动跟随（哪个在开会用哪个）'))
      lines.push('自动跟随：' + (cfg.autoAppSelect ? '开' : '关') + ' · 手动指定优先')
      lines.push('')
      lines.push(...(rows.length ? rows : ['（还没配置会议软件）']))
      const presets = listPresets()
      const known = new Set((cfg.apps || []).map((a) => a.name))
      const optional = presets.filter((p) => !known.has(p.name))
      if (optional.length) {
        lines.push('')
        lines.push('可接入（未配置，加进 apps 即可）：')
        for (const p of optional) lines.push('  · ' + p.name + '  proc=' + p.procs[0] + '  ' + p.caption)
      }
      return { ok: true, result: lines.join('\n') }
    }),
  }))


  // ── 会议生命周期：自动识别开始/结束 ────────────────────────────────
  async function metersMax() {
    const out = await bridge(['meters'], { timeoutMs: 20000 })
    let max = 0
    for (const line of out.split(/\r?\n/)) {
      const parts = line.split('\t')
      if (!parts[0]) continue
      const v = Number(parts[1] || 0)
      if (v > max) max = v
    }
    return max
  }

  async function buildMinutes(limit = 80) {
    const lines = session.transcript.slice(-limit)
    if (lines.length === 0) return ''
    const text = lines.map((l) => l.text).join('\n')
    if (completer) {
      try {
        return await completer([
          { role: 'system', content: '你是会议纪要助手。输出 Markdown：## 决议 / ## 待办 / ## 风险 / ## 未决问题，没有就写“无”。不要编造。' },
          { role: 'user', content: text },
        ])
      } catch { /* 退化为抽取式 */ }
    }
    return '## 会议要点（抽取式）\n' + lines.slice(-12).map((l) => '- ' + l.text).join('\n')
  }

  /** 会后：纪要落盘 → 写知识库 → 沉淀人格 */
  let finalizing = false
  let lastFinalizedAt = 0
  async function finalizeMeeting({ speak = false } = {}) {
    if (finalizing) return { skipped: '正在收尾中' }
    if (Date.now() - lastFinalizedAt < 60000) return { skipped: '刚刚收尾过' }
    finalizing = true
    try {
    const md = await buildMinutes()
    const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ')
    const title = (cfg.knowledge.titlePrefix || '会议纪要') + ' · ' + stamp
    const results = { minutes: '', knowledge: '', persona: '' }

    // 1) 落盘（会话目录 + 会议工作区）
    if (md) {
      try {
        const { writeFile } = await import('node:fs/promises')
        if (session.dir) {
          results.minutes = join(session.dir, 'minutes.md')
          await writeFile(results.minutes, md, 'utf8')
        }
        const ws = ensureMeetingWorkspace()
        if (ws.dir) await writeFile(join(ws.dir, 'minutes.md'), md, 'utf8')
      } catch { /* ignore */ }
    }

    // 2) 写知识库：交给装了 dsh-knowledge 的 profile 去落库
    if (cfg.knowledge.enabled && md && cfg.twin.enabled) {
      const kd = detectKnowledge(cfg.knowledge.profile || '')
      const mode = String(cfg.knowledge.mode || 'host')
      if (mode === 'off') {
        results.knowledge = '已关闭（knowledge.mode = off）'
      } else if (!kd.installed && !kd.host) {
        results.knowledge = '跳过（未安装 dsh-knowledge）'
      } else if (mode === 'host') {
        // 直连宿主里知识库插件的本地管理 API：不需要额外安装、不需要模型
        let port = 0
        try { port = (ctx.webServer || ctx.get?.('webServer'))?.port || 0 } catch { port = 0 }
        if (kd.host && port) {
          const r = await writeViaHostApi({ port, title, markdown: md, type: 'decision', group: '会议纪要' })
          if (r.ok) {
            results.knowledge = '已写入知识库（' + (r.id || 'ok').toString().slice(0, 8) + '）'
            addAssistantLine('会议纪要已写入知识库：' + title, '知识库')
          } else {
            results.knowledge = '写入失败：' + (r.error || r.status || '')
          }
        } else {
          results.knowledge = '跳过（宿主没装知识库或拿不到端口）'
        }
      } else if (mode === 'agent') {
        // 插件之间不能直接调工具：记成待办，让会话里的 agent 写
        addAssistantLine('会议纪要已生成：' + title + '（待写入知识库）', '知识库')
        agent.pendingKnowledge = (agent.pendingKnowledge || []).concat([{
          at: new Date().toISOString(), title, path: results.minutes,
        }]).slice(-10)
        results.knowledge = '待写入知识库（' + (kd.host || kd.profile) + ' 已装，可在会话里让我写）'
      } else if (!kd.profile) {
        results.knowledge = '跳过（headless 里没装 dsh-knowledge）'
      } else {
        const target = kd.profile
        const r = await writeToKnowledge({
          title,
          markdown: md,
          profile: target,
          cwd: ensureMeetingWorkspace().dir || undefined,
          timeoutMs: Math.min(cfg.twin.timeoutMs, 180000),
          runDshTask,
        })
        results.knowledge = r.ok ? '已写入知识库（' + (r.handle || 'ok') + '）' : '写入失败：' + r.error
        if (r.ok) addAssistantLine('会议纪要已写入知识库：' + title, '知识库')
      }
    }

    // 3) 沉淀人格（USER.md / STATE.md）
    if (cfg.personaAutoUpdate && md && completer) {
      try {
        const out = await completer([
          {
            role: 'system',
            content: '从会议纪要里抽取值得长期记住的两类信息，只输出 JSON：'
              + '{"user":["关于参会者/用户本人的稳定事实或偏好"],"state":["当前项目进展/下一步"]}。'
              + '没有就给空数组；每条不超过 40 字；不要编造。',
          },
          { role: 'user', content: md.slice(0, 6000) },
        ])
        const jsonText = String(out).replace(/^```(?:json)?|```$/g, '').trim()
        const j = JSON.parse(jsonText)
        const r1 = appendPersonaSection(personaDir, 'user', j.user, { stamp })
        const r2 = appendPersonaSection(personaDir, 'state', j.state, { stamp })
        results.personaDetail = '新增 user ' + r1.added + ' 条、state ' + r2.added + ' 条（重复跳过 ' + (r1.skipped + r2.skipped) + '）'
        personaAt = 0
        results.persona = (j.user || []).length + (j.state || []).length + ' 条'
      } catch { /* ignore */ }
    }

    lastFinalizedAt = Date.now()
    logger?.info?.('[soulmirror] 会议收尾：纪要=' + (results.minutes ? '已保存' : '空') + '，知识库=' + (results.knowledge || '跳过') + '，人格=' + (results.persona || '跳过'))
    if (speak) {
      const brief = '这场会到这里，纪要' + (results.minutes ? '已经保存' : '没生成')
        + (results.knowledge ? '，' + results.knowledge : '') + '。'
      try {
        addAssistantLine(brief, '会议收尾')
        brain.markSpoken(brief)
        await sayToMeeting(brief, cfg.tts, {
          speakDevice: cfg.devices.speak,
          micRestore: cfg.devices.micRestore,
          windowTitle: cfg.windowTitle,
          logger,
        })
      } catch { /* ignore */ }
    }
    return results
    } finally {
      finalizing = false
    }
  }

  async function saveMinutes() {
    const md = await buildMinutes()
    if (!md || !session.dir) return ''
    try {
      const { writeFile } = await import('node:fs/promises')
      await writeFile(join(session.dir, 'minutes.md'), md, 'utf8')
      return join(session.dir, 'minutes.md')
    } catch { return '' }
  }

  const lifecycle = new MeetingLifecycle(
    { apps: activeApps() },
    {
      listWindows,
      meters: metersMax,
      logger,
      onEnter: async ({ reason }) => {
        try { await autoPickApp() } catch { /* ignore */ }
        if (!cfg.autoWatch) return
        if (!session.capturing) await session.startCapture('auto').catch(() => {})
        agent.running = true
        ensureMeetingSession(reason).catch(() => {})
        logger?.info?.('[soulmirror] 自动开始记录：' + reason)
      },
      onExit: async () => {
        agent.running = false
        await session.stopCapture().catch(() => {})
        try {
          const r = await finalizeMeeting({ speak: false })
          logger?.info?.('[soulmirror] 会议结束：' + JSON.stringify(r).slice(0, 200))
        } catch (e) {
          logger?.warn?.('[soulmirror] 会议收尾失败: ' + e.message)
        }
      },
    },
  )
  if (cfg.autoWatch) lifecycle.start()

  // 启动时做一次环境自检（只打日志，不阻塞）
  try {
    const env = detectEnv()
    if (!env.ready) logger?.warn?.('[soulmirror] 环境待补：' + env.missing.join('、') + ' → 运行 soul_setup')
    else logger?.info?.('[soulmirror] 环境自检：就绪（' + env.platform + '）')
  } catch { /* ignore */ }
  // ── 实时纪要 ────────────────────────────────────────────────────────
  ctx.tools.register(defineTool({
    name: 'meeting_minutes',
    description: '生成会议纪要：有 LLM 时输出"决议/待办/风险/未决"，没有则做抽取式摘要。可随时调用，取最近 N 句。',
    parameters: {
      limit: { type: 'integer', description: '取最近多少句，默认 80。' },
      save: { type: 'boolean', description: '是否写到会话目录 minutes.md。' },
    },
    output: OUT(),
    execute: wrap('meeting_minutes', async (a) => {
      const lines = session.transcript.slice(-(a.limit || 80))
      if (lines.length === 0) return { ok: false, result: '还没有转写内容' }
      const text = lines.map((l) => l.text).join('\n')
      let out = ''
      if (completer) {
        try {
          out = await completer([
            { role: 'system', content: '你是会议纪要助手。输出 Markdown，包含四节：## 决议 / ## 待办 / ## 风险 / ## 未决问题。没有就写“无”。不要编造。' },
            { role: 'user', content: text },
          ])
        } catch (e) { out = '' }
      }
      if (!out) {
        const bullets = lines.slice(-12).map((l) => '- ' + l.text)
        out = '## 会议要点（抽取式）\n' + bullets.join('\n')
      }
      if (a.save && session.dir) {
        try {
          const { writeFile } = await import('node:fs/promises')
          await writeFile(join(session.dir, 'minutes.md'), out, 'utf8')
        } catch { /* ignore */ }
      }
      return { ok: true, result: out }
    }),
  }))

  ctx.tools.register(defineTool({
    name: 'meeting_auto',
    description: '自动会议生命周期：start 后每 5 秒检查窗口+音频，识别到进入会议就自动开始采集/托管，退出后自动停止并生成纪要。',
    parameters: { action: { type: 'string', enum: ['start', 'stop', 'status'], required: true, description: 'start / stop / status' } },
    output: OUT(),
    execute: wrap('meeting_auto', async (a) => {
      if (a.action === 'start') {
        lifecycle.start()
        cfg.autoWatch = true
        return { ok: true, result: '自动监听已开启（5 秒一次；失败 3 次才判定会议结束）' }
      }
      if (a.action === 'stop') {
        lifecycle.stop()
        cfg.autoWatch = false
        return { ok: true, result: '自动监听已关闭' }
      }
      const s = lifecycle.snapshot()
      const lines = [
        '状态：' + (s.state === 'in-meeting' ? '会议中（自 ' + (s.since || '').slice(11, 19) + '）' : '空闲'),
        '监听：' + (lifecycle.timer ? '开' : '关') + ' · 间隔 ' + s.intervalMs + 'ms · 退出确认 ' + s.confirmTicks + ' 次',
        '最近峰值：' + Number(s.lastPeak).toFixed(4) + (s.audioSeen ? '（会中听到过声音）' : ''),
      ]
      if (s.history.length) {
        lines.push('最近事件：')
        for (const h of s.history) lines.push('  ' + h.at.slice(11, 19) + ' ' + h.event + (h.reason ? ' · ' + h.reason : ''))
      }
      return { ok: true, result: lines.join('\n') }
    }),
  }))

  // ── 会议麦克风占用状态 ──────────────────────────────────────────────
  ctx.tools.register(defineTool({
    name: 'meeting_mic_status',
    description: '看会议客户端此刻在用哪个麦克风、是否真的在采集。用来判断"声音为什么进不了会议"：设备不对 / 没在采集（静音）。',
    parameters: {},
    output: OUT(),
    execute: wrap('meeting_mic_status', async () => {
      const rows = await micUsage()
      const proc = cfg.processName || 'wemeetapp'
      const mine = rows.filter((r) => r.proc === proc)
      const active = mine.filter((r) => r.state === 1)
      const lines = []
      if (active.length === 0) {
        lines.push('会议进程当前没有在采集任何麦克风 → 很可能处于静音，或没有音频权限')
      } else {
        lines.push('会议正在采集：' + active.map((r) => r.device).join(' / '))
        const onCable = active.some((r) => /cable/i.test(r.device))
        lines.push(onCable ? '✓ 采的是虚拟麦克风，TTS 可以直接送进去' : '✗ 采的是真实麦克风，需要先切默认设备到 CABLE Output')
      }
      if (mine.length === 0) lines.push('（未发现该进程的音频会话）')
      return { ok: true, result: lines.join('\n') }
    }),
  }))
  // ── 数字分身：把任务交给 DSH 执行，并在会上汇报 ────────────────────
  ctx.tools.register(defineTool({
    name: 'soul_task',
    description: '把一项任务交给本机 DSH（headless）执行，返回结果；可让分身把结果直接说给会议。适合"帮我查/算/整理/跑一下"这类需要工具或长链路的活。',
    parameters: {
      prompt: { type: 'string', required: true, description: '要 DSH 完成的任务，用自然语言描述' },
      speak: { type: 'boolean', description: '完成后是否在会议里播报结果（默认 false）' },
      timeoutMs: { type: 'number', description: '超时毫秒，默认用配置里的 twin.timeoutMs' },
    },
    output: OUT(),
    execute: wrap('soul_task', async (a) => {
      if (!cfg.twin.enabled) return { ok: false, result: '数字分身未启用（config.twin.enabled = false）' }
      const t0 = Date.now()
      const ws = ensureMeetingWorkspace()
      const r = await runInMeetingSession(a.prompt, { timeoutMs: a.timeoutMs || cfg.twin.timeoutMs })
      if (r.sessionId) ws.dshSessionId = r.sessionId
      const ms = Date.now() - t0
      const task = { at: new Date().toISOString(), prompt: a.prompt, ok: r.ok, ms, sessionId: r.sessionId || '', output: (r.text || r.output || '').slice(0, 1200) }
      agent.tasks = [task, ...(agent.tasks || [])].slice(0, 20)
      if (!r.ok) return { ok: false, result: '任务失败（' + ms + 'ms）：' + (r.error || '') }
      let spoke = ''
      if (a.speak) {
        try {
          const brief = (r.text || r.output || '').trim().slice(0, 120) || '任务完成'
          brain.markSpoken(brief)
          await sayToMeeting(brief, cfg.tts, {
            speakDevice: cfg.devices.speak,
            micRestore: cfg.devices.micRestore,
            windowTitle: cfg.windowTitle,
            logger,
          })
          addAssistantLine(brief, '任务汇报')
          spoke = '\n已在会议里汇报'
        } catch (e) { spoke = '\n播报失败：' + e.message }
      }
      return { ok: true, result: '任务完成（' + ms + 'ms）' + spoke + '\n\n' + (r.text || r.output || '（无输出）') }
    }),
  }))

  ctx.tools.register(defineTool({
    name: 'soul_say',
    description: '分身主动发言：不依赖唤醒词，直接把这句话说进会议（适合任务完成后汇报、提醒、开场白）。',
    parameters: {
      text: { type: 'string', required: true, description: '要说的话' },
      remember: { type: 'boolean', description: '是否记进转写（默认 true）' },
    },
    output: OUT(),
    execute: wrap('soul_say', async (a) => {
      const text = String(a.text || '').trim()
      if (!text) return { ok: false, result: '内容为空' }
      brain.markSpoken(text)
      await sayToMeeting(text, cfg.tts, {
        speakDevice: cfg.devices.speak,
        micRestore: cfg.devices.micRestore,
        windowTitle: cfg.windowTitle,
        logger,
      })
      if (a.remember !== false) addAssistantLine(text, '主动发言')
      agent.spoken += 1
      return { ok: true, result: '已发言：' + text }
    }),
  }))

  ctx.tools.register(defineTool({
    name: 'soul_status',
    description: '看数字分身当前状态：是否在听、唤醒词、最近交给 DSH 的任务、累计发言次数。',
    parameters: {},
    output: OUT(),
    execute: wrap('soul_status', async () => {
      const lines = []
      lines.push('分身：' + (agent.running ? '在线' : '待机') + ' · 采集：' + (session.capturing ? '是' : '否'))
      lines.push('唤醒词：' + resolveWakeWords().join(' / '))
      lines.push('DSH 任务：' + (cfg.twin.enabled ? '已启用（profile=' + cfg.twin.profile + '）' : '未启用'))
      const aaCfg = cfg.autoAnswer || {}
      lines.push('自动应答：' + (aaCfg.enabled !== false ? '开（' + (aaCfg.timeoutMs || 5000) + 'ms，已自动答 ' + (autoAnswer?.count || 0) + ' 次）' : '关'))
      lines.push('累计：听 ' + brain.stats.seen + ' · 触发 ' + brain.stats.triggered + ' · 发言 ' + agent.spoken)
      const tasks = agent.tasks || []
      if (tasks.length) {
        lines.push('最近任务：')
        for (const x of tasks.slice(0, 5)) {
          lines.push('  ' + x.at.slice(11, 19) + ' ' + (x.ok ? '✓' : '✗') + ' ' + x.prompt.slice(0, 40) + ' (' + x.ms + 'ms' + (x.via ? ', ' + x.via : '') + ')')
        if (!x.ok && x.error) lines.push('      错误：' + String(x.error).slice(0, 160))
        if (!x.ok && x.events && x.events.length) lines.push('      事件：' + x.events.join(' → '))
        }
      }
      return { ok: true, result: lines.join('\n') }
    }),
  }))

  // ── 人格与记忆管理工具 ─────────────────────────────────────────────
  ctx.tools.register(defineTool({
    name: 'soul_persona',
    description: '查看或修改四层人格文件（soul/identity/user/state）。改完即时生效，不需要重启。',
    parameters: {
      action: { type: 'string', enum: ['get', 'set'], required: true, description: 'get 查看全部 / set 写入某一份' },
      which: { type: 'string', description: 'set 时必填：soul | identity | user | state' },
      text: { type: 'string', description: 'set 时的完整正文' },
    },
    output: OUT(),
    execute: wrap('soul_persona', async (a) => {
      if (a.action === 'get') {
        const parts = []
        for (const key of Object.keys(PERSONA_FILES)) {
          const body = readPersonaFile(personaDir, key)
          parts.push('### ' + PERSONA_FILES[key] + '\n' + (body.trim() || '（空）'))
        }
        return { ok: true, result: parts.join('\n\n') }
      }
      const key = String(a.which || '').toLowerCase()
      if (!PERSONA_FILES[key]) return { ok: false, result: 'which 必须是 soul / identity / user / state' }
      const file = writePersonaFile(personaDir, key, a.text || '')
      personaAt = 0
      return { ok: true, result: '已写入 ' + file + '（' + String(a.text || '').length + ' 字）' }
    }),
  }))

  ctx.tools.register(defineTool({
    name: 'soul_memory',
    description: '长期记忆：看最近记录、手动补一条、或触发一次 LLM 蒸馏（抽取对方偏好/事件/要求）。',
    parameters: {
      action: { type: 'string', enum: ['recent', 'add', 'distill'], required: true },
      text: { type: 'string', description: 'add 时的内容' },
      limit: { type: 'number', description: 'recent 条数 / distill 批量，默认 20' },
    },
    output: OUT(),
    execute: wrap('soul_memory', async (a) => {
      if (a.action === 'add') {
        if (!a.text) return { ok: false, result: 'text 不能为空' }
        memory.add({ role: 'user', text: a.text, kind: 'manual' })
        return { ok: true, result: '已记录：' + a.text }
      }
      if (a.action === 'distill') {
        if (!completer) return { ok: false, result: '没有可用模型，无法蒸馏' }
        const r = await memory.distill(completer, { limit: a.limit || 40 })
        if (r.skipped) return { ok: true, result: '样本不足（' + r.count + ' 条），先多聊几句' }
        if (r.error) return { ok: false, result: '蒸馏失败：' + r.error }
        const lines = []
        for (const k of ['persona', 'episodic', 'instruction']) {
          if (r[k] && r[k].length) lines.push(k + '：\n  - ' + r[k].join('\n  - '))
        }
        return { ok: true, result: lines.length ? lines.join('\n') : '没有抽到新信息' }
      }
      const list = memory.recent(a.limit || 20)
      const digest = memory.digest(20)
      const body = list.map((x) => (x.at || '').slice(11, 19) + ' [' + (x.role === 'assistant' ? '我' : '对方') + '] ' + x.text).join('\n')
      return { ok: true, result: '最近记忆：\n' + (body || '（空）') + (digest ? '\n\n已蒸馏：\n' + digest : '') }
    }),
  }))

  // ── 会议工作区 / 会话 ───────────────────────────────────────────────
  ctx.tools.register(defineTool({
    name: 'soul_session',
    description: '查看本场会议的工作区与 DSH 会话：目录、会话 id、转写行数、最近一次任务。端侧可据此在 DSH 会话列表里翻看模型回复。',
    parameters: {
      limit: { type: 'number', description: '列出最近几个会议工作区，默认 8' },
      setMeetingId: { type: 'string', description: '手动指定会议号（如 206-275-219），相同会议号会复用同一 session' },
    },
    output: OUT(),
    execute: wrap('soul_session', async (a) => {
      if (a.setMeetingId !== undefined) meetingIdOverride = String(a.setMeetingId || '').trim()
      const ws = ensureMeetingWorkspace()
      const lines = []
      lines.push('当前会议：' + (ws.id || '（还没开始）') + (ws.key && ws.key !== ws.id ? '（key=' + ws.key + '）' : ''))
      const ident = currentMeetingKey()
      lines.push('会议身份：' + (ident.display || '未知') + '（来源 ' + ident.source + '）')
      if (ws.dir) lines.push('工作区：' + ws.dir)
      lines.push('DSH 会话：' + (ws.dshSessionId || '（还没创建；会议开始时自动建，或调 soul_task 时建）'))
      if (session.dir) lines.push('转写目录：' + session.dir + '（' + session.transcript.length + ' 行）')
      const mapped = sessionMap.list(Math.max(1, Math.min(a.limit || 8, 20)))
      if (mapped.length) {
        lines.push('会议 → 会话（持久化）：')
        for (const m of mapped) lines.push('  ' + (m.title || m.key).slice(0, 40) + '  →  ' + (m.dshSessionId || '（无）').slice(0, 24))
      }
      const limit = Math.max(1, Math.min(a.limit || 8, 30))
      let dirs = []
      try {
        dirs = (await import('node:fs')).readdirSync(workspaceRoot, { withFileTypes: true })
          .filter((d) => d.isDirectory()).map((d) => d.name).sort().reverse().slice(0, limit)
      } catch { /* 还没有工作区 */ }
      if (dirs.length) {
        lines.push('最近会议工作区：')
        for (const d of dirs) {
          const full = join(workspaceRoot, d)
          let n = 0
          try { n = (await import('node:fs')).readdirSync(full).length } catch { /* ignore */ }
          lines.push('  ' + d + '  (' + n + ' 个文件)')
        }
      }
      return { ok: true, result: lines.join('\n') }
    }),
  }))

  // ── 环境自检与配置 ─────────────────────────────────────────────────
  ctx.tools.register(defineTool({
    name: 'soul_setup',
    description: '检查并自动配置运行环境（Windows 编译 mbridge；macOS/Linux 提示 ffmpeg 等依赖）。装完先跑一次这个。',
    parameters: {
      action: { type: 'string', enum: ['check', 'build', 'auto', 'deps', 'install-deps', 'links'], required: true, description: 'check 看环境 / build 编译 mbridge / auto 自动处理 / deps 看虚拟声卡 / install-deps 尝试安装虚拟声卡' },
    },
    output: OUT(),
    execute: wrap('soul_setup', async (a) => {
      if (a.action === 'build') {
        const r = buildBridge({ logger })
        return { ok: r.ok, result: (r.ok ? '编译完成：' + r.path : '失败：' + (r.error || r.reason || '')) + '\n\n' + formatEnv(detectEnv()) }
      }
      if (a.action === 'links') {
        const s = linkStatus(cfg.twin.profile)
        const kd = detectKnowledge(cfg.knowledge.profile || '')
        const lines = []
        lines.push('任务 profile：' + cfg.twin.profile + (s.twin.exists ? '（存在）' : '（不存在）'))
        lines.push('知识库插件：' + (kd.host ? '宿主已装（' + kd.host + '）→ host 模式直连本地 API' : (kd.installed ? '装在 ' + kd.profile : '未安装（会后只落本地，其它功能不受影响）')))
        if (kd.host) lines.push('  会后纪要自动写入知识库，不需要额外安装')
        else if (kd.installed) lines.push('  别名 profile 里装了知识库，可切 knowledge.mode = headless')
        if (s.others.length) {
          lines.push('其它联动：')
          for (const o of s.others) lines.push('  · ' + o)
        }
        lines.push('提示：computer-use 与本插件都会发键盘事件，同时操作桌面时可能互相打断；')
        lines.push('      分身发言前会先把会议窗口置前，若你正在用 computer-use 操作别的应用，可能抢焦点。')
        return { ok: true, result: lines.join('\n') }
      }
      if (a.action === 'deps') {
        const v = await detectVirtualAudio()
        const plan = installPlan()
        const lines = [formatVirtualAudio(v)]
        if (!v.available) {
          lines.push('安装方式（' + (plan.auto ? '可自动' : '需管理员') + '）：' + plan.reason)
          for (const s of plan.steps) lines.push('  · ' + s)
          if (plan.commands && plan.commands.length) lines.push('命令：\n  ' + plan.commands.join('\n  '))
        }
        return { ok: v.available, result: lines.join('\n') }
      }
      if (a.action === 'install-deps') {
        const r = await installVirtualAudio({ logger })
        if (r.manual) {
          return { ok: false, result: '这台机器不能静默安装：' + r.reason + '\n\n' + r.steps.map((s) => '· ' + s).join('\n') + (r.commands && r.commands.length ? '\n\n命令：\n' + r.commands.join('\n') : '') }
        }
        const after = await detectVirtualAudio()
        return { ok: r.ok, result: (r.results || []).map((x) => (x.ok ? '✓ ' : '✗ ') + x.cmd + (x.err ? '  ' + x.err : '')).join('\n') + '\n\n' + formatVirtualAudio(after) }
      }
      if (a.action === 'auto') {
        const r = await autoSetup({ logger })
        const vinfo = await detectVirtualAudio()
        const done = r.actions.length ? r.actions.map((x) => '- ' + x.what + '：' + (x.ok ? (x.skipped ? '已存在' : '完成') : '失败 ' + (x.error || ''))).join('\n') : '- 没有需要自动处理的项目'
        return { ok: r.ready && vinfo.available, result: done + '\n\n' + formatEnv(r.after) + '\n' + formatVirtualAudio(vinfo) }
      }
      const env = detectEnv()
      return { ok: env.ready, result: formatEnv(env) }
    }),
  }))

  // ── 活数据：心像世界 / 信念 / 目标 ───────────────────────────────────
  ctx.tools.register(defineTool({
    name: 'soul_world',
    description: '看分身的内在宇宙：记忆活力分布、信念树木、情绪议会、心像地形。可触发一次「呼吸」（记忆衰减 + 信念退化）。',
    parameters: { breathe: { type: 'boolean', description: '是否执行一次呼吸（衰减/退化）' } },
    output: OUT(),
    execute: wrap('soul_world', async (a) => {
      let acted = ''
      if (a.breathe) {
        const r = living.breathe()
        acted = '呼吸：沉睡 ' + r.decay.slept + ' 条记忆，枯萎 ' + r.wither.died + ' 条信念\n\n'
      }
      const s = living.snapshot()
      const lines = [acted + '记忆：' + s.memory.total + ' 条（绽放 ' + (s.memory.bloom || 0) + ' / 清醒 ' + (s.memory.awake || 0) + ' / 沉睡 ' + (s.memory.sleep || 0) + '），平均活力 ' + s.memory.avgVitality]
      lines.push('信念：' + ['seed', 'sprout', 'sapling', 'tree'].map((k) => k + ' ' + (s.beliefs[k] || 0)).join(' · ') + ' · dead ' + (s.beliefs.dead || 0))
      if (s.council.length) lines.push('情绪议会：' + s.council.slice(0, 4).map((c) => c.emotion + '(' + c.biome + ' ' + c.score + ')').join(' · '))
      lines.push('心像主导地形：' + s.terrain.dominant)
      if (s.buildings.length) lines.push('信念建筑：\n' + s.buildings.slice(0, 6).map((b) => '  [' + b.stage + ' ' + b.height + '] ' + b.name).join('\n'))
      if (s.topMemories.length) lines.push('最鲜活的记忆：\n' + s.topMemories.map((m) => '  [' + m.stage + ' ' + m.vitality + '] ' + m.text.slice(0, 40)).join('\n'))
      return { ok: true, result: lines.join('\n') }
    }),
  }))

  ctx.tools.register(defineTool({
    name: 'soul_belief',
    description: '信念系统：从种子长成大树，或走向死亡。可列出、种下、强化、反驳、演化。',
    parameters: {
      action: { type: 'string', enum: ['list', 'seed', 'reinforce', 'weaken', 'evolve'], required: true },
      statement: { type: 'string', description: 'seed 时的信念内容' },
      id: { type: 'string', description: 'reinforce / weaken 的信念 id' },
      delta: { type: 'number', description: '强化/反驳的强度，默认 0.2 / 0.25' },
    },
    output: OUT(),
    execute: wrap('soul_belief', async (a) => {
      if (a.action === 'seed') return { ok: true, result: '已种下：' + (living.beliefs.seed(a.statement, { source: 'manual' }) || {})?.statement }
      if (a.action === 'reinforce') return { ok: true, result: JSON.stringify(living.beliefs.reinforce(a.id, 'manual', a.delta || 0.2) || 'not found') }
      if (a.action === 'weaken') return { ok: true, result: JSON.stringify(living.beliefs.weaken(a.id, 'manual', a.delta || 0.25) || 'not found') }
      if (a.action === 'evolve') return { ok: true, result: JSON.stringify(living.beliefs.evolve()) }
      const list = living.beliefs.beliefs.map((b) => '[' + b.stage + ' ' + b.strength.toFixed(2) + '] ' + b.id + ' ' + b.statement)
      return { ok: true, result: list.length ? list.join('\n') : '（还没有信念，试试 seed）' }
    }),
  }))

  ctx.tools.register(defineTool({
    name: 'soul_goal',
    description: '目标驱动任务代理：登记目标、列出目标、或让分身基于目标立刻执行一次（交给会议会话里的 DSH）。',
    parameters: {
      action: { type: 'string', enum: ['add', 'list', 'run'], required: true },
      goal: { type: 'string', description: 'add 时的目标描述' },
      id: { type: 'string', description: 'run 时的目标 id' },
    },
    output: OUT(),
    execute: wrap('soul_goal', async (a) => {
      const file = join(CONFIG_DIR, 'goals.json')
      const load = () => { try { return JSON.parse(readFileSync(file, 'utf8')) } catch { return [] } }
      const save = (rows) => { try { mkdirSync(CONFIG_DIR, { recursive: true }); writeFileSync(file, JSON.stringify(rows, null, 1), 'utf8') } catch { /* ignore */ } }
      const goals = load()
      if (a.action === 'add') {
        const goal = String(a.goal || '').trim()
        if (!goal) return { ok: false, result: 'goal 不能为空' }
        const row = { id: 'goal-' + Math.random().toString(36).slice(2, 8), goal, status: 'active', at: new Date().toISOString() }
        goals.push(row); save(goals)
        return { ok: true, result: '已登记目标 ' + row.id + '：' + goal }
      }
      if (a.action === 'run') {
        const row = goals.find((g) => g.id === a.id)
        if (!row) return { ok: false, result: '没有这个目标：' + a.id }
        const prompt = '按这个目标开始推进，能自己做的直接做，做不了就说明缺什么：' + row.goal
        startTaskInBackground(prompt).catch(() => {})
        row.status = 'running'; row.lastRunAt = new Date().toISOString(); save(goals)
        return { ok: true, result: '已开始推进目标 ' + row.id + '，完成后会在会议里汇报' }
      }
      const list = goals.map((g) => '[' + g.status + '] ' + g.id + ' ' + g.goal)
      return { ok: true, result: list.length ? list.join('\n') : '（还没有目标，试试 add）' }
    }),
  }))
  // ── 自检 ────────────────────────────────────────────────────────────
  ctx.tools.register(defineTool({
    name: 'meeting_selftest',
    description: '自检：bridge/ui 是否就绪、音频端点、TTS 是否可用、虚拟声卡是否存在、ASR 是否已配置。',
    parameters: {},
    output: OUT(),
    execute: wrap('meeting_selftest', async () => {
      const out = []
      out.push(`mbridge.exe: ${existsSync(join(toolsDir, 'mbridge.exe')) ? '✓' : '✗ 缺失'}`)
      out.push(`ui.ps1: ${existsSync(join(toolsDir, 'ui.ps1')) ? '✓' : '✗ 缺失'}`)
      try {
        const devs = await listDevices()
        out.push(`音频端点: ✓ ${devs.filter((d) => d.flow === 'RENDER').length} 渲染 / ${devs.filter((d) => d.flow === 'CAPTURE').length} 采集`)
        const virt = devs.filter((d) => /CABLE|VB-Audio|虚拟|Virtual/i.test(d.name))
        out.push(virt.length
          ? '虚拟声卡: ' + virt.map((d) => `${d.flow}:${d.name}`).join(' | ')
          : '虚拟声卡: ✗ 未发现（发言进不了会议；需安装 VB-CABLE 或同类虚拟音频线）')
      } catch (e) {
        out.push('音频端点: ✗ ' + e.message)
      }
      try {
        await bridge(['voices'])
        out.push('TTS: ✓ 可用')
      } catch (e) {
        out.push('TTS: ✗ ' + e.message)
      }
      out.push(`ASR: ${cfg.asr.provider === 'none' ? '✗ 未配置' : cfg.asr.provider === 'local' ? (existsSync(pickLocalModel(cfg.asr)) ? '✓ 本地模型 ' + pickLocalModel(cfg.asr) : '✗ 缺少本地模型') : '✓ ' + cfg.asr.baseUrl}`)
      return { ok: true, result: out.join('\n') }
    }),
  }))

  ctx.effect?.(() => () => { session.running = false }, 'meeting-agent: stop capture')

  // ── 无人值守：自动应答，避免确认卡片卡死整轮 ──────────────────────
  let autoAnswer = null
  try {
    autoAnswer = installAutoAnswer(ctx, cfg.autoAnswer, logger)
    if (autoAnswer.enabled) logger?.info?.('[soulmirror] 自动应答已启用（' + ((cfg.autoAnswer && cfg.autoAnswer.timeoutMs) || 5000) + 'ms 后选推荐项）')
  } catch (e) {
    logger?.warn?.('[soulmirror] 自动应答安装失败: ' + e.message)
  }
  ctx.effect?.(() => () => { try { autoAnswer?.dispose?.() } catch { /* ignore */ } }, 'soulmirror: auto answer')

  logger?.info?.('soulmirror: 全部工具已注册')
}

export default { name, inject, Config, apply }
