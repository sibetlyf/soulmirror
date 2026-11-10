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
import { existsSync, statSync, readFileSync, writeFileSync, mkdirSync, openAsBlob, readdirSync } from 'node:fs'
import {appendFile, mkdir, writeFile, readFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { homedir } from 'node:os'
import v8 from 'node:v8'
import { join, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'

const execFileAsync = promisify(execFile)

import { bridge, ensureBridge, listDevices, toolsDir, micUsage, defaultRenderDevice, meetingMicActive, bridgeExe } from './lib/bridge.js'
import {
  listWindows, pickMeetingWindows, dump, focus, click, setText, pressKey, typeText,
  ensureApp, resolveAppPath, setWindowSelector, toggleMic, currentSpeaker, clickXY, clickRatio, clientRect, shotWindow,
} from './lib/desktop.js'
import { MeetingSession } from './lib/session.js'
import { pickLocalModel } from './lib/asr.js'
import { speak, sayToMeeting } from './lib/tts.js'
import { synthesizeStream } from './lib/dashscope-tts.js'
import { startDashScopeAsr } from './lib/dashscope.js'
import { DemoController } from './lib/demo.js'
import { MeetingBrain, createCompleter, makeCorrector } from './lib/brain.js'
import { SpeechDeduper, TranscriptDeduper, normalizeText } from './lib/dedupe.js'
import { saveMinutes as persistMinutesFile } from './lib/minutes-file.js'
import { extractMeetingCode } from './lib/meeting-code.js'
import { parseMeters, resolveCaptureTarget } from './lib/audio-pick.js'
import { formatAudioDiag } from './lib/audio-diag.js'
import { readWavPcm, readWavHeader, transcribeOffline, buildOfflineMinutes, getLastMinutesError } from './lib/offline-asr.js'
import { transcribeFileWithSpeakers, renderSentences } from './lib/dashscope-file.js'
import { savePreparation, loadPreparation, saveMeta, loadMeta, listRecords, loadRecord } from './lib/meeting-record.js'
import { renderExport, exportFileName, searchRecords } from './lib/record-export.js'
import { buildSnapshot } from './lib/context-snapshot.js'
import { createDshCompleter } from './lib/dsh-llm.js'
import { buildAdvicePrompt, parseAdvice, shouldReplaceAdvice } from './lib/advice.js'
import { automaticReason, countCharacters, DEFAULT_ADVICE_RULE } from './lib/advice-trigger.js'
import { buildReplyPrompt, parseReply, shouldStartTask } from './lib/reply-candidates.js'
import { detectTrigger } from './lib/trigger-rules.js'
import { createSessionGate, keyOf } from './lib/session-gate.js'
import { isModelCommentary, isSelfEcho, sanitizeCorrection } from './lib/echo-guard.js'
import { classifyProbeError, buildProbeReport } from './lib/model-probe.js'
import { scanPendingRecovery, isPendingRecovery } from './lib/recovery.js'
import { scanAudioLevels, extractRangeToWav, planOfflineUpload, explainOfflineError } from './lib/offline-audio.js'
import { captureVerdict } from './lib/capture-guard.js'
import { createFinalizeRegistry, snapshotRun } from './lib/finalize-registry.js'
import { createKeyStore, pickLegacyKeys, SLOTS as KEY_SLOTS } from './lib/credentials-bridge.js'
import { buildMinutesTaskPrompt, writeMinutesSource, readMinutesResult, resetMinutesOutput, shouldUseBackgroundTask } from './lib/minutes-task.js'
import { createProgress, describeProgress } from './lib/progress.js'
import { buildPreflight } from './lib/preflight.js'
import { collectIssues, topIssue, describeIssues } from './lib/issues.js'
import { readLogText, linesToText } from './lib/transcript-log.js'
import { mergeProfile, renderProfile, emptyProfile } from './lib/persona-growth.js'
import { routeItem, readRules, renderRules } from './lib/tripartite.js'
import { appendWarm, appendJournal, consolidate, convergence, layersStatus } from './lib/memory-layers.js'
import { renderPersonaDoc, syncPersonaDoc } from './lib/persona-kb.js'
import { pickBackfillMeetings, slimMeetingText, buildBackfillPrompt, summarizeBackfill } from './lib/persona-backfill.js'
import { renderSpeakerTranscript, whyNoPersona, isHerLine, choosePersonaSource, enableHint } from './lib/persona-source.js'
import { VERSION, STORAGE_VERSION, versionInfo } from './lib/version.js'
import { resolveProfileDir } from './lib/profile-path.js'
import { pickApp, rankApps } from './lib/app-detect.js'
import { validateMeetingCode, classifyJoinFailure, joinFailureResult } from './lib/join-guard.js'
import { checkOptionalDeps, featureAllowed, featureGateMessage, installPlugin } from './lib/deps-optional.js'
import { derivePetState, toWorkStatus, shouldPush, createPetClient, PET_MENU_ITEMS, menuAction } from './lib/pet-dsh.js'
import { formatTranscriptBubble, formatAdviceBubble, pickBubble, shouldPushTranscript, bumpOpenRequest } from './lib/pet-display.js'
import { resolveDefaultModel } from './lib/model-resolve.js'
import { resolveAsrModel, withSyncedModel } from './lib/asr-model.js'
import { pickWorkspaceCwd, detectKnowledgeCwd } from './lib/workspace.js'
import { ensureConfigFile, installChecklist, formatChecklist } from './lib/bootstrap.js'
import { buildSetupRows, summarizeSetup, setupHint } from './lib/setup-rows.js'
import { MeetingLifecycle } from './lib/lifecycle.js'
import { runDshTask, runShell } from './lib/twin.js'
import { loadPersona, personaBlock, readPersonaFile, writePersonaFile, appendPersonaSection, PERSONA_FILES, loadProfile, saveProfile, fullPersonaBlock } from './lib/persona.js'
import { profileHasKnowledge, pickKnowledgeProfile, isHostProfile, linkStatus, writeToKnowledge, detectKnowledge, hostHasKnowledge, writeViaHostApi } from './lib/knowledge.js'
import { MemoryStore } from './lib/memory.js'
import { LivingWorld } from './lib/living.js'
import { installAutoAnswer, pickRecommended } from './lib/auto-answer.js'
import { UiMap, pixelToRatio, ratioToPixel, probeOffsets, validRatio } from './lib/uimap.js'
import { isJoinUrl, isBareCode, extractJoinUrl, joinedAfterOpening } from './lib/join-url.js'
import { resolveApiKey, resolveDashScopeKey, keyInfo } from './lib/env.js'
import { CalibrationRunner, buildCalibrationPrompt } from './lib/calibrate-agent.js'
import { findMeeting, findMeetingInEvent, AutoJoinGate, isUserAuthoredEvent } from './lib/auto-join.js'
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
  /** 额外的会议进程名（会话枚举用）。内置已含 wemeetapp/CloudVideo/Feishu/DingTalk/Teams/Zoom/WXWork。 */
  meetingProcs: z.array(z.string()).default([]),
  /** 会议转写上下文：是否自动同步进 Agent 会话。 */
  /** 建议卡片：给用户看的会议建议，自动生成。 */
  advice: z.object({
    enabled: z.boolean().default(true),
    auto: z.boolean().default(true),
    characters: z.number().default(500),
    intervalMs: z.number().default(300000),
    cooldownMs: z.number().default(60000),
  }).default({}),
  /** Agent 发言：说给会议里所有人听，与建议卡片互不影响。 */
  reply: z.object({
    enabled: z.boolean().default(false),
    autoSpeak: z.boolean().default(true),
    candidates: z.number().default(2),
    cooldownMs: z.number().default(20000),
  }).default({}),
  context: z.object({
    autoInject: z.boolean().default(false),
    everyMs: z.number().default(60000),
    maxLines: z.number().default(20),
    maxChars: z.number().default(4000),
  }).default({}),
  /** 音频设备。 */
  devices: z.object({
    /** 环回采集的目标渲染设备（空 = 系统默认）；会议声音从哪个设备出，就填哪个。 */
    capture: z.string().default(''),
    /** 采集模式：loopback（采系统声音）或 device（采某个采集端点）。 */
    captureMode: z.union(['loopback', 'device']).default('loopback'),
    /** 采到静音时自动把默认播放切到该设备（通常填 CABLE Input）。留空则只报警不切换。 */
    forceCaptureDevice: z.string().default(''),
    /** 面板点过"对齐"后为 true：capture 只作参考，启动时仍跟随正在出声的设备 */
    captureAuto: z.boolean().default(false),
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
    apiKeyEnv: z.string().default('DASHSCOPE_API_KEY'),
    speed: z.number().default(1),
    /** 云端 pcm 采样率（OpenAI 返回 24000） */
    sampleRate: z.number().default(24000),
    /** 声音复刻：DashScope 业务空间 ID / 自定义端点 / 音色前缀。 */
    workspaceId: z.string().default(''),
    cloneBaseUrl: z.string().default(''),
    clonePrefix: z.string().default('soulmirror'),
    cloneVoiceId: z.string().default(''),
  }),
  /** 语音识别。local = 插件自带的 whisper.cpp 离线模型；openai = OpenAI 兼容云端；none = 关闭。 */
  asr: z.object({
    provider: z.union(['none', 'openai', 'local', 'dashscope']).default('dashscope'),
    baseUrl: z.string().default(''),
    model: z.string().default('whisper-1'),
    /** dashscope 用：阿里云百炼实时识别模型。 */
    dashscopeModel: z.string().default('paraformer-realtime-v2'),
    /** 读取密钥的环境变量名。 */
    apiKeyEnv: z.string().default('DASHSCOPE_API_KEY'),
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
    /** VAD 断句静音阈值（毫秒）。阿里文档建议快速断句场景用 400；实测 800→400 首句约快 0.5–0.7s。 */
    sentenceSilenceMs: z.number().default(400),
    punctuation: z.boolean().default(true),
    itn: z.boolean().default(true),
    disfluencyRemoval: z.boolean().default(true),
    speakerDiarization: z.boolean().default(false),
    languageHints: z.array(z.string()).default(['zh', 'en']),
    llmCorrect: z.boolean().default(false),
  }),
  /** 后台大脑：转写流 → 判定是否插话（LLM 走 OpenAI 兼容接口，不配则用规则+模板）。 */
  brain: z.object({
    baseUrl: z.string().default(''),
    provider: z.string().default(''),
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
  /** 会话里出现会议链接/会议号就自动入会。 */
  autoJoin: z.object({
    // 默认关闭：检测到会议就录音即可，不必自动替你入会。
    // 需要"贴链接自动入会"时在设置里单独打开。
    enabled: z.boolean().default(false),
    /** 只在会话里出现链接时自动入（true）还是连会议号也自动入（false=都要）。 */
    urlOnly: z.boolean().default(false),
    /** 同一个会议多久内不重复自动入（毫秒）。 */
    cooldownMs: z.number().default(300000),
  }),
  /** 自动标定：首次安装 / 入会连续失败时，交给 computer-use 去试出按钮位置。 */
  autoCalibrate: z.boolean().default(true),
  /** 连续失败几次就重新标定。 */
  recalibrateThreshold: z.number().default(2),
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
    /** 会议会话的工作目录。留空 = 继承你当前会话的目录。 */
    workspaceCwd: z.string().default(''),
    /** 是否继承当前活动会话的目录（默认是）。关掉后只用 workspaceCwd 或插件私有目录。 */
    useActiveWorkspace: z.boolean().default(true),
    /** dsh 的 profile 名。 */
    profile: z.string().default('headless'),
    /** 单次任务超时（毫秒）。 */
    timeoutMs: z.number().default(180000),
    /** 允许执行的本机 shell 白名单命令前缀（空 = 禁用 shell）。 */
    allowShell: z.array(z.string()).default([]),
  }),
  /** 无人值守：DSH 弹确认卡片时，超时按推荐项自动应答，避免整轮卡死。 */
  autoAnswer: z.object({
    /** 默认关闭：无人值守的便利不能以"可能替人授权"为代价。 */
    enabled: z.boolean().default(false),
    /** 等多久没人答就自动选（毫秒）。只对问句生效，权限审批永不接管。 */
    timeoutMs: z.number().default(5000),
    /** 必须限定会话：只有这个 sessionId 的问句才接管。 */
    onlyForSessionId: z.string().default(''),
    /** 或按前缀限定（例如会议会话的 id 前缀）。 */
    onlyForSessionPrefix: z.string().default(''),
  }),
  /** 会后写回知识库（通过 DSH 的 knowledge 工具完成）。 */
  /** 会议纪要是否交给 DSH 后台任务（独立进程）去写。默认开。 */
  minutesViaDsh: z.boolean().default(true),
  /** 用哪个 profile 跑这台后台任务（空 = 跟 twin.profile 或 headless）。 */
  minutesProfile: z.string().default(''),
  /** 后台任务超时（毫秒）。读整场转写 + 写长文，给足 5 分钟。 */
  minutesTimeoutMs: z.number().default(300000),
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
  /** 工作模式：transcribe=只转录（不判定不发言不建会话）；agent=开启自动回复 */
  mode: z.union(['transcribe', 'agent']).default('transcribe'),
  policy: z.union(['observe', 'suggest', 'auto']).default('auto'),
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
    // 总开关：默认关。必须在面板里打开之后，各功能才工作
    enabled: config.enabled === true,
    appPath: config.appPath || '',
    windowTitle: config.windowTitle || '腾讯会议',
    windowClass: config.windowClass || 'VideoMainWindow|FloatSpeakingWnd|MeetingMainWindow|MeetingView',
    processName: config.processName || 'wemeetapp',
    meetingProcs: Array.isArray(config.meetingProcs) ? config.meetingProcs : [],
    // 转写上下文：默认不自动送进会话（每送一次都是一轮真实对话，会产生费用）
    // agent 的工作目录：留空则自动对齐知识库（能直接看文档/制品）
    // 桌面宠物：可选。用一个小窗口显示会议助手的状态，并可直接操作。
    // 桌面宠物：可选。对接 dsh-pet（不自建窗口），它没装/没跑时安静降级。
    pet: {
      enabled: config.pet?.enabled !== false,
      sayInBubble: config.pet?.sayInBubble !== false,
      menu: config.pet?.menu !== false,
      petName: String(config.pet?.petName || ''),
      base: String(config.pet?.base || ''),
    },
    workspace: { cwd: String(config.workspace?.cwd || '') },
    // 入会总超时：UI 探测步骤多，卡住时必须自己认输而不是让用户干等
    // 可选插件缺失时是否自动下载安装：默认关闭
    // （会联网、会改 profile 依赖，必须用户显式开启）
    depsAutoInstall: config.deps?.autoInstall === true,
    joinTimeoutMs: Number(config.joinTimeoutMs) || 20000,
    context: { autoInject: false, everyMs: 60000, maxLines: 20, maxChars: 4000, ...(config.context || {}) },
    // 建议卡片：给"人"看的，自动生成、可关
    advice: {
      enabled: config.advice?.enabled !== false,
      auto: config.advice?.auto !== false,
      characters: config.advice?.characters || DEFAULT_ADVICE_RULE.characters,
      intervalMs: config.advice?.intervalMs || DEFAULT_ADVICE_RULE.intervalMs,
      cooldownMs: config.advice?.cooldownMs || DEFAULT_ADVICE_RULE.cooldownMs,
    },
    // Agent 发言：说给"会议里所有人"听的，独立开关
    reply: {
      enabled: config.reply?.enabled === true,
      // Agent 的定位是"全自动说出来"，所以默认就开口；
      // 想要先看候选再决定，才把它关掉（previewOnly）
      autoSpeak: config.reply?.autoSpeak !== false,
      candidates: config.reply?.candidates || 1,
      cooldownMs: config.reply?.cooldownMs || 20000,
    },
    devices: { switchMic: true, capture: '', captureMode: 'loopback', forceCaptureDevice: '', captureAuto: false, speak: 'CABLE Input', micName: '', micRestore: '', ...(config.devices || { }) },
    tts: {
      provider: 'dashscope', voice: 'longxiaochun_v2', rate: 0,
      baseUrl: '', model: 'cosyvoice-v2', apiKeyEnv: 'DASHSCOPE_API_KEY', apiKey: '', speed: 1, sampleRate: 16000,
      workspaceId: '', cloneBaseUrl: '', clonePrefix: 'soulmirror', cloneVoiceId: '',
      ...(config.tts || {}),
    },
    brain: { baseUrl: '', provider: '', model: '', apiKeyEnv: 'BRAIN_API_KEY', apiKey: '', profile: 'SoulMirror', minGapMs: 8000, gate: 'llm', ...(config.brain || {}) },
    twin: { enabled: true, autoDelegate: true, reportSpeak: true, summarize: true, autoSession: true, profile: 'headless', timeoutMs: 180000, allowShell: [], ...(config.twin || {}) },
    autoAnswer: { enabled: false, timeoutMs: 5000, onlyForSessionId: '', onlyForSessionPrefix: '', ...(config.autoAnswer || {}) },
    minutesViaDsh: config.minutesViaDsh !== false,
    minutesProfile: String(config.minutesProfile || ''),
    minutesTimeoutMs: Number(config.minutesTimeoutMs) || 300000,
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
      hotwords: [], vocabularyId: '', context: '', sentenceSilenceMs: 400,
      punctuation: true, itn: true, disfluencyRemoval: true, speakerDiarization: false,
      languageHints: ['zh', 'en'], llmCorrect: false, ...(config.asr || {}),
    },
    mode: config.mode === 'agent' ? 'agent' : 'transcribe',
    policy: config.policy || 'auto',
    autoWatch: config.autoWatch !== false,
    joinClickRatio: { x: 0, y: 0, ...(config.joinClickRatio || {}) },
    autoJoin: { enabled: false, urlOnly: false, cooldownMs: 300000, ...(config.autoJoin || {}) },
    autoCalibrate: config.autoCalibrate !== false,
    recalibrateThreshold: Number(config.recalibrateThreshold || 2),
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

  // mode 只是 reply.enabled 的视图：持久化里只认开关，避免两者不一致
  cfg.mode = cfg.reply.enabled ? 'agent' : 'transcribe'

  // ── 持久化配置 + 页面 API ────────────────────────────────────────────
  // 数据目录同样跟随 DSH 根，而不是写死 homedir：
  // 同一台机器上跑多个实例时，各实例的会议记录不应互相覆盖。
  const DSH_HOME_RESOLVED = (() => {
    // 显式出口优先：独立环境（便携版、容器、多实例测试）可以把配置钉死在固定目录，
    // 不随 DSH_HOME / profile 变化而漂移。否则换个启动方式就"保存的 Key 不见了"。
    const pinned = String(process.env.SOULMIRROR_HOME || '').trim()
    if (pinned) return pinned
    try {
      return resolveDshHome({ selfUrl: import.meta.url, env: process.env, homeDir: homedir(), exists: existsSync, join }) || join(homedir(), '.dsh')
    } catch { return join(homedir(), '.dsh') }
  })()
  const CONFIG_DIR = join(DSH_HOME_RESOLVED, 'soulmirror')
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
  // 首次安装自动落一份配置文件（带默认值）；已存在则只补新键，绝不覆盖用户设置
  try {
    const r = ensureConfigFile(CONFIG_FILE, cfg)
    if (r.created) logger?.info?.('[soulmirror] 已生成默认配置 ' + CONFIG_FILE)
    else if (r.merged) logger?.info?.('[soulmirror] 配置已补齐缺失项 ' + CONFIG_FILE)
    if (r.error) logger?.warn?.('[soulmirror] 配置自动生成失败：' + r.error)
  } catch { /* 不影响运行 */ }

  // ── 密钥存储：优先 DSH 凭据服务，没有才回退插件文件 ──────────────
  // 与 DSH 官方一致：机密不放配置里，配置只留"名字"。
  let credentialsService = null
  try { credentialsService = ctx.get?.('credentials') || null } catch { /* 没有就算了 */ }
  const keyStore = createKeyStore({ credentials: credentialsService, configDir: CONFIG_DIR, logger })
  /** 启动时把三个槽位读进内存缓存，供同步调用点使用 */
  const keyCache = { asr: '', tts: '', brain: '' }
  const keySourceOf = { asr: 'none', tts: 'none', brain: 'none' }
  /** 每个槽位最近一次读取错误（不隐藏：界面与 /status 都要能看到） */
  const keyErrors = { asr: '', tts: '', brain: '' }
  const loadKeysIntoCache = async () => {
    for (const slot of Object.keys(KEY_SLOTS)) {
      try {
        const hit = await keyStore.get(slot)
        keyCache[slot] = hit.value || ''
        keySourceOf[slot] = hit.source || 'none'
        // 不吞错：读失败要如实记录并写日志
        keyErrors[slot] = hit.error || ''
        if (hit.source === 'error') {
          logger?.warn?.('[soulmirror] 密钥读取失败（' + slot + '）：' + (hit.error || '未知原因'))
        }
      } catch (e) {
        keyCache[slot] = ''
        keySourceOf[slot] = 'error'
        keyErrors[slot] = e && e.message ? e.message : String(e)
        logger?.warn?.('[soulmirror] 密钥读取异常（' + slot + '）：' + keyErrors[slot])
      }
    }
  }
  if (credentialsService) logger?.info?.('[soulmirror] 密钥走 DSH 凭据存储（' + keyStore.mode + '）')
  else logger?.info?.('[soulmirror] 密钥走插件文件（' + keyStore.describeLocation().path + '）')

  /** 同步取密钥：内存缓存 → 旧字段（兼容未迁移）→ 空 */
  /** 缺密钥时给出可操作原因：区分"没配"与"读取失败" */
  function keyProblem(slot) {
    const err = keyErrors[slot] || ''
    if (err) return '密钥读取失败（' + slot + '）：' + err + ' → 请检查 DSH 凭据存储的读写权限或修复后重试'
    return ''
  }
  const keyFor = (slotCfg, slot) => {
    if (keyCache[slot]) return keyCache[slot]
    return (slotCfg && slotCfg.apiKey) || ''
  }

  // 启动收尾：加载缓存；并把配置里的明文 Key 搬进安全存储（迁移后从配置里删掉）
  const initKeys = async () => {
    try {
      await loadKeysIntoCache()
      const legacy = pickLegacyKeys(cfg)
      if (legacy.asr || legacy.tts || legacy.brain) {
        const r = await keyStore.migrate(legacy)
        if (r.migrated.length) {
          logger?.info?.('[soulmirror] 已把明文密钥迁进安全存储：' + r.migrated.join('、'))
          // 从配置里抹掉明文，只保留"名字"
          for (const slot of ['asr', 'tts', 'brain']) {
            if (cfg[slot]) cfg[slot].apiKey = ''
            if (stored[slot]) stored[slot].apiKey = ''
          }
          try { savePersisted({}) } catch { /* ignore */ }
          await loadKeysIntoCache()
        }
        if (r.failed.length) logger?.warn?.('[soulmirror] 密钥迁移失败：' + r.failed.join('；'))
      }
    } catch (e) {
      logger?.warn?.('[soulmirror] 密钥初始化失败：' + e.message)
    }
  }
  // 不阻塞启动：读不到就当没配置，用的时候会再报
  initKeys().catch(() => {})

  function publicConfig() {
    return {
      enabled: cfg.enabled,
      policy: cfg.policy,
      devices: cfg.devices,
      context: cfg.context,
      advice: cfg.advice,
      reply: cfg.reply,
      asr: {
        provider: cfg.asr.provider,
        // 显示真实下发的模型，而不是另一个字段
        model: resolveAsrModel(cfg.asr),
        dashscopeModel: cfg.asr.dashscopeModel,
        baseUrl: cfg.asr.baseUrl,
        apiKeyEnv: cfg.asr.apiKeyEnv,
        apiKey: '',
        keySet: keyInfo(cfg.asr).set,
        keySource: keyInfo(cfg.asr).source,
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
        keySet: !!resolveDashScopeKey({ ...cfg.tts, apiKey: keyFor(cfg.tts, 'tts') }).key,
        keySource: resolveDashScopeKey({ ...cfg.tts, apiKey: keyFor(cfg.tts, 'tts') }).source,
        workspaceId: cfg.tts.workspaceId || '',
        cloneBaseUrl: cfg.tts.cloneBaseUrl || '',
        clonePrefix: cfg.tts.clonePrefix || 'soulmirror',
        cloneVoiceId: cfg.tts.cloneVoiceId || '',
      },
      brain: {
        baseUrl: cfg.brain.baseUrl,
        provider: cfg.brain.provider || '',
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

  /**
   * 保存持久化配置。
   *
   * 关键：**必须如实返回成功/失败**。
   * 原来写盘失败只记一条 warn，接口照样回"已保存"，于是界面显示已连接，
   * 刷新/重启后又变成"未连接"——用户看到的就是"保存了但不生效"。
   * 这种失败在别的机器上常见于安装目录不可写。
   *
   * @returns {{ok: boolean, path: string, error: string}}
   */
  function savePersisted(patch) {
    const clearBrainKey = !!(patch && patch.brain && patch.brain.clearKey === true)
    if (clearBrainKey) {
      cfg.brain.apiKey = ''
      if (stored.brain) stored.brain.apiKey = ''
    }
    const keep = patchToStore(patch)
    const prevStored = stored
    // cfg 是 const，不能整体替换：记住本次补丁动过的顶层键的原值，失败时原地还原
    const touched = Object.keys(keep)
    const snapshot = {}
    for (const k of touched) snapshot[k] = cfg[k] === undefined ? undefined : JSON.parse(JSON.stringify(cfg[k]))
    stored = deepMerge(stored, keep)
    Object.assign(cfg, deepMerge(cfg, keep))
    try {
      mkdirSync(CONFIG_DIR, { recursive: true })
      const text = JSON.stringify(stored, null, 2)
      writeFileSync(CONFIG_FILE, text, 'utf8')
      const back = readFileSync(CONFIG_FILE, 'utf8')
      if (back !== text) throw new Error('回读内容与写入不一致')
      return { ok: true, path: CONFIG_FILE, error: '' }
    } catch (e) {
      stored = prevStored
      for (const k of touched) {
        if (snapshot[k] === undefined) delete cfg[k]
        else cfg[k] = snapshot[k]
      }
      const msg = e && e.message ? e.message : String(e)
      logger?.warn?.('[soulmirror] 保存配置失败: ' + msg + ' → ' + CONFIG_FILE)
      return { ok: false, path: CONFIG_FILE, error: msg }
    }
  }

  const EDITABLE = {
    asr: ['provider', 'model', 'dashscopeModel', 'baseUrl', 'apiKeyEnv', 'apiKey', 'chunkSeconds', 'lang'],
    tts: ['provider', 'model', 'voice', 'sampleRate', 'apiKeyEnv', 'apiKey', 'speed', 'workspaceId', 'cloneBaseUrl', 'clonePrefix', 'cloneVoiceId'],
    brain: ['baseUrl', 'provider', 'model', 'apiKeyEnv', 'apiKey', 'profile', 'minGapMs'],
    devices: ['capture', 'captureMode', 'speak', 'micName', 'micRestore', 'micInitiallyMuted'],
  }
  function pick(obj, keys) {
    const out = {}
    for (const k of keys) {
      if (obj && obj[k] !== undefined) {
        // 页面拿不到已保存密钥（只显示掩码），空值不能覆盖旧密钥。
        if (k === 'apiKey' && !obj[k]) continue
        out[k] = obj[k]
      }
    }
    return out
  }
  function patchToStore(patch) {
    const keep = {}
    for (const k of ['enabled', 'policy', 'apps', 'activeApp', 'meetingCode', 'meetingCodeManual', 'userName', 'wakeWords', 'autoWatch']) if (patch[k] !== undefined) keep[k] = patch[k]
    for (const k of Object.keys(EDITABLE)) if (patch[k] !== undefined) keep[k] = pick(patch[k], EDITABLE[k])
    return keep
  }

  function voiceCloneUrl() {
    if (cfg.tts.cloneBaseUrl) return cfg.tts.cloneBaseUrl
    if (cfg.tts.workspaceId) return `https://${cfg.tts.workspaceId}.cn-beijing.maas.aliyuncs.com/api/v1/services/audio/tts/customization`
    return 'https://dashscope.aliyuncs.com/api/v1/services/audio/tts/customization'
  }

  function audioDataUri(input) {
    const text = String(input || '').trim()
    if (!text) throw new Error('缺少参考音频')
    if (/^https?:\/\//i.test(text) || /^data:/i.test(text)) return text
    if (!existsSync(text)) throw new Error('音频文件不存在: ' + text)
    const lower = text.toLowerCase()
    const mime = lower.endsWith('.mp3') ? 'audio/mpeg' : lower.endsWith('.m4a') ? 'audio/mp4' : 'audio/wav'
    return `data:${mime};base64,` + readFileSync(text).toString('base64')
  }

  function voiceCloneKey() {
    return resolveDashScopeKey({ ...cfg.tts, apiKey: keyFor(cfg.tts, 'tts') }).key
  }

  async function voiceEnrollment(action, input) {
    const key = voiceCloneKey()
    if (!key) throw new Error('未配置 DashScope Key（tts.apiKey 或 DASHSCOPE_API_KEY）')
    const res = await fetch(voiceCloneUrl(), {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'voice-enrollment', input: { action, ...input } }),
      signal: AbortSignal.timeout(120000),
    })
    const text = await res.text()
    let data
    try { data = JSON.parse(text) } catch { data = { raw: text } }
    if (!res.ok || data?.code) throw new Error(data?.message || data?.code || `HTTP ${res.status}`)
    return data
  }

  function captureWorkspace(data) {
    let ws = data?.workspace_id || data?.output?.workspace_id || data?.workspaceId || ''
    if (!ws) {
      const m = String(voiceCloneUrl()).match(/^https:\/\/([^.]+)\.(?:cn-beijing|ap-southeast-1)\.maas\.aliyuncs\.com/i)
      if (m) ws = m[1]
    }
    if (ws && ws !== cfg.tts.workspaceId) {
      cfg.tts.workspaceId = ws
      savePersisted({ tts: { workspaceId: ws } })
    }
    return ws
  }

  function voiceListOf(data) {
    const arr = data?.output?.voices || data?.output?.voice_list || data?.output?.data || []
    if (!Array.isArray(arr)) return []
    return arr.map((v) => (typeof v === 'string' ? v : (v.voice_id || v.voiceId || v.id || v.name || ''))).filter(Boolean)
  }

  async function ttsVoiceIds() {
    if (!voiceCloneKey() || !cfg.tts.workspaceId) return []
    try {
      const data = await voiceEnrollment('list_voice', { prefix: cfg.tts.clonePrefix || undefined, page_index: 0, page_size: 20 })
      return voiceListOf(data)
    } catch {
      return []
    }
  }

  const apiHandler = async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://local')
    const sub = url.pathname.replace(/^\/api\/soulmirror\/?/, '')
    // 任何写操作都会改变状态，先让状态探测缓存失效：
    // 否则"刚启用/刚切软件"之后会读到旧快照（表现为 armed=false、apps 里没有新软件）
    if (req.method === 'POST') { probeCache.at = 0; probeCache.value = null; probeCache.slow = false }
    const json = (code, data) => {
      res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
      res.end(JSON.stringify(data))
    }
    try {
      if (req.method === 'GET' && (sub === '' || sub === 'config')) return json(200, publicConfig())
      if (req.method === 'GET' && sub === 'models') {
        const out = { llm: null, speech: null, tts: { models: ['cosyvoice-v2', 'cosyvoice-v1'], voices: [cfg.tts.voice, cfg.tts.cloneVoiceId].filter(Boolean) } }
        try {
          const sc = ctx.get('sessionController')
          if (sc?.modelCatalog) out.llm = await sc.modelCatalog()
        } catch (e) { out.llmError = e.message }
        try {
          const sp = ctx.get('speechController')
          if (sp?.catalog) out.speech = await sp.catalog()
        } catch (e) { out.speechError = e.message }
        try {
          const voices = await ttsVoiceIds()
          if (voices.length) out.tts.voices = Array.from(new Set([...out.tts.voices, ...voices]))
        } catch (e) { out.tts.error = e.message }
        return json(200, out)
      }
      if (req.method === 'GET' && sub === 'preflight') {
        // 采集链路体检：说清"能不能转录、卡在哪、怎么修"
        // ?net=1 会额外做一次 ASR 连通握手（默认不做，避免额外网络请求）
        try {
          const wantNet = /[?&]net=1/.test(req.url || '')
          const env = await collectPreflightEnv({ probeNet: wantNet })
          const report = buildPreflight(env)
          lastPreflight = report
          return json(200, { ok: report.ok, ...report })
        } catch (e) {
          return json(200, { ok: false, verdict: '体检失败：' + e.message, error: e.message })
        }
      }
      if (req.method === 'GET' && sub === 'status') {
        // 面板每秒轮询：探测结果缓存 15 秒，避免把 UI 拖到超时
        const nowMs = Date.now()
        const statusStartedAt = nowMs
        if (probeCache.slow && probeCache.at && nowMs - probeCache.at < 15000 && probeCache.value) {
          return json(200, probeCache.value)
        }
        // 未开启时不做实时探测：少一次 PowerShell 调用，也完全不碰桌面
        const liveApp = cfg.enabled ? await detectMeetingApp() : meetingApp(cfg.activeApp || '')
        const codeInfo = await currentMeetingCode(liveApp)
        const statusWins = await listWindows()
        // 挑标题用于展示：排除"标题就是进程名"或空标题的窗口（腾讯会议会留一个 wemeetapp 的后台窗）
        const procName = String(liveApp.proc || '').toLowerCase()
        const liveWin = pickMeetingWindows(statusWins, liveApp.title, liveApp.proc)
          .filter((w) => {
            const title = String(w.title || '').trim()
            if (!title) return false
            if (procName && title.toLowerCase() === procName) return false
            return true
          })
          .sort((a, b) => (b.w * b.h) - (a.w * a.h))[0]
        const demoSnap = demo.snapshot()
        const __payload = {
          demo: demoSnap,
          partial: (demoSnap && demoSnap.running) ? (demoSnap.partial || '') : (session.partial || ''),
          session: session.snapshot(),
          transcript: (demoSnap && (demoSnap.running || demoSnap.lines > 0))
            ? demoSnap.transcript.slice(-60)
            : session.transcript.slice(-60),
          tasks: (agent.tasks || []).slice(0, 10),
          apps: (cfg.apps || []).map((a) => ({ name: a.name, proc: a.proc || '', active: (cfg.activeApp || '') === a.name })),
          autoAppSelect: cfg.autoAppSelect !== false,
          activeApp: cfg.activeApp || '',
          activeAppAuto: !!cfg.activeAppAuto,
          pendingKnowledge: (agent.pendingKnowledge || []).slice(0, 5),
          // 两个开关、候选词、以及所有"为什么没动/没说"的原因，都要能被界面读到
          advice: cfg.advice,
          reply: cfg.reply,
          replyState,
          adviceState: {
            at: adviceState.at,
            questions: (adviceState.questions || []).length,
            replies: (adviceState.replies || []).length,
            error: adviceState.error || '',
          },
          lastLlmError,
          lastSpeakError,
          lastSpeakInfo,
          postMeeting,
          optionalDeps,
          depsCheckedAt,
          pet: {
            openRequest: petOpenRequest,
            enabled: cfg.pet.enabled !== false,
            provider: 'dsh-pet',
            available: petAvail,
            menu: petMenuReady,
            lastPushed,
          },
          minutes: { runs: minutesRuns, skipped: minutesKeyRuns },
          lastModelProbe,
          // 采集链路体检（最近一次）：直接回答"为什么不转录"
          lastPreflight,
          // 当前问题清单：第一条就是最该处理的（界面横幅与排查都用它）
          issues: (() => {
            try {
              const lastLine = session.transcript && session.transcript.length
                ? Date.parse((session.transcript[session.transcript.length - 1] || {}).t || '') || 0
                : 0
              return collectIssues({
                preflight: lastPreflight,
                capturing: !!session.capturing,
                transcriptLines: (session.transcript || []).length,
                lastLineAgeSec: lastLine ? Math.round((Date.now() - lastLine) / 1000) : null,
                // 识别状态来自 asrState（{online,failed,lastError}），不是我编的字段
                asr: {
                  online: !!(session.asrState && session.asrState.online),
                  failed: !!(session.asrState && session.asrState.failed),
                  error: (session.asrState && session.asrState.lastError) || '',
                },
                keyErrors: { ...keyErrors },
                postMeeting: { phase: postMeeting.phase, error: postMeeting.error },
                captureError: session.lastError || '',
                captureDevice: session.deviceLabel || cfg.devices.capture || '',
                silentSec: session.silentSec || 0,
              })
            } catch { return [] }
          })(),
          // 配置落点自查：独立环境里"保存了却读不到"多半是两个路径不一致
          config: (() => {
            try {
              const exists = existsSync(CONFIG_FILE)
              let diskKey = { asr: false, tts: false, apiKeyEnv: '' }
              if (exists) {
                const j = JSON.parse(readFileSync(CONFIG_FILE, 'utf8').replace(/^\uFEFF/, ''))
                diskKey = {
                  asr: !!(j && j.asr && j.asr.apiKey),
                  tts: !!(j && j.tts && j.tts.apiKey),
                  apiKeyEnv: (j && j.asr && j.asr.apiKeyEnv) || '',
                }
              }
              return {
                dir: CONFIG_DIR,
                file: CONFIG_FILE,
                exists,
                // 磁盘上有没有存 Key（布尔，不含内容）
                diskHasKey: diskKey,
                // 运行时生效的 Key 来源：file / env / registry / none
                runtimeSource: keyInfo(cfg.asr).source,
                // 密钥到底存在哪：dsh-credentials（DSH 凭据服务）/ plugin-file（插件自带文件）
                keyStorage: keyStore.mode,
                keyStoragePath: keyStore.describeLocation().path,
                keys: { asr: !!keyCache.asr, tts: !!keyCache.tts, brain: !!keyCache.brain },
                keySourceOf: { ...keySourceOf },
    // 读取失败的原因：不隐藏，否则用户只会看到"没配置"
    keyErrors: { ...keyErrors },
                dshHome: DSH_HOME_RESOLVED,
              }
            } catch (e) { return { error: e.message, file: CONFIG_FILE } }
          })(),
          // 版本：插件版本与存储格式版本分开报（含义完全不同）
          version: versionInfo({ dshVersion: '' }),
          // 四层记忆与"越用越像"的进度
          memoryLayers: (() => {
            try {
              const md = join(personaDir, 'memory')
              const layers = layersStatus(md)
              const prof = loadProfile(personaDir)
              const conv = convergence({ profile: prof || emptyProfile(), dir: md })
              return { ...layers, convergence: conv }
            } catch { return null }
          })(),
          hostPort: hostPortInfo,
          pendingRecovery,
          // 内存水位与"可能无限增长"的计数器：崩溃前看一眼就知道是谁在涨
          mem: (function () {
            try {
              const m = process.memoryUsage()
              return {
                heapMb: Math.round(m.heapUsed / 1048576),
                rssMb: Math.round(m.rss / 1048576),
                peakMb: memPeakMb,
                recent: memHistory.slice(-6),
                transcriptLines: (session.transcript || []).length,
                judgementTurns: judgementTurns,
                gate: (typeof gateStats === 'function' ? gateStats() : null),
              }
            } catch { return null }
          })(),
          // 采集组件是否就绪：别人的机器上可能没编译出 mbridge.exe
          bridge: (function () {
            try {
              const r = ensureBridge()
              return { ok: !!r.ok, path: r.path || '', error: r.error || '' }
            } catch (e) {
              return { ok: false, path: '', error: e.message }
            }
          })(),
          depsAutoInstall: !!cfg.depsAutoInstall,
          sessionGate: (typeof gateStats === 'function' ? gateStats() : null),
          brainModel,
          world: (() => { try { return living.snapshot() } catch { return null } })(),
          partial: session.partial || '',
          meeting: {
            app: liveApp.name || cfg.activeApp || '全部',
            title: (liveWin && liveWin.title) || lifecycle.lastWindowTitle || '',
            since: lifecycle.startedAt,
            code: codeInfo.code,
            codeSource: codeInfo.source,
            inMeeting: await meetingActive(liveApp, statusWins),
          },
          models: { asr: cfg.asr.provider + ' / ' + resolveAsrModel(cfg.asr), tts: cfg.tts.provider + ' / ' + cfg.tts.model + ' / ' + cfg.tts.voice },
          devices: { capture: cfg.devices.capture || '默认渲染设备', speak: cfg.devices.speak },
          brain: brain.stats,
          agent,
          mic: mic.state,
          enabled: cfg.enabled === true,
          mode: cfg.mode || 'transcribe',
          armed: isArmed(),
          auto: !!(cfg.autoWatch && lifecycle.timer),
          lifecycle: lifecycle.snapshot(),
        }
        probeCache.value = __payload
        probeCache.at = Date.now()
        probeCache.slow = (Date.now() - statusStartedAt) > 3000
        return json(200, __payload)
      }
      if (req.method === 'POST' && sub === 'app') {
        const bufApp = []
        for await (const chunk of req) bufApp.push(chunk)
        const body = JSON.parse(Buffer.concat(bufApp).toString('utf8') || '{}')
        const pickName = String(body.name || '').trim()
        if (!pickName) {
          cfg.activeApp = ''
          cfg.activeAppAuto = false
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
        cfg.activeAppAuto = false
        cfg.autoAppSelect = false
        savePersisted({ activeApp: hit.name, autoAppSelect: false })
        logger?.info?.('[soulmirror] 手动切换会议软件：' + hit.name)
        return json(200, { ok: true, activeApp: hit.name, apps: (cfg.apps || []).map((a) => ({ name: a.name, proc: a.proc || '' })) })
      }
      if (req.method === 'GET' && sub === 'health') {
        const snap = session.snapshot()
        const last = session.transcript[session.transcript.length - 1]
        const lastAgeMs = last && last.t ? Math.max(0, Date.now() - Date.parse(last.t)) : null
        const asr = snap.asr || {}
        const problems = []
    // 缺密钥时采集根本不会启动，健康检查必须说出来
    try {
      if (cfg.asr.provider !== 'none' && !resolveDashScopeKey({ ...cfg.asr, apiKey: keyFor(cfg.asr, 'asr') }).key) {
        problems.push('缺少语音识别密钥：在「会议 → 配置 → 语音识别」填 Key，或设置环境变量 ' +
          (cfg.asr.apiKeyEnv || 'DASHSCOPE_API_KEY'))
      }
    } catch { /* ignore */ }
        if (cfg.enabled && session.capturing && !(asr.online)) problems.push('语音识别未连接')
        if (cfg.enabled && session.capturing && (asr.failed)) problems.push('语音识别重连失败次数用尽')
        if (lastAgeMs !== null && lastAgeMs > 120000 && session.capturing) problems.push('超过 2 分钟没有新转写')
        if ((asr.droppedMs || 0) > 5000) problems.push('断线累计丢失 ' + Math.round(asr.droppedMs / 1000) + ' 秒音频')
        if (budget.overBudget()) problems.push('已超出本次会议识别预算 ' + budget.limitMinutes + ' 分钟')
        return json(200, {
          ok: problems.length === 0,
          enabled: cfg.enabled === true,
          mode: cfg.mode || 'transcribe',
          problems,
          capture: {
            capturing: !!session.capturing,
      captureFailed: !!snap.captureFailed,
      silentSec: snap.silentSec || 0,
      recoveries: snap.recoveries || 0,
            device: snap.captureDevice || "",
            bytes: snap.bytes || 0,
      lastByteAgeMs: snap.lastByteAt ? (Date.now() - snap.lastByteAt) : null,
          },
          asr: {
            phase: asr.phase || 'idle',
            online: !!asr.online,
            reconnects: asr.reconnects || 0,
            droppedMs: asr.droppedMs || 0,
            bufferedMs: asr.bufferedMs || 0,
          },
          transcript: { lines: session.transcript.length, lastAgeMs },
          workspace: meeting ? { cwd: meeting.agentCwd || '', source: meeting.cwdSource || '' } : null,
          budget: budget.snapshot(),
          demo: demo.snapshot().running,
        })
      }

      if (req.method === 'GET' && sub === 'devices') {
        let rows = []
        let def = ''
        try {
          rows = (await listDevices()).filter((d) => d.flow === 'RENDER').map((d) => ({ name: d.name, index: d.index }))
          def = await defaultRenderDevice()
        } catch { /* 读不到就返回空表 */ }
        return json(200, {
          ok: true,
          devices: rows,
          defaultDevice: def,
          render: rows.map((d) => d.name),
          capture: rows.map((d) => d.name),
          current: cfg.devices.capture || '',
          auto: !!cfg.devices.captureAuto,
          note: cfg.devices.captureAuto
            ? '自动跟随：启动时优先用此刻正在出声的设备'
            : (cfg.devices.capture ? '已固定到你选的设备' : '未指定：按系统默认'),
        })
      }
      if (req.method === 'GET' && sub === 'setup') {
        const state = await collectSetupStateCached()
        const rows = buildSetupRows(state)
        return json(200, { ok: summarizeSetup(rows).ok, rows, hint: setupHint(rows), state, probe: probeJob })
      }
      // ── 会前准备：会邀 / 目标 / 背景（只存文字）──
      if (req.method === 'GET' && sub === 'prepare') {
        return json(200, loadPreparation(session.dir || lastSessionDir))
      }
      // Agent 发言候选词：GET 取当前候选，POST 生成或采用
      if (sub === 'reply') {
        if (req.method === 'GET') return json(200, { ok: true, ...replyState })
        const bufR = []
        for await (const chunk of req) bufR.push(chunk)
        const body = JSON.parse(Buffer.concat(bufR).toString('utf8') || '{}')
        if (body.text) {
          const r = await generateReplyCandidates(body.text)
          return json(200, r)
        }
        if (body.speak) {
          // 采用某一候选：真的说给会议听
          const said = await speakNow(String(body.speak))
          replyState = { ...replyState, spoken: said.ok ? body.speak : '' }
          return json(200, said)
        }
        if (body.enabled !== undefined || body.autoSpeak !== undefined) {
          if (body.enabled !== undefined) {
            cfg.reply.enabled = !!body.enabled
            cfg.mode = cfg.reply.enabled ? 'agent' : 'transcribe'
          }
          if (body.autoSpeak !== undefined) cfg.reply.autoSpeak = !!body.autoSpeak
          try { savePersisted({ reply: cfg.reply, mode: cfg.mode }) } catch { /* ignore */ }
          return json(200, { ok: true, reply: cfg.reply })
        }
        return json(400, { ok: false, error: '缺少参数' })
      }

      // 会中建议：GET 取缓存，POST 生成一次
      if (sub === 'advice') {
        if (req.method === 'GET') {
          return json(200, { ok: true, ...adviceState, lastLlmError })
        }
        const bufA = []
        for await (const chunk of req) bufA.push(chunk)
        const body = JSON.parse(Buffer.concat(bufA).toString('utf8') || '{}')
        if (body.enabled !== undefined || body.auto !== undefined) {
          if (body.enabled !== undefined) cfg.advice.enabled = !!body.enabled
          if (body.auto !== undefined) cfg.advice.auto = !!body.auto
          try { savePersisted({ advice: cfg.advice }) } catch { /* ignore */ }
          return json(200, { ok: true, advice: cfg.advice })
        }
        const r = await generateAdvice({ force: !!body.force })
        return json(200, r)
      }

      if (req.method === 'POST' && sub === 'context') {
        const bufC = []
        for await (const chunk of req) bufC.push(chunk)
        const body = JSON.parse(Buffer.concat(bufC).toString('utf8') || '{}')
        // auto 用于切换自动同步开关
        if (body.autoInject !== undefined) {
          cfg.context.autoInject = !!body.autoInject
          try { savePersisted({ context: cfg.context }) } catch { /* ignore */ }
          if (cfg.context.autoInject) startContextPump()
          return json(200, { ok: true, autoInject: cfg.context.autoInject })
        }
        const r = await injectTranscriptContext({ reason: 'manual', force: true })
        return json(200, r)
      }

      if (req.method === 'POST' && sub === 'prepare') {
        const bufP = []
        for await (const chunk of req) bufP.push(chunk)
        const body = JSON.parse(Buffer.concat(bufP).toString('utf8') || '{}')
        const dir = session.dir || lastSessionDir
        if (!dir) return json(200, { ok: false, error: '还没有会议目录：请先开始一次录音' })
        const saved = savePreparation(dir, body)
        return json(200, { ok: true, preparation: saved, dir })
      }

      // ── AI 润色会议目标：给 2~3 个候选，不直接替换原文 ──
      if (req.method === 'POST' && sub === 'polish') {
        const bufG = []
        for await (const chunk of req) bufG.push(chunk)
        const body = JSON.parse(Buffer.concat(bufG).toString('utf8') || '{}')
        const goal = String(body.goal || '').trim()
        if (!goal) return json(400, { ok: false, error: '没有目标可润色' })
        if (!completer) return json(200, { ok: false, error: '当前没有可用模型' })
        try {
          const raw = await completer([
            { role: 'system', content: '你是会议目标润色助手。把用户的目标改成 2-3 个更具体、可判断是否达成的表述，每条不超过 40 字。只输出 JSON 数组，不要解释。' },
            { role: 'user', content: goal },
          ])
          let list = []
          try {
            const s = String(raw || '').split('```')[1] || String(raw || '')
            list = JSON.parse(s.trim().replace(/^json\s*/i, ''))
          } catch { list = [] }
          list = (Array.isArray(list) ? list : []).map((x) => String(x || '').trim()).filter(Boolean).slice(0, 3)
          if (!list.length) return json(200, { ok: false, error: '模型没有给出可用候选' })
          return json(200, { ok: true, candidates: list })
        } catch (e) {
          return json(200, { ok: false, error: e.message })
        }
      }

      // ── 回看：历史会议列表 / 单场详情 ──
      if (req.method === 'GET' && sub === 'records') {
        const q = String(url.searchParams.get('q') || '').trim()
        const all = listRecords(CONFIG_DIR, 60)
        if (!q) return json(200, { ok: true, records: all.slice(0, 30), query: '', total: all.length })
        // 搜索命中要说明"为什么中"：目标 / 会邀 / 纪要 / 转写
        const hits = searchRecords(all, q, (dir) => loadRecord(dir, { transcriptLimit: 2000 }), 30)
        return json(200, { ok: true, records: hits, query: q, total: hits.length })
      }

      // 导出：?dir=&format=md|txt  →  返回文本与建议文件名（前端用 Blob 下载）
      if (req.method === 'GET' && sub === 'record/export') {
        const dir = String(url.searchParams.get('dir') || '')
        if (!dir || !dir.startsWith(CONFIG_DIR)) return json(400, { ok: false, error: '目录不合法' })
        const rec = loadRecord(dir, { transcriptLimit: 5000 })
        if (!rec) return json(404, { ok: false, error: '读不到记录' })
        const format = String(url.searchParams.get('format') || 'md') === 'txt' ? 'text' : 'markdown'
        const text = renderExport(rec, { format })
        return json(200, { ok: true, format, fileName: exportFileName(rec, format), text })
      }
      if (req.method === 'GET' && sub === 'record') {
        const dir = String(url.searchParams.get('dir') || '')
        if (!dir || !dir.startsWith(CONFIG_DIR)) return json(400, { ok: false, error: '目录不合法' })
        const r = loadRecord(dir)
        return json(200, r ? { ok: true, record: r } : { ok: false, error: '读不到记录' })
      }
      if (req.method === 'POST' && sub === 'offline') {
        const r = await runOfflinePass(session.dir)
        return json(200, r)
      }
      if (req.method === 'POST' && sub === 'setup') {
        const bufS = []
        for await (const chunk of req) bufS.push(chunk)
        const body = JSON.parse(Buffer.concat(bufS).toString('utf8') || '{}')
        const action = String(body.action || '')
        const reply = (extra = {}) => {
          setupCache = { at: 0, value: null }
          const stateP = collectSetupState()
          return stateP.then((state) => {
            const rows = buildSetupRows(state)
            return json(200, { ok: summarizeSetup(rows).ok, rows, hint: setupHint(rows), state, action, ...extra })
          })
        }

        if (action === 'config') {
          const r = ensureConfigFile(CONFIG_FILE, cfg)
          if (r.error) return json(200, { ok: false, error: r.error })
          return reply({ message: r.created ? '已生成默认配置' : '配置已是最新' })
        }

        if (action === 'build') {
          const r = buildBridge({ logger })
          return reply({ message: r.ok ? (r.skipped ? '桥接已存在' : '桥接编译完成') : '编译失败：' + (r.error || r.reason || '') })
        }

        if (action === 'key') {
          // 允许留空：空字符串就是"清空密钥"，不写就不动
          if (body.value === undefined) return reply({ message: '没有提供 value，未改动' })
          const value = String(body.value || '').trim()
          // 密钥写进安全存储（DSH 凭据服务，或插件自己的 credentials.json），
          // 不再落进 config.json —— 和设置混在一个文件里既可被同步也可能被误删。
          const wr = await keyStore.set('asr', value)
          await loadKeysIntoCache()   // 顺带复位 keyErrors
          if (!wr.ok) {
            return reply({
              ok: false,
              message: '保存失败：' + (wr.error || '未知原因') + '\n存储位置：' + JSON.stringify(keyStore.describeLocation()),
              saveError: wr.error || '',
            })
          }
          // 清掉可能残留的旧明文（迁移兜底）
          if (cfg.asr) cfg.asr.apiKey = ''
          if (stored.asr) stored.asr.apiKey = ''
          const sv = savePersisted({})
          if (!sv.ok) {
            logger?.warn?.('[soulmirror] 密钥已存好，但配置文件清理失败：' + sv.error)
          }
          return reply({
            message: value
              ? '密钥已保存 → ' + wr.mode + '（' + JSON.stringify(keyStore.describeLocation()) + '）'
              : '密钥已清空（转写不可用，其它功能照常）',
            keyStorage: wr.mode,
            keySource: keySourceOf.asr,
          })
        }

        if (action === 'probe-models') {
          // 真的连一次模型：ASR 走 WebSocket 握手，TTS 合成一个字听有没有音频回来
          const only = String(body.model || '').trim()
          const wantAsr = !only || only === 'asr'
          const wantTts = !only || only === 'tts'
          const [asr, tts] = await Promise.all([
            wantAsr ? probeAsrConn() : null,
            wantTts ? probeTtsConn() : null,
          ])
          const report = buildProbeReport({ asr, tts })
          lastModelProbe = {
            at: new Date().toISOString(),
            ok: report.ok,
            asr: asr ? { ok: !!asr.ok, ms: asr.ms || 0, kind: asr.ok ? '' : classifyProbeError(asr.error || '').kind } : null,
            tts: tts ? { ok: !!tts.ok, ms: tts.ms || 0, kind: tts.ok ? '' : classifyProbeError(tts.error || '').kind } : null,
          }
          return reply({ ok: report.ok, message: report.text, probeModels: lastModelProbe })
        }

        if (action === 'probe') {
          // 默认走"对齐会议正在用的设备"：秒级、不需要先出声
          if (!body.deep) {
            const r = await alignCaptureDevice()
            if (!r.device) {
              return reply({ message: '没读到任何渲染设备：确认系统里能放声音，或手动填 devices.capture' })
            }
            savePersisted({ devices: { capture: r.device, captureAuto: true } })
            setupCache = { at: 0, value: null }
            return reply({ message: '已对齐（自动跟随）：' + r.device + '（' + r.note + '）', picked: r.device, via: r.source })
          }
          if (probeJob.running) {
            return json(200, {
              ok: false, started: false,
              message: '正在试听中：' + probeJob.done + '/' + probeJob.total,
              probe: probeJob,
            })
          }
          const secs = Math.max(2, Math.min(10, Number(body.seconds) || 3))
          probeJob = { running: true, total: 0, done: 0, last: '', rows: [], best: '', error: '', at: Date.now(), seconds: secs }
          // 不 await：一次要测 N 个设备 × N 秒，等完再返回界面会像"没反应"
          runProbe(secs, (p) => {
            if (p.phase === 'start') { probeJob.total = p.total; probeJob.done = 0 }
            else { probeJob.done = p.done; probeJob.last = p.last || '' }
          }).then((r) => {
            probeJob.running = false
            probeJob.rows = r.rows || []
            probeJob.best = r.best || ''
            probeJob.bestRms = r.bestRms || 0
            probeJob.error = r.ok ? '' : (r.result || '')
            setupCache = { at: 0, value: null }
            if (r.ok && r.bestRms >= 0.004) {
              savePersisted({ devices: { capture: r.best } })
              probeJob.picked = r.best
            }
          }).catch((e) => {
            probeJob.running = false
            probeJob.error = e.message
          })
          return json(200, {
            ok: true, started: true,
            message: '开始试听 ' + (probeJob.total || '若干') + ' 个设备，每台 ' + secs + ' 秒，稍等十几秒…',
            probe: probeJob,
          })
        }

        if (action === 'vb-cable') {
          // 装驱动必须 UAC，这里只负责把"去哪装"和"装完怎么填"说清楚
          const zip = join(homedir(), 'Downloads', 'VBCABLE_Driver_Pack43.zip')
          return reply({
            message: existsSync(zip)
              ? '驱动包已在 ' + zip + '：右键以管理员运行解压后的 VBCABLE_Setup_x64.exe，装完回来点"检测"'
              : '需要你手动安装 VB-CABLE（免费）：下载后以管理员运行安装，装完点"检测"',
            manual: true,
            download: 'https://vb-audio.com/Cable/',
          })
        }

        if (action === 'calibrate') {
          const app = meetingApp(cfg.activeApp || '') || (await detectMeetingApp())
          const r = calibrator.trigger({ app: app.name, action: 'join', reason: '用户从面板手动触发' })
            .then(() => reply({ message: '已启动 computer-use 标定，稍后重试入会' }))
            .catch((e) => reply({ message: '标定启动失败：' + e.message }))
          return r
        }

        return json(400, {
          ok: false,
          // 旧宿主遇到新动作会走到这里：把"重启"写进错误里，别让用户只看到"未知动作"
          error: '未知动作：' + action + (action === 'probe-models' ? '（当前宿主是旧版本，重启 DSH 后可用）' : ''),
        })
      }

      if (sub === 'recover') {
      if (req.method === 'GET') {
        const list = await listPendingRecovery({ force: true })
        return json(200, {
          ok: true,
          pending: list,
          hint: list.length
            ? '有 ' + list.length + ' 场会议没整理完（进程被强杀或窗口被直接关闭）。数据都还在，可以补出纪要。'
            : '没有需要补整理的会议',
        })
      }
      if (req.method === 'POST') {
        const buf = []
        for await (const chunk of req) buf.push(chunk)
        const body = JSON.parse(Buffer.concat(buf).toString('utf8') || '{}')
        const dir = String(body.dir || '').trim()
        if (!dir) return json(400, { ok: false, error: '缺少 dir' })
        const r = await recoverMeeting(dir)
        return json(200, r)
      }
    }

    if (req.method === 'POST' && sub === 'demo') {
        const bufD = []
        for await (const chunk of req) bufD.push(chunk)
        const body = JSON.parse(Buffer.concat(bufD).toString('utf8') || '{}')
        const action = String(body.action || 'start')
        if (action === 'stop') { await demo.stop(); return json(200, { ok: true, demo: demo.snapshot() }) }
        if (action === 'status') return json(200, { ok: true, demo: demo.snapshot() })
        const snap = await demo.start({ speed: body.speed, real: body.real })
        return json(200, { ok: !snap.error, demo: snap, error: snap.error || undefined })
      }

      if (req.method === 'POST' && sub === 'mode') {
        const bufM = []
        for await (const chunk of req) bufM.push(chunk)
        const body = JSON.parse(Buffer.concat(bufM).toString('utf8') || '{}')
        const mode = body.mode === 'agent' ? 'agent' : 'transcribe'
        cfg.mode = mode
        // 关键：模式就是"是否让 Agent 发言"，必须同时改 reply.enabled，
        // 否则界面显示 Agent、后端却认为发言是关的（曾经真实发生过）
        cfg.reply.enabled = mode === 'agent'
        try { savePersisted({ mode, reply: cfg.reply }) } catch { /* ignore */ }
        logger?.info?.('[soulmirror] 模式切到 ' + mode + (mode === 'agent' ? '（自动回复）' : '（只转录）'))
        return json(200, { ok: true, mode })
      }

      if (req.method === 'POST' && sub === 'auto') {
        const bufA = []
        for await (const chunk of req) bufA.push(chunk)
        const action = JSON.parse(Buffer.concat(bufA).toString('utf8') || '{}').action
        if (action === 'start') {
          // 用户明确开启：这时才允许自动采集/入会/标定
          armed = true
          cfg.enabled = true
          cfg.autoWatch = true
          if (!lifecycle.timer) lifecycle.start()
          logger?.info?.('[soulmirror] 已开启会议功能（armed），允许自动操作')
        } else if (action === 'stop') {
          // 关闭：立刻解除，停止采集与所有自动动作
          armed = false
          cfg.enabled = false
          cfg.autoWatch = false
          lifecycle.stop()
          const stoppedDir = session.dir || ''
          const hadAudio = !!session.capturing
          logger?.info?.('[soulmirror] 已关闭会议功能（disarmed），不再自动操作')
          // 用户点"结束录音"= 这场会开完了：直接开始会后整理（离线重转写 + 纪要 + 知识库）
          if (hadAudio && stoppedDir) {
            // 统一入口：停采 + 去抖 + 整理都在 stopAndOrganize 里
            stopAndOrganize('结束录音', { wasCapturing: hadAudio })
              .then((o) => {
                // 状态由 stopAndOrganize 自维护（stopping→done/error），这里只记日志，
                // 否则会用错字段把 done 覆盖成空的纪要路径
                logger?.info?.('[soulmirror] 结束后整理：' + (o.organized ? '已开始/完成' : (o.reason || '跳过')))
              })
              .catch((e) => setPostMeeting({ phase: 'error', error: e.message }))
          }
        }
        try { savePersisted({ autoWatch: cfg.autoWatch, enabled: cfg.enabled }) } catch { /* ignore */ }
        return json(200, { ok: true, enabled: cfg.enabled === true, armed, auto: !!(cfg.autoWatch && lifecycle.timer), lifecycle: lifecycle.snapshot() })
      }
      if (req.method === 'POST' && sub === 'test') {
        const buf = []
        for await (const chunk of req) buf.push(chunk)
        const kind = (JSON.parse(Buffer.concat(buf).toString('utf8') || '{}').kind || 'tts')
        if (kind === 'tts') {
          const key = resolveDashScopeKey({ ...cfg.tts, apiKey: keyFor(cfg.tts, 'tts') }).key
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
            const ki = keyInfo(cfg.tts)
            return json(200, { ok: bytes > 0, bytes, keySource: ki.source, envName: ki.envName, speakDevice: cfg.devices.speak || '', micRestore: cfg.devices.micRestore || '' })
          } catch (e) { return json(200, { ok: false, error: e.message }) }
        }
        if (kind === 'asr') {
          const key = cfg.asr.apiKey || process.env[cfg.asr.apiKeyEnv || 'DASHSCOPE_API_KEY']
          if (!key) return json(200, { ok: false, error: '未配置 Key' })
          try {
            // 和真实采集用同一个解析，避免"测试通过、开会却用另一个模型"
            const a = startDashScopeAsr({ apiKey: key, model: resolveAsrModel(cfg.asr) })
            await a.open()
            await a.finish()
            return json(200, { ok: true })
          } catch (e) { return json(200, { ok: false, error: e.message }) }
        }

        // 触发判别自检：输入一句话，直接看会不会被当成"在等我回应"

      // 麦克风体检：会议到底在用哪个采集设备。改完会议设置后可以立刻验证。
        if (kind === 'mic') {
          try {
            const m = await meetingMicActive(cfg.processName || 'wemeetapp')
            const devices = (m.devices || []).map((d) => String(d))
            const cableActive = devices.some((d) => d.toLowerCase().includes('cable') && /state=1/.test(d))
            const active = devices.filter((d) => /state=1/.test(d)).map((d) => d.split('\t')[0])
            return json(200, {
              ok: true,
              meetingUsesVirtualMic: cableActive,
              activeDevices: active,
              devices,
              hint: cableActive ? '会议正在用虚拟麦克风，插件发言能听到' : '会议没有用虚拟麦克风：把它改成「与系统默认相同」',
            })
          } catch (e) {
            return json(200, { ok: false, error: e.message })
          }
        }

        if (kind === 'trigger') {
          const probe = String((JSON.parse(Buffer.concat(buf).toString('utf8') || '{}').text) || '你现在听到话')
          const r = detectTrigger(probe, {
            names: [...(cfg.brain.names || []), ...(cfg.reply.extraNames || [])],
            extraAddress: cfg.reply.extraAddress || [],
          })
          return json(200, { ok: true, text: probe, trigger: r, replyEnabled: cfg.reply.enabled, adviceEnabled: cfg.advice.enabled })
        }

        // brain 自检：走和真实会议同一套判定，并把模型原始输出带回来，
        // 这样"agent 不回复"能当场区分：模型报错 / 返回格式不对 / 判定不该说话
        if (kind === 'brain') {
          if (!completer) return json(200, { ok: false, error: '没有可用模型：先配置 brain.provider / brain.model' })
          const probe = String((JSON.parse(Buffer.concat(buf).toString('utf8') || '{}').text) || '你在吗？')
          let raw = ''
          const spy = async (messages) => { raw = await completer(messages); return raw }
          try {
            const decision = await brain.decide(
              { kind: 'question', reason: '手动自检', line: { text: probe, t: new Date().toISOString() } },
              { complete: spy, profile: cfg.brain.profile },
            )
            return json(200, { ok: true, raw, decision })
          } catch (e) {
            return json(200, { ok: false, error: e.message, raw })
          }
        }
        return json(200, { ok: false, error: '未知测试类型' })
      }
      if (req.method === 'POST' && sub === 'config') {
        const buf2 = []
        for await (const chunk of req) buf2.push(chunk)
        const patch = JSON.parse(Buffer.concat(buf2).toString('utf8') || '{}')
        // 保存时把 ASR 模型的两个字段对齐，避免旧字段读到过期值
        if (patch.asr) patch.asr = withSyncedModel({ ...cfg.asr, ...patch.asr })
        savePersisted(patch)
        return json(200, publicConfig())
      }
      if (req.method === 'POST' && sub === 'meeting') {
        const bufM = []
        for await (const chunk of req) bufM.push(chunk)
        const body = JSON.parse(Buffer.concat(bufM).toString('utf8') || '{}')
        if (body.detect) {
          const app = await detectMeetingApp()
          // 先做无副作用的被动扫描；读不到再按需主动点开「会议信息」
          let code = await detectMeetingCode(app)
          let source = code ? 'auto' : 'none'
          let reason = ''
          if (!code && body.active) {
            const r = await probeMeetingCodeActive(app)
            if (r.code) { code = r.code; source = 'auto' }
            reason = r.reason || ''
          }
          codeCache = { at: Date.now(), app: app.name, code, source }
          return json(200, {
            ok: !!code, app: app.name, code, source, reason,
            hint: code ? '' : '当前界面读不到会议号：可以手动填，或点「识别会议号」让我打开会议信息面板看一眼',
          })
        }
        const code = normalizeMeetingCode(body.code || '')
        const manual = body.manual !== false
        cfg.meetingCode = manual ? code : ''
        cfg.meetingCodeManual = manual && !!code
        codeCache = { at: Date.now(), app: '', code: cfg.meetingCode, source: cfg.meetingCodeManual ? 'manual' : 'none' }
        savePersisted({ meetingCode: cfg.meetingCode, meetingCodeManual: cfg.meetingCodeManual })
        return json(200, { ok: true, code: cfg.meetingCode, source: cfg.meetingCodeManual ? 'manual' : 'none' })
      }
      if (req.method === 'POST' && sub === 'voice/clone') {
        const bufV = []
        for await (const chunk of req) bufV.push(chunk)
        const body = JSON.parse(Buffer.concat(bufV).toString('utf8') || '{}')
        const prefix = String(body.prefix || cfg.tts.clonePrefix || 'soulmirror').replace(/[^0-9A-Za-z]/g, '').slice(0, 10) || 'soulmirror'
        const target = String(body.targetModel || cfg.tts.model || 'cosyvoice-v2')
        try {
          const data = await voiceEnrollment('create_voice', {
            target_model: target,
            prefix,
            audio: audioDataUri(body.audio),
            language_hints: ['zh'],
          })
          const voiceId = data?.output?.voice_id || data?.output?.voice || ''
          if (!voiceId) return json(200, { ok: false, error: '服务端未返回 voice_id', raw: data })
          const workspaceId = captureWorkspace(data)
          cfg.tts.cloneVoiceId = voiceId
          cfg.tts.voice = voiceId
          savePersisted({ tts: { cloneVoiceId: voiceId, voice: voiceId } })
          return json(200, { ok: true, voiceId, workspaceId, targetModel: target, endpoint: voiceCloneUrl() })
        } catch (e) { return json(200, { ok: false, error: e.message }) }
      }
      if (req.method === 'POST' && sub === 'voice/list') {
        const bufL = []
        for await (const chunk of req) bufL.push(chunk)
        const body = JSON.parse(Buffer.concat(bufL).toString('utf8') || '{}')
        try {
          const data = await voiceEnrollment('list_voice', {
            prefix: body.prefix || cfg.tts.clonePrefix || undefined,
            page_index: 0,
            page_size: 20,
          })
          const workspaceId = captureWorkspace(data)
          return json(200, { ok: true, data, voices: voiceListOf(data), workspaceId })
        } catch (e) { return json(200, { ok: false, error: e.message }) }
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

      // 可选依赖：GET 体检，POST 一键安装（用 DSH 自己的 plugin add）
      if (sub === 'deps') {
        if (req.method === 'GET') {
          const prof = profileNameNow()
          const deps = refreshOptionalDeps().map((d) => ({
            ...d,
            // 把命令直接算好给界面：用户可能想自己在终端里装（这是唯一一定有效的兜底）
            command: 'dsh plugin --profile ' + (prof || 'web') + ' add ' + d.pkg,
          }))
          return json(200, { ok: true, profile: prof, profileDir: profileDirNow(), deps, checkedAt: depsCheckedAt, autoInstall: !!cfg.depsAutoInstall })
        }
        const bufDep = []
        for await (const chunk of req) bufDep.push(chunk)
        const bodyDep = JSON.parse(Buffer.concat(bufDep).toString('utf8') || '{}')
        const pkg = String(bodyDep.pkg || '').trim()
        if (!pkg) return json(400, { ok: false, error: '缺少 pkg' })
        const prof = process.env.DSH_PROFILE || String(bodyDep.profile || '')
        if (!prof) return json(400, { ok: false, error: '拿不到当前 profile，无法安装' })
        const r = await installPlugin({ pkg, profile: prof })
        refreshOptionalDeps()
        return json(200, {
          ok: r.ok,
          pkg,
          profile: prof,
          command: 'dsh plugin --profile ' + prof + ' add ' + pkg,
          output: r.output.slice(-1200),
          error: r.error,
          deps: optionalDeps.map((d) => ({ ...d, command: 'dsh plugin --profile ' + prof + ' add ' + d.pkg })),
        })
      }

      // 桌面宠物（对接 dsh-pet）：GET 看状态与可用性，POST 开关联动
      if (sub === 'pet') {
        if (req.method === 'POST') {
          const bufPet = []
          for await (const chunk of req) bufPet.push(chunk)
          const bodyPet = JSON.parse(Buffer.concat(bufPet).toString('utf8') || '{}')
          if (bodyPet.enabled !== undefined) {
            cfg.pet.enabled = !!bodyPet.enabled
            try { savePersisted({ pet: cfg.pet }) } catch { /* ignore */ }
            if (cfg.pet.enabled) await ensurePetMenu()
          }
          if (bodyPet.action === 'push') await pushWorkStatus(true)
          if (bodyPet.action === 'menu') await ensurePetMenu(true)
          if (bodyPet.say) await pushSay(String(bodyPet.say))
        }
        return json(200, {
          ok: true,
          enabled: cfg.pet.enabled !== false,
          provider: 'dsh-pet',
          available: await probeDshPet(),
          menuRegistered: petMenuReady,
          state: derivePetState(petStatusSnapshot()),
          workStatus: toWorkStatus(derivePetState(petStatusSnapshot())),
          lastPushed,
        })
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

  // ── 是否"已开启会议功能" ─────────────────────────────────────────────
  // 关键：装了插件 ≠ 允许它动电脑。只有用户显式开启（面板开关 / meeting_agent_start）
  // 之后，才允许自动采集、自动建会话、自动标定、自动入会这些会碰桌面的动作。
  let armed = false
  /**
   * 采集链路体检的输入。
   *
   * 为什么需要它：别人报"模型和设备都配对，会议开始却没转录"，
   * 我本地却正常——差异全在机器侧（平台/桥接/端点/Key/网络）。
   * 这里把可探测的事实收集起来，交给 lib/preflight.js 判 PASS/FAIL。
   */
  /** 最近一次采集体检结果（界面与 /status 可读） */
  let lastPreflight = null

  async function collectPreflightEnv({ probeNet = false } = {}) {
    const env = {
      platform: process.platform,
      asrProvider: String(cfg.asr.provider || ''),
      asrKey: resolveDashScopeKey({ ...cfg.asr, apiKey: keyFor(cfg.asr, 'asr') }).key || '',
      asrKeySource: keyInfo(cfg.asr).source,
      lastCaptureError: session.lastError || '',
      deviceCount: 0,
      deviceName: session.deviceLabel || cfg.devices.capture || '',
      meetingActive: false,
    }
    // 桥接：文件在不在、能不能列端点
    // 注意：bridgeExe 是现成常量（toolsDir 也是常量，别当函数调）。
    // 之前写成 toolsDir() 抛 TypeError 被 catch 吞掉，体检就一直报"文件不存在"。
    try {
      env.bridgePresent = existsSync(bridgeExe)
      if (env.bridgePresent) {
        const r = await listDevices()
        env.bridgeRuns = Array.isArray(r) && r.length > 0
        env.deviceCount = (Array.isArray(r) ? r : []).filter((d) => d.flow === 'RENDER').length
      } else {
        env.bridgeRuns = false
      }
    } catch (e) {
      env.bridgeRuns = false
      // 文件明明在却列不出端点 → 这是"跑不起来"，不要误报成"文件不存在"
      env.bridgePresent = existsSync(bridgeExe)
      env.lastCaptureError = env.lastCaptureError || ('桥接探测失败：' + e.message)
    }
    // 会议窗口
    try {
      const wins = await listWindows()
      const app = await detectMeetingApp().catch(() => null)
      env.meetingActive = !!(app && await meetingActive(app, wins))
    } catch { /* ignore */ }
    // 网络：只有显式要求时才测（会发一次 WS 握手）
    env.asrReachable = null
    if (probeNet) {
      try {
        const r = await probeAsrConn()
        env.asrReachable = !!r.ok
        if (!r.ok) env.asrError = r.error || ''
      } catch (e) { env.asrReachable = false; env.asrError = e.message }
    }
    return env
  }

  const isArmed = () => armed === true && cfg.enabled === true


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
    return normalizeText(text).slice(0, 240)
  }

  /** 后台跑一个 DSH 任务，完成后（可选）在会议里汇报。 */
  async function startTaskInBackground(prompt) {
    const clean = String(prompt || '').trim()
    if (!clean) return null
    const key = taskKey(clean)
    const tasks = agent.tasks || []
    const running = tasks.filter((x) => x.status === 'running').length
    // 单飞：同时只跑一个任务。之前允许 2 个，两次触发会并行跑、各自汇报一次，
    // 听起来就是"同一件事说了两遍"。
    if (running >= 1) {
      logger?.warn?.('[soulmirror] 已有任务在跑，跳过本次：' + clean.slice(0, 40))
      return null
    }
    const duplicate = tasks.find((x) => {
      if (taskKey(x.prompt || '') !== key) return false
      if (x.status === 'running') return true
      const at = Date.parse(x.at || '')
      return x.status === 'done' && Number.isFinite(at) && Date.now() - at < 600_000
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
      if (speechGuard.recentlySpoken(why)) return item
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
      if (speechGuard.recentlySpoken(brief)) {
        logger?.info?.('[soulmirror] 汇报内容与刚才重复，跳过播报')
        return item
      }
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
    if (lineGuard.isDuplicate(clean)) return
    const item = { t: new Date().toISOString(), text: clean, role: 'assistant', reason }
    session.transcript.push(item)
    session.partial = ''
    // 走账本统一入口：保证"只增不改 + replaces 标记"的规则只有一处实现
    if (session.dir) session._appendTranscript?.(item)
    // 灵魂进食：记一条记忆 + 感知一次情绪（纯本地启发式，不调模型、不花钱）
    try {
      if (item.role !== 'assistant' && item.src !== 'gap') {
        living.absorb(item.text, { source: 'meeting', speaker: item.speaker || '' })
      }
    } catch { /* 魂不该挡路 */ }
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
    // 只有"用户手动指定"才跳过自动跟随；自动选中过的还要继续跟随
    if ((cfg.activeApp || '').trim() && !cfg.activeAppAuto) return null
    try {
      const wins = await listWindows()
      // 自动选中的结果**不落盘**：落盘后就等于"手动指定"，以后再也不重算，
      // 于是开着腾讯会议首页时会永远跟着腾讯会议，移动会议永远选不上。
      const micProcs = []
      try {
        const rows = await micUsage()
        const micPids = (Array.isArray(rows) ? rows : []).filter((r) => r && Number(r.state) === 1).map((r) => Number(r.pid))
        for (const w of wins) if (micPids.includes(Number(w.pid))) micProcs.push(String(w.proc || ''))
      } catch { /* ignore */ }
      const ranked = pickApp({ apps: cfg.apps || [], windows: wins, micProcs })
      const hit = ranked ? { app: ranked.app, confidence: ranked.reasons.join('、') || ('score ' + ranked.score) } : null
      if (!hit) return null
      if (cfg.activeApp === hit.app.name) return hit
      cfg.activeApp = hit.app.name
      cfg.activeAppAuto = true
      logger?.info?.('[soulmirror] 自动跟随会议软件：' + hit.app.name + '（' + hit.confidence + '）')
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
    // 先按"谁真的在开会"打分：会议中窗口 > 占着麦克风 > 前台 > 窗口大小 > 标题
    // （旧逻辑按配置顺序取第一个有窗口的，腾讯会议留在托盘就能抢走移动会议）
    try {
      // micUsage() 返回 [{device, pid, proc, state}]，其中 proc 经常是空的，
      // 所以"谁占着麦克风"要用 pid 去对窗口（同一进程的窗口 pid 相同）。
      const micProcs = []
      try {
        const rows = await micUsage()
        const micPids = (Array.isArray(rows) ? rows : [])
          .filter((r) => r && Number(r.state) === 1)
          .map((r) => Number(r.pid))
        for (const r of (Array.isArray(rows) ? rows : [])) {
          if (r && Number(r.state) === 1 && r.proc) micProcs.push(String(r.proc))
        }
        if (micPids.length) {
          for (const w of wins) if (micPids.includes(Number(w.pid))) micProcs.push(String(w.proc || ''))
        }
      } catch { /* 拿不到麦克风信息就只按窗口打 */ }
      const picked = pickApp({ apps: ordered, windows: wins, micProcs })
      if (picked && picked.score > 0) {
        logger?.info?.('[soulmirror] 选中的会议软件：' + picked.app.name + '（' + picked.reasons.join('、') + '，' + picked.score + ' 分）')
        return meetingApp(picked.app.name)
      }
    } catch (e) {
      logger?.warn?.('[soulmirror] 会议软件打分失败，回落旧规则：' + e.message)
    }

    // 兜底：没有强证据时，保留原来的"有窗口就算"（只是不再抢在打分前面）
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
    // 真正的提取逻辑在 lib/meeting-code.js（可单测），这里只做委托
    return extractMeetingCode(text).code
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
    // 会议号可能只在"悬浮小窗"(FloatSpeakingWnd) 或会中窗口里，主窗口反而没有。
    // 所以按窗口逐个扫：会中窗口优先，最后才看标题和剪贴板。
    const wins = await listWindows().catch(() => [])
    const proc = String(app.proc || '').toLowerCase()
    const mine = wins.filter((w) => {
      if (proc && String(w.proc || '').toLowerCase() !== proc) return false
      return true
    })

    // 会中窗口优先：悬浮窗 / 视频窗 / 会议视图 / 参与者窗
    const inMeetingCls = /FloatSpeakingWnd|VideoMainWindow|MeetingView|ParticipantWnd|VideoCellWnd|MeetingMainWindow/i
    const ranked = [...mine].sort((a, b) => {
      const sa = inMeetingCls.test(a.cls || '') ? 0 : 1
      const sb = inMeetingCls.test(b.cls || '') ? 0 : 1
      return sa - sb
    })

    // 1) 逐个窗口扫控件文本（最多 4 个窗口，避免太慢）
    for (const w of ranked.slice(0, 4)) {
      if (!w.cls) continue
      try {
        const text = await dump(w.title || app.title, 320, { ...meetingOpts(app), cls: w.cls })
        const fromUi = normalizeMeetingCode(String(text || '').replace(/\t/g, ' '))
        if (fromUi) return fromUi
      } catch { /* 换下一个窗口 */ }
    }

    // 2) 窗口标题里带会议号
    const fromTitle = normalizeMeetingCode(ranked.map((w) => w.title || '').join(' '))
    if (fromTitle) return fromTitle

    // 3) 剪贴板（用户刚复制的邀请文案）
    return normalizeMeetingCode(await clipboardText())
  }

  /**
   * 主动识别：只在用户显式点「识别会议号」时调用。
   *
   * 为什么需要：腾讯会议「快速会议」主界面的可访问树里压根没有会议号，
   * 号只出现在「会议信息」面板里。被动扫描再怎么写也读不到，
   * 必须去点开那块面板读一次，读完按 Esc 关掉。
   *
   * 代价：这是一次真实点击。所以绝不放在每秒轮询里。
   */
  let activeProbeAt = 0
  async function probeMeetingCodeActive(app) {
    if (!cfg.enabled) return { ok: false, code: '', reason: '插件未开启，不做界面操作' }
    if (Date.now() - activeProbeAt < 5000) return { ok: false, code: '', reason: '刚探测过，稍等几秒' }
    activeProbeAt = Date.now()

    const opts = meetingOpts(app)
    const wins = await listWindows().catch(() => [])
    const proc = String(app.proc || '').toLowerCase()
    const mine = wins.filter((w) => !proc || String(w.proc || '').toLowerCase() === proc)
    const inMeeting = mine.filter((w) => /FloatSpeakingWnd|VideoMainWindow|MeetingView|ParticipantWnd|VideoCellWnd|MeetingMainWindow|BaseDialog/i.test(w.cls || ''))
    const host = inMeeting[0] || mine[0]
    if (!host) return { ok: false, code: '', reason: '没找到会议窗口' }

    // 0) 面板可能已经开着：先直接扫一遍所有窗口
    for (const w of mine.slice(0, 5)) {
      try {
        const text = await dump(w.title || host.title, 400, { ...opts, cls: w.cls })
        const hit = extractMeetingCode(String(text || '').replace(/\t/g, ' '))
        if (hit.code && hit.source === 'labeled') return { ok: true, code: hit.code, reason: '窗口里已有会议号' }
      } catch { /* 下一个 */ }
    }

    // 1) 找「会议信息 / 详情」按钮并点开
    const names = ['会议信息', '会议详情', '信息', '邀请']
    let clicked = ''
    for (const cand of names) {
      try {
        await click(host.title, cand, { ...opts, cls: host.cls })
        clicked = cand
        break
      } catch { /* 试下一个 */ }
    }
    if (!clicked) {
      return { ok: false, code: '', reason: '这个界面没有可点的「会议信息」，可能版本不同' }
    }

    // 2) 等面板出现后读文本
    let found = ''
    for (let i = 0; i < 6; i++) {
      await new Promise((r) => setTimeout(r, 400))
      const now = await listWindows().catch(() => [])
      for (const w of now.filter((x) => !proc || String(x.proc || '').toLowerCase() === proc)) {
        try {
          const text = await dump(w.title || host.title, 400, { ...opts, cls: w.cls })
          const hit = extractMeetingCode(String(text || '').replace(/\t/g, ' '))
          if (hit.code) { found = hit.code; break }
        } catch { /* 下一个 */ }
      }
      if (found) break
    }

    // 3) 关掉面板，别干扰你
    try { await pressKey(host.title, 'escape', { ...opts, cls: host.cls }) } catch { /* ignore */ }

    if (found) {
      codeCache = { at: Date.now(), app: app.name, code: found, source: 'auto' }
      return { ok: true, code: found, reason: '打开「' + clicked + '」读到了' }
    }
    return { ok: false, code: '', reason: '打开了「' + clicked + '」但没读到会议号' }
  }

  // 最近一场会议目录：没在录音时，准备页与回看用它
  let lastSessionDir = ''

  let codeCache = { at: 0, app: '', code: '', source: 'none' }
  async function currentMeetingCode(app) {
    // 自动优先：会议号能读出来就用读到的（手动填的只在读不到时兜底）
    if (Date.now() - codeCache.at < 4000 && codeCache.app === app.name && codeCache.code) return codeCache
    const auto = await detectMeetingCode(app)
    if (auto) {
      codeCache = { at: Date.now(), app: app.name, code: auto, source: 'auto' }
      // 读到新号且和手动值不同：以实际为准，清掉手动标记
      if (cfg.meetingCodeManual && cfg.meetingCode && cfg.meetingCode !== auto) {
        cfg.meetingCode = auto
        cfg.meetingCodeManual = false
        try { savePersisted({ meetingCode: auto, meetingCodeManual: false }) } catch { /* ignore */ }
      }
      return codeCache
    }
    if (cfg.meetingCodeManual && cfg.meetingCode) {
      return { code: cfg.meetingCode, source: 'manual', app: app.name }
    }
    codeCache = { at: Date.now(), app: app.name, code: '', source: 'none' }
    return codeCache
  }

  /** 该会议软件是否正占着麦克风（最强的"在会中"信号，尤其对移动会议） */
  async function micHeldByApp(app) {
    try {
      const rows = await micUsage()
      const proc = String((app && app.proc) || "").toLowerCase()
      for (const r of rows || []) {
        const name = String(r.proc || r.process || "").toLowerCase()
        const state = Number(r.state != null ? r.state : r.State)
        if (state !== 1) continue
        if (proc && name === proc) return name
      }
      // proc 对不上时，按名字兜底（移动会议可能是别的进程名）
      const appName = String((app && app.name) || "")
      for (const r of rows || []) {
        const state = Number(r.state != null ? r.state : r.State)
        if (state !== 1) continue
        const label = String((r.proc || r.process || "") + " " + (r.device || ""))
        if (appName && label.includes(appName)) return label
      }
    } catch { /* ignore */ }
    return ""
  }

  /** 综合判断：窗口像会议，或者软件占着麦克风 */
  async function meetingActive(app, wins) {
    if (meetingInProgress(app, wins)) return true
    return !!(await micHeldByApp(app))
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

  // 这些工具会操作桌面、占用麦克风或对外产出，总开关关着时一律拒绝
  const NEEDS_ENABLED = new Set([
    'meeting_join', 'meeting_auto_join', 'meeting_agent_start', 'meeting_agent_stop',
    'meeting_capture_start', 'meeting_capture_stop', 'meeting_calibrate', 'meeting_recalibrate',
    'meeting_click_ratio', 'meeting_set_default', 'meeting_leave', 'meeting_open',
    'meeting_quick', 'meeting_schedule', 'meeting_share',
    'soul_say', 'soul_task', 'meeting_auto_attend',
  ])

  const wrap = (toolName, impl) => async (args) => {
    if (NEEDS_ENABLED.has(toolName) && cfg.enabled !== true) {
      return {
        ok: false,
        result: '会议插件未开启，已拦下「' + toolName + '」。\n先在面板顶部打开开关（或在对话里说"打开会议插件"），我再执行。',
      }
    }
    try {
      return await impl(args || {})
    } catch (err) {
      logger?.warn?.(`[soulmirror] ${toolName}: ${err.message}`)
      return { ok: false, result: `✗ ${err.message}` }
    }
  }


  // ── 桌面宠物：对接 dsh-pet ─────────────────────────────
  // 不自建窗口：dsh-pet 已有动画、物理、气泡与菜单，我们只推状态、投喂气泡、
  // 注册菜单项，并在它没装/没跑时安静降级（绝不拖累会议主流程）。
  let dshPet = null
  let lastPushed = null
  // 气泡只有一个，三路内容抢它：发言 > 建议 > 转写（见 lib/pet-display.js）
  let lastTranscriptBubble = null
  let lastAdviceBubbleAt = 0
  // 「打开会议助手」的跨端信号：宿主加计数，页面看到变化就开面板
  let petOpenRequest = { count: 0, at: 0 }
  // 可选插件的安装状态：没装的能力一律不启动（用户要求）
  let optionalDeps = []
  /** 最近一次模型联通性探测结果（给面板展示，刷新后仍在） */
  let lastModelProbe = null
  try {
    const vi = versionInfo({ dshVersion: process.env.DSH_VERSION || '' })
    logger?.info?.('[soulmirror] 版本 ' + vi.version + '（存储格式 v' + vi.storage +
      '，Node ' + vi.node + '）' + (vi.compatible ? '' : ' ⚠️ ' + vi.problems.join('；')))
  } catch { /* ignore */ }
  /** 宿主端口解析情况（0 表示没拿到，写库会跳过） */
  let hostPortInfo = null
  let gateStatsRef = null
  let depsCheckedAt = 0

  function profileDirNow() {
    try {
      return resolveProfileDir({
        selfUrl: import.meta.url,
        env: process.env,
        homeDir: process.env.USERPROFILE || process.env.HOME || '',
        exists: existsSync,
        join,
      })
    } catch {
      return ''
    }
  }

  /** 当前 profile 名（从目录反推，环境变量可能为空） */
  function profileNameNow() {
    const dir = profileDirNow()
    if (!dir) return ''
    const m = dir.split(/[\\/]+/).filter(Boolean)
    return m[m.length - 1] || ''
  }

  function refreshOptionalDeps() {
    try {
      optionalDeps = checkOptionalDeps({ profileDir: profileDirNow() })
      depsCheckedAt = Date.now()
    } catch (e) {
      optionalDeps = []
      logger?.warn?.('[soulmirror] 依赖体检失败: ' + e.message)
    }
    return optionalDeps
  }

  /** 这个能力现在允许启动吗（没装插件就不启动） */
  function gateStats() { return gateStatsRef ? gateStatsRef() : null }

  /** 每个依赖本次启动只自动装一次，失败不重试（避免反复联网） */
  const autoInstallTried = new Set()

  function gate(key) {
    const deps = optionalDeps.length ? optionalDeps : refreshOptionalDeps()
    const g = featureGateMessage(key, deps)
    // 缺插件 + 用户开了自动安装 → 后台装一次，装完刷新状态
    if (!g.allowed && cfg.depsAutoInstall && !autoInstallTried.has(key)) {
      const hit = deps.find((d) => d.key === key)
      const prof = profileNameNow()
      if (hit && hit.pkg && prof) {
        autoInstallTried.add(key)
        logger?.info?.('[soulmirror] 自动安装缺失插件：' + hit.pkg + '（profile=' + prof + '）')
        installPlugin({ pkg: hit.pkg, profile: prof })
          .then((r) => {
            refreshOptionalDeps()
            logger?.[r.ok ? 'info' : 'warn']?.('[soulmirror] 自动安装' + (r.ok ? '成功' : '失败：' + r.error) + ' → ' + hit.pkg)
          })
          .catch(() => {})
      }
    }
    return g
  }

  let petAvail = false
  let petMenuReady = false
  let petMenuLoop = null
  // 插件卸载后要让长轮询自己停下来，否则会一直占着句柄
  let disposed = false

  function petClient() {
    if (!dshPet) dshPet = createPetClient({ base: cfg.pet.base || undefined })
    return dshPet
  }

  /** 当前 /status 快照：只取宠物推导需要的字段，避免循环依赖 */
  function petStatusSnapshot() {
    return {
      session: { capturing: !!session.capturing, lines: (session.transcript || []).length },
      meeting: meeting ? { title: meeting.display || "", app: (cfg.activeApp || "") } : null,
      reply: cfg.reply, advice: cfg.advice,
      replyState, adviceState, lastSpeakError, lastSpeakInfo, lastLlmError, postMeeting,
    }
  }

  async function probeDshPet(force = false) {
    if (!force && petAvail) return petAvail
    try { petAvail = await petClient().available() } catch { petAvail = false }
    return petAvail
  }

  /** 推工作状态（内部按"有没有变化"去重，不会每句都打接口） */
  async function pushWorkStatus(force = false) {
    if (cfg.pet.enabled === false) return { ok: false, skipped: "disabled" }
    // 没装 dsh-pet 就不启动这条功能（而不是推了再静默失败）
    if (!gate('pet').allowed) return { ok: false, skipped: 'not-installed', error: gate('pet').message }
    if (!(await probeDshPet())) return { ok: false, skipped: "unavailable" }
    try {
      const next = toWorkStatus(derivePetState(petStatusSnapshot()))
      if (!force && !shouldPush(lastPushed, next)) return { ok: true, skipped: "unchanged" }
      const r = await petClient().setWorkStatus(next)
      if (r.ok) lastPushed = next
      return r
    } catch (e) { return { ok: false, error: e.message } }
  }

  /**
   * 按优先级决定气泡内容并推给桌宠。
   * 发言优先（它正在对外说话，最该被看见），其次建议，最后才轮到转写环境音。
   */
  async function bubbleByPriority({ speaking = '', advice = '', transcript = '' } = {}) {
    const pick = pickBubble({ speaking, advice, transcript })
    if (!pick.text) return { ok: false, skipped: 'empty' }
    if (cfg.pet.showBubble === false) return { ok: false, skipped: 'config' }
    const r = await pushSay(pick.text)
    if (r.ok && pick.kind === 'transcript') lastTranscriptBubble = { text: transcript, at: Date.now() }
    if (r.ok && pick.kind === 'advice') lastAdviceBubbleAt = Date.now()
    return { ...r, kind: pick.kind }
  }

  /** 让桌宠把这句话显示在气泡里（取锁 → 投喂 → 稍后释放） */
  async function pushSay(text) {
    if (cfg.pet.enabled === false) return { ok: false, skipped: "disabled" }
    if (!gate('pet').allowed) return { ok: false, skipped: 'not-installed', error: gate('pet').message }
    if (cfg.pet.sayInBubble === false) return { ok: false, skipped: "config" }
    if (!(await probeDshPet())) return { ok: false, skipped: "unavailable" }
    const body = String(text || "").trim()
    if (!body) return { ok: false, error: "没有内容" }
    try {
      const c = petClient()
      const petName = cfg.pet.petName || ""
      const l = await c.lock(petName)
      const r = await c.broadcast(body, { lockId: l.lockId, pet: petName })
      if (l.lockId) setTimeout(() => { c.release(l.lockId, petName).catch(() => {}) }, 8000)
      return r
    } catch (e) { return { ok: false, error: e.message } }
  }

  /** 注册右键菜单，并起一条长轮询把点击接回来 */
  async function ensurePetMenu(force = false) {
    if (cfg.pet.enabled === false) return { ok: false, skipped: "disabled" }
    if (!gate('pet').allowed) return { ok: false, skipped: 'not-installed', error: gate('pet').message }
    if (process.env.SOULMIRROR_TEST === "1") return { ok: false, skipped: "test-env" }
    if (cfg.pet.menu === false) return { ok: false, skipped: "config" }
    if (!(await probeDshPet(true))) return { ok: false, skipped: "unavailable" }
    try {
      const c = petClient()
      if (force || !petMenuReady) {
        const r = await c.registerMenu({ owner: "soulmirror", labels: PET_MENU_ITEMS })
        petMenuReady = !!r.ok
        if (!r.ok) return r
      }
      if (!petMenuLoop) {
        petMenuLoop = true
        const loop = async () => {
          while (petMenuLoop && !disposed) {
            try {
              const ev = await c.pollMenu({ owner: "soulmirror", waitMs: 25000 })
              if (!ev.ok) { await sleep(5000); continue }
              for (const label of ev.clicked) await handlePetMenu(label)
            } catch { await sleep(5000) }
          }
        }
        loop().catch(() => { petMenuLoop = null })
      }
      await pushWorkStatus(true)
      return { ok: true }
    } catch (e) { return { ok: false, error: e.message } }
  }

  /** 菜单点击 → 会议助手动作 */
  async function handlePetMenu(label) {
    const act = menuAction(label)
    logger?.info?.("[soulmirror] 桌宠菜单：" + label + " → " + act.type)
    if (act.type === "auto") {
      if (act.action === "start") { armed = true; cfg.enabled = true }
      if (act.action === "stop") { armed = false; cfg.enabled = false }
      try { await session[act.action === "start" ? "startCapture" : "stopCapture"]() } catch { /* ignore */ }
      await pushWorkStatus(true)
      return
    }
    if (act.type === "toggle") {
      if (act.target === "reply") cfg.reply.enabled = !cfg.reply.enabled
      if (act.target === "advice") cfg.advice.enabled = !cfg.advice.enabled
      try { savePersisted({ reply: cfg.reply, advice: cfg.advice }) } catch { /* ignore */ }
      await pushWorkStatus(true)
      return
    }
    if (act.type === "open") {
      petOpenRequest = bumpOpenRequest(petOpenRequest)
      logger?.info?.("[soulmirror] 桌宠请求打开面板 count=" + petOpenRequest.count)
      await pushSay("会议助手在侧边栏「会议」按钮里")
      return
    }
  }

  // 用 unref 的定时器：菜单长轮询的等待不该阻止进程退出（测试里会直接挂住）
  const sleep = (ms) => new Promise((r) => {
    const h = setTimeout(r, ms)
    if (h && typeof h.unref === 'function') h.unref()
  })

  ctx.tools.register(defineTool({
    name: 'meeting_run',
    description: '把一句自然语言交给会议会话执行：预约会议、到点入会、开始/结束录音、出纪要、写知识库，都由会话里的 agent 调用本插件的工具完成。用户说「帮我在腾讯会议约个明天的周会」「现在开始听」「散会出纪要」时用这个，不要自己拆解意图。',
    parameters: {
      request: { type: 'string', required: true, description: '用户的原话，原样传，不要改写' },
      speak: { type: 'boolean', description: '完成后是否让桌宠/会议把它们说出来（默认 false）' },
    },
    output: OUT(),
    execute: wrap('meeting_run', async (a) => {
      const request = String(a.request || '').trim()
      if (!request) return { ok: false, result: '没有内容' }
      // 语义：新建一个 DSH 对话，把用户原话作为第一句投进去。
      // soulmirror 是 DSH 的插件，不是独立应用——所以不自己造入口，
      // 而是复用 DSH 的会话能力：新对话里 agent 会用本插件的工具完成任务。
      const r = await newConversation(request)
      const text = String(r.text || r.error || '').trim()
      if (text) {
        try { await bubbleByPriority({ speaking: text.slice(0, 80) }) } catch { /* ignore */ }
      }
      if (a.speak && text) {
        try { await speakNow(text.slice(0, 200)) } catch { /* ignore */ }
      }
      return {
        ok: !!r.ok,
        result: text || (r.ok ? '已完成' : '执行失败'),
        sessionId: r.sessionId || '',
        via: r.via || '',
        error: r.error || '',
      }
    }),
  }))

  ctx.tools.register(defineTool({
    name: 'meeting_pet',
    description: '桌面宠物（对接 dsh-pet）：把会议助手的状态推给桌宠（在听/说话/整理中/出错），并可在桌宠右键菜单里操作录音与开关。action=status 看状态，push 立即推一次，menu 重新注册菜单，say 让它说一句。',
    parameters: {
      action: { type: 'string', required: true, description: 'status | push | menu | say' },
      text: { type: 'string', description: 'action=say 时要说的话' },
    },
    output: OUT(),
    execute: wrap('meeting_pet', async (a) => {
      const action = String(a.action || '').trim()
      const avail = await probeDshPet(true)
      if (action === 'status') {
        const st = derivePetState(petStatusSnapshot())
        return {
          ok: true,
          result: (avail ? '桌宠在线' : '桌宠未安装或未运行') + ' · ' + st.label + (st.text ? '：' + st.text : ''),
          available: avail,
          state: st,
          workStatus: toWorkStatus(st),
          menuRegistered: petMenuReady,
          lastPushed,
        }
      }
      if (action === 'push') {
        const r = await pushWorkStatus(true)
        return { ok: !!r.ok, result: r.ok ? ('已推送：' + JSON.stringify(lastPushed)) : ('推送失败：' + (r.error || r.skipped)) }
      }
      if (action === 'menu') {
        const r = await ensurePetMenu(true)
        return { ok: !!r.ok, result: r.ok ? '菜单已注册（右键「更多」里可见）' : ('注册失败：' + (r.error || r.skipped)) }
      }
      if (action === 'say') {
        const r = await pushSay(String(a.text || ''))
        return { ok: !!r.ok, result: r.ok ? '已让它开口' : ('发言失败：' + (r.error || r.skipped)) }
      }
      return { ok: false, result: '未知 action：' + action }
    }),
  }))

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
    // 能在事前判断的就别进 UI：格式错的会议号会一路走到探测里，白等几十秒
    const codeCheck = validateMeetingCode(a.code)
    if (!codeCheck.ok) return { ok: false, result: codeCheck.error, invalidCode: true }
    a.code = codeCheck.code
    // 总超时：每个关键步骤之间查一次
    const joinDeadline = Date.now() + Math.max(5000, Number(cfg.joinTimeoutMs) || 20000)
    const ensureTime = () => {
      if (Date.now() > joinDeadline) {
        const secs = Math.round((Number(cfg.joinTimeoutMs) || 20000) / 1000)
        const err = new Error('入会超时（' + secs + ' 秒）：没进入会议，可能是会议号不对，或客户端停在不是首页的界面')
        err.code = 'JOIN_TIMEOUT'
        throw err
      }
    }
      const app = a.app ? meetingApp(a.app) : await detectMeetingApp()
      // 已经在会里：不要再"启动会议"或点加入，否则会弹对话框打断当前会议
      try {
        const winsNow = await listWindows()
        if (await meetingActive(app, winsNow)) {
          return { ok: true, result: '已在会议中（检测到会中窗口），不再重复入会', alreadyInMeeting: true }
        }
      } catch { /* 忽略探测失败 */ }
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
          if (await dialogOpen()) {
            uiMap.markSuccess(app.name, 'join')
            opened = true
            steps.push('已点「' + cand + '」')
            break
          }
        } catch { /* next */ }
      }
    }

    if (!opened) {
      // 坐标不写死：查标定表；没有就返回"去标定"，绝不盲点
      const saved = uiMap.get(app.name, 'join')
      if (!saved) {
        steps.push('首页按钮没有可点的控件名，也还没有标定过坐标')
        steps.push('跑一次 meeting_calibrate 截图，看完图用 meeting_set_ui_map 存下「加入会议」位置即可')
        return { ok: false, result: joinFailureResult(steps.join('\n')) }
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
            uiMap.markSuccess(app.name, 'join')
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
      ensureTime()
      const names = await listClickableNames(app)
      uiMap.markFailure(app.name, 'join', '打不开入会对话框')
      const calib = maybeCalibrate(app, 'join', '打不开入会对话框')
      steps.push(calib.started ? '已在后台用 computer-use 重新标定按钮位置，稍后重试' : '（标定未触发：' + (calib.skipped || calib.why || '') + '）')
      steps.push('没能打开入会对话框。首页可见控件：' + (names.slice(0, 10).join(' / ') || '（读不到）'))
      steps.push('排查：确认会议客户端停在首页（不是已入会状态），或调 config.joinClickRatio')
      return { ok: false, result: joinFailureResult(steps.join('\n')) }
    }

    // 对话框里：会议号 → 昵称 → 自动连音频 → 加入
    let filled = false
    ensureTime()
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

    ensureTime()
    await new Promise((r) => setTimeout(r, 3000))
    const wins = await listWindows()
    const joined = meetingInProgress(app, wins)
    // 入会失败常见于会议号不存在/已结束，读一下对话框里的提示
    const text = joined ? '' : await dump(JOIN_DIALOG, 120, opts).catch(() => '')
    const errLine = String(text).split(/\r?\n/).find((l) => /会议号|不存在|已结束|错误|无效/.test(l))
    if (!joined) {
      try { await pressKey(JOIN_DIALOG, 'escape', opts); steps.push('已按 Esc 关闭对话框') } catch { /* ignore */ }
    }
    if (!joined) {
      // 入会没成功：把这次算作一次坐标失败，并在需要时让 computer-use 重新学一遍
      try { uiMap.markFailure(app.name, 'join', errLine ? '客户端提示：' + errLine.slice(0, 40) : '点了加入但没进会') } catch { /* ignore */ }
      const calib = maybeCalibrate(app, 'join', errLine || '点了加入但没进会')
      steps.push(calib.started
        ? '已在后台启动 computer-use 标定；稍后再说一次「加入会议」即可重试'
        : '（标定未触发：' + (calib.skipped || calib.why || '') + '；可以直接说「用 computer-use 帮我点」）')
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
      // 离会 = 散会：先停采，整理**不阻塞**离会。
      // 审查指出：原来先 await 整理再点「离开」，云端重转写可能要几分钟，
      // 用户会被卡在会议里出不去。现在整理在后台跑，离会立即执行；
      // 状态仍可在「会后整理」卡与 /auto/state 里看到。
      const organized = { organized: false, reason: '（后台整理中）' }
      stopAndOrganize('离开会议', { wasCapturing: true })
        .then((o) => logger?.info?.('[soulmirror] 离会后整理：' + (o.organized ? '完成' : (o.reason || '跳过'))))
        .catch((e) => logger?.warn?.('[soulmirror] 离会后整理失败：' + e.message))
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

  // ── 声音复刻 ────────────────────────────────────────────────────────
  ctx.tools.register(defineTool({
    name: 'meeting_voice_clone',
    description: '用参考音频克隆 DashScope 音色，并设为会议发言音色。音频支持本地 WAV/MP3 路径或公网 URL。必须传 confirm=true。',
    parameters: {
      audio: { type: 'string', required: true, description: '参考音频本地路径或公网 URL。' },
      prefix: { type: 'string', description: '音色前缀，仅字母数字，≤10 位。' },
      targetModel: { type: 'string', description: '目标 TTS 模型，默认取 tts.model。' },
      confirm: { type: 'boolean', description: '确认执行，必须为 true。' },
    },
    output: OUT(),
    execute: wrap('meeting_voice_clone', async (a) => {
      if (a.confirm !== true) return { ok: false, result: '拒绝：声音克隆会创建真实音色并产生费用，请传 confirm=true。' }
      try {
        const prefix = String(a.prefix || cfg.tts.clonePrefix || 'soulmirror').replace(/[^0-9A-Za-z]/g, '').slice(0, 10) || 'soulmirror'
        const target = String(a.targetModel || cfg.tts.model || 'cosyvoice-v2')
        const data = await voiceEnrollment('create_voice', {
          target_model: target,
          prefix,
          audio: audioDataUri(a.audio),
          language_hints: ['zh'],
        })
        const voiceId = data?.output?.voice_id || data?.output?.voice || ''
        if (!voiceId) return { ok: false, result: '服务端未返回 voice_id: ' + JSON.stringify(data).slice(0, 300) }
        cfg.tts.voice = voiceId
        cfg.tts.cloneVoiceId = voiceId
        savePersisted({ tts: { voice: voiceId, cloneVoiceId: voiceId } })
        return { ok: true, result: `已创建音色 ${voiceId}，并设为会议发言音色（target_model=${target}）` }
      } catch (e) {
        return { ok: false, result: '声音克隆失败：' + e.message }
      }
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
      // 只调一个入口：由 stopAndOrganize 负责"停采 + 整理"。
      // 过去这里先 stopCapture()，导致它内部的 wasCapturing 已是 false，整理被静默跳过。
      const o = await stopAndOrganize('手动停止采集', { wasCapturing: true })
      const tail = o.organized
        ? '；已开始会后整理（纪要生成中）'
        : (o.reason ? '；' + o.reason : '')
      return { ok: true, result: `已停止，共 ${o.chunks || 0} 片，目录 ${o.dir || '-'}` + tail }
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
      const r = await probeRenderDevices(a.seconds || 3)
      if (!r.ok) return { ok: false, result: r.result }
      const rows = r.rows.map((x) => (x.rms >= 0.004 ? '[有声] ' : '[静音] ') + x.name + '  RMS=' + (x.rms >= 0 ? x.rms.toFixed(4) : 'n/a') + (x.err ? '  错误:' + x.err.slice(0, 60) : ''))
      const tail = r.bestRms >= 0.004
        ? '\n建议：devices.capture = ' + r.best
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
  // 从宿主会话事件里记住用户当前在哪个目录工作（会议会话要继承它，否则看不到任何项目文件）
  let activeSessionCwd = ''
  let meeting = { id: '', dir: '', dshSessionId: '', startedAt: '', key: '', display: '' }
  const sessionMap = new SessionMap(join(CONFIG_DIR, 'sessions.json'))
  let meetingIdOverride = ''

  /** 以会议身份为准：显式 id > 标题里的会议号 > 标题 */
  function currentMeetingKey(title) {
    const ttl = title || lifecycle?.lastWindowTitle || ''
    return deriveMeetingKey({ explicit: meetingIdOverride, title: ttl })
  }

  /** 目录重名时加序号：xxx (2)、xxx (3) —— 同一天开两场同名会议用得上 */
  function uniqDirName(base) {
    const root = workspaceRoot
    let name = base
    for (let i = 2; i < 50; i++) {
      const p = join(root, name)
      if (!existsSync(p)) return name
      // 目录在但没账本 → 视为残留，直接用
      if (!existsSync(join(p, 'transcript.jsonl'))) return name
      name = base + ' (' + i + ')'
    }
    return base + ' (' + Date.now() + ')'
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

    // 目录名：软件 · 时间 · 主题（认得出来），而不是一串时间戳
    const appName = appPrefix || (cfg.apps.find((x) => x && x.name) || {}).name || ''
    const codeInTitle = (ident.display || '').match(/\d{3}[-\s]?\d{3}[-\s]?\d{3}/)
    const topic = topicFromTitle({ title: winTitle, app: appName, code: codeInTitle ? codeInTitle[0] : '' })
    const friendly = buildMeetingDirName({
      app: appName,
      at: Date.now(),
      topic,
      code: codeInTitle ? codeInTitle[0] : (ident.source === 'title-id' ? ident.display : ''),
    })

    // 一场会只留一条记录：同键 + 上一场没结束 + 在窗口内 → 复用原目录，继续往同一本账里写
    const prevDir = prev && prev.dir ? prev.dir : ''
    const prevEnded = (() => {
      try { return !!JSON.parse(readFileSync(join(prevDir, 'meta.json'), 'utf8')).endedAt } catch { return false }
    })()
    const prevAge = (() => {
      try { return Date.now() - statSync(join(prevDir, 'transcript.jsonl')).mtimeMs } catch { return Infinity }
    })()
    const reuse = shouldReuseDir({
      sameKey: !!prevDir,
      sinceLastMs: prevAge,
      mergeWindowMs: Number(cfg.mergeWindowMinutes || 45) * 60000,
      previousEnded: prevEnded,
    })
    meeting = {
      id: safeName(key),
      key,
      display: ident.display || label || key,
      dir: reuse ? prevDir : join(workspaceRoot, uniqDirName(friendly)),
      dshSessionId: prev?.dshSessionId || '',
        // agent 的工作目录：配置 > 知识库目录 > 插件工作区（与知识库对齐才能看到文档/制品）
        ...(() => {
          try {
            const cands = [
              (cfg.workspace && cfg.workspace.cwd) || "",
              join('G:', 'dsh-knowledge'),
              join(DSH_HOME_RESOLVED, 'knowledge'),
            ].filter(Boolean)
            const kd = detectKnowledgeCwd(cands, { existsSync, statSync, join })
            const pick = pickWorkspaceCwd({ configured: (cfg.workspace && cfg.workspace.cwd) || "", active: kd, fallback: "" })
            const source = kd && pick.cwd === kd ? 'knowledge' : pick.source
            return { agentCwd: pick.cwd, cwdSource: source }
          } catch { return { agentCwd: '', cwdSource: 'fallback' } }
        })(),
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
  /**
   * 新建一个 DSH 对话并投递第一句。
   *
   * 为什么不复用会议会话：用户说"帮我约个会"时，他期待的是**一个能继续追问的对话**，
   * 而不是塞进那条长期复用的会议会话里（那里已经有几十轮任务历史）。
   * 新对话的 cwd 与会议会话一致（知识库目录），所以照样能看到文档与制品。
   */
  /**
   * 给一个可能永远不返回的 Promise 加超时。
   * 超时不取消底层工作（JS 没有通用的取消），但会让调用方先往下走——
   * 对"会后整理"这种场景，能落盘纪要比无限等待更重要。
   */
  /**
   * 超时包装。
   *
   * 审查指出：原来超时只结束**等待**，底层离线任务还在跑，
   * 之后可能继续往磁盘写结果——"已超时"和"结果又冒出来"并存。
   * 所以现在多一个 onTimeout 回调：调用方借此打上取消标记，
   * 底层在写盘前检查它，超时后就丢弃结果。
   */
  function withTimeout(promise, ms, label, { onTimeout } = {}) {
    let timer = null
    const timeout = new Promise((resolve) => {
      timer = setTimeout(() => {
        logger?.warn?.('[soulmirror] ' + label)
        try { onTimeout?.() } catch { /* 取消回调失败不影响返回 */ }
        resolve({ ok: false, error: label, timedOut: true, cancelled: true })
      }, ms)
      timer.unref?.()
    })
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
  }

  async function newConversation(text, { title = '' } = {}) {
    const controller = getController(ctx)
    if (!controller) return { ok: false, error: '宿主没有 sessionController' }
    const ws = ensureMeetingWorkspace('', lifecycle?.lastWindowTitle || '')
    const cwd = ws.agentCwd || ws.dir
    try {
      const sessionId = await createSession(ctx, {
        cwd,
        title: title || ('会议助手 · ' + String(text || '').slice(0, 20)),
      })
      logger?.info?.('[soulmirror] 已新建对话 ' + sessionId + '，首句：' + String(text).slice(0, 40))
      const r = await promptSession(ctx, sessionId, text, { timeoutMs: cfg.twin.timeoutMs })
      return { ok: r.ok, text: r.text, error: r.error, sessionId, via: 'new-conversation' }
    } catch (e) {
      return { ok: false, error: e.message, sessionId: '' }
    }
  }

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
            cwd: ws.agentCwd || ws.dir,
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
    const r = await runDshTask(guarded, { profile: cfg.twin.profile, cwd: ws.agentCwd || ws.dir, sessionId: ws.dshSessionId || undefined, timeoutMs })
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
            cwd: ws.agentCwd || ws.dir,
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
          cwd: ws.agentCwd || ws.dir,
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

  // ── 界面标定：需要时开一个会话，让 computer-use 亲手试出按钮位置 ──────
  let calibSessionId = ""
  async function runCalibrationSession(prompt) {
    const controller = getController(ctx)
    if (!controller) return { ok: false, error: "宿主没有会话服务" }
    try {
      if (!calibSessionId) {
        calibSessionId = await createSession(ctx, {
          cwd: join(CONFIG_DIR, "workspace", "calibrate"),
          title: "SoulMirror · 界面标定",
        })
      }
      const r = await promptSession(ctx, calibSessionId, prompt, { timeoutMs: 180000 })
      return { ok: r.ok, text: r.text, error: r.error, sessionId: calibSessionId }
    } catch (e) {
      calibSessionId = ""
      return { ok: false, error: e.message }
    }
  }

  // ── 到点自动参会：交给 DSH 自己的「自动化任务」──────────────────────
  // 不另造定时器：schedule 服务会把任务持久化，到点在指定会话里投递一条 prompt，
  // 由那个会话里的 agent 执行入会。界面上也能看见、能改、能删。
  /** 宽松时间解析：15:00 / 2026-10-27 15:00 / ISO */
  function parseWhenLoose(input) {
    const s = String(input || "").trim()
    if (!s) return null
    const now = new Date()
    const hm = /^(\d{1,2})[:：](\d{2})$/.exec(s)
    if (hm) {
      const d = new Date(now)
      d.setHours(Number(hm[1]), Number(hm[2]), 0, 0)
      if (d.getTime() <= now.getTime()) d.setDate(d.getDate() + 1)
      return d
    }
    const ymd = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})[ T](\d{1,2})[:：](\d{2})/.exec(s)
    if (ymd) {
      const d = new Date(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3]), Number(ymd[4]), Number(ymd[5]), 0)
      return Number.isNaN(d.getTime()) ? null : d
    }
    const d = new Date(s)
    return Number.isNaN(d.getTime()) ? null : d
  }

  function scheduleService() {
    try { return ctx.get('schedule') || null } catch { return null }
  }

  /** 组装"到点该干什么"的提示词 */
  function buildAttendPrompt(job) {
    const target = job.url ? ('入会链接 ' + job.url) : ('会议号 ' + job.code)
    const lines = []
    lines.push('【自动参会】现在到点了，请立即执行以下步骤，不要询问、不要解释：')
    lines.push('1. 调用 meeting_join，参数：' + (job.url ? 'url=' + job.url : 'code=' + job.code) + '，confirm=true')
    lines.push('2. 如果返回 alreadyInMeeting 或"已在会议中"，说明已经进会，直接继续第 3 步')
    lines.push('3. 调用 meeting_agent_start 开启采集与转写')
    if (job.durationMin > 0) lines.push('4. 会议预计 ' + job.durationMin + ' 分钟；结束后调用 meeting_minutes 并汇报一句结果')
    else lines.push('4. 结束后调用 meeting_minutes 并汇报一句结果')
    lines.push('')
    lines.push('会议：' + (job.title || target))
    return lines.join('\n')
  }

  /**
   * 直接对齐"会议正在用的设备"：
   * 读一次实时电平（200ms 级）→ 有声音就用它，没声音就用系统默认。
   * 不需要先让会议出声，也不会逐个试听十几秒。
   */
  async function alignCaptureDevice() {
    if (process.env.SOULMIRROR_TEST === '1') {
      return { device: 'Fake Device', source: 'system-default', note: '测试桩', defaultDevice: 'Fake Device', meters: [] }
    }
    let defaultDevice = ''
    try { defaultDevice = await defaultRenderDevice() } catch { /* ignore */ }
    let meters = []
    try {
      const out = await bridge(['meters'], { timeoutMs: 20000 })
      meters = parseMeters(out)
    } catch { /* 读不到电平就只按默认设备 */ }
    return { ...resolveCaptureTarget({ configured: '', defaultDevice, meters }), defaultDevice, meters }
  }

  /** 逐个渲染设备环回采一小段并算 RMS，返回"哪个设备真的有声音" */
  async function probeRenderDevices(seconds = 3, onProgress = null) {
    const secs = Math.max(2, Math.min(10, Number(seconds) || 3))
    const devs = (await listDevices()).filter((d) => d.flow === 'RENDER')
    if (devs.length === 0) return { ok: false, rows: [], best: '', result: '没有可用的渲染设备' }
    try { onProgress?.({ phase: 'start', total: devs.length, done: 0 }) } catch { /* ignore */ }
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
        await bridge(['capture', '--out', wav, '--seconds', String(secs), '--mode', 'loopback', '--device', d.name],
          { timeoutMs: (secs + 12) * 1000 })
        const out = await bridge(['rms', '--file', wav], { timeoutMs: 15000 })
        const m = /RMS\s+([0-9.]+)/.exec(out)
        if (m) rms = Number(m[1])
      } catch (e) { err = e.message }
      if (rms > bestRms) { bestRms = rms; best = d.name }
      rows.push({ name: d.name, rms, err })
      try { onProgress?.({ phase: 'device', total: devs.length, done: rows.length, last: d.name, rms }) } catch { /* ignore */ }
    }
    return { ok: true, rows, best, bestRms }
  }

  // 测试环境用桩，避免真的去开音频设备（SOULMIRROR_TEST=1 时生效）
  const runProbe = process.env.SOULMIRROR_TEST === '1'
    ? async (secs, onProgress) => {
      onProgress?.({ phase: 'start', total: 2, done: 0 })
      await new Promise((r) => setTimeout(r, 5))
      onProgress?.({ phase: 'device', total: 2, done: 1, last: 'Fake A', rms: 0.02 })
      await new Promise((r) => setTimeout(r, 5))
      onProgress?.({ phase: 'device', total: 2, done: 2, last: 'Fake B', rms: 0 })
      return {
        ok: true,
        rows: [{ name: 'Fake A', rms: 0.02, err: '' }, { name: 'Fake B', rms: 0, err: '' }],
        best: 'Fake A',
        bestRms: 0.02,
      }
    }
    : probeRenderDevices

  // 体检状态缓存：面板轮询时不要每次重新探测环境
  let setupCache = { at: 0, value: null }
  async function collectSetupStateCached() {
    if (setupCache.value && Date.now() - setupCache.at < 2000) return setupCache.value
    const v = await collectSetupState()
    setupCache = { at: Date.now(), value: v }
    return v
  }

  // 设备试听要十几秒，不能同步等：立即返回 + 这里记进度，面板轮询
  let probeJob = { running: false, total: 0, done: 0, last: '', rows: [], best: '', error: '', at: 0 }

  /** 当前安装状态：给面板体检用，也可被 soul_setup report 复用 */
  async function collectSetupState() {
    // 只做文件存在性判断：detectEnv() 里有 which() 子进程，轮询时太慢
    let bridge = false
    try {
      const { toolsDir } = await import('./lib/bridge.js')
      bridge = existsSync(join(toolsDir, 'mbridge.exe'))
    } catch { /* ignore */ }
    let key = ''
    let keySource = ''
    try {
      const r = resolveDashScopeKey({ ...cfg.asr, apiKey: keyFor(cfg.asr, 'asr') })
      key = r.key || ''
      // config / env / env:registry —— 面板要能说清"这个 key 从哪来的"
      keySource = r.source || ''
    } catch { /* ignore */ }
    let calibrated = true
    try {
      const app = meetingApp(cfg.activeApp || '') || { name: '' }
      const meta = uiMap.meta(app.name, 'join')
      calibrated = !uiMap.needsRecalibration(app.name, 'join', cfg.recalibrateThreshold).needed
      if (!meta || meta.failures === 0) calibrated = true
    } catch { /* ignore */ }
    return {
      config: true,
      bridge,
      key: !!key,
      keySource,
      captureDevice: cfg.devices.capture || '',
      captureAuto: !!cfg.devices.captureAuto,
      virtualMic: /cable/i.test(String(cfg.devices.speak || '')),
      calibrated,
    }
  }

  const calibrator = new CalibrationRunner({
    run: (prompt) => runCalibrationSession(prompt),
    logger,
  })

  /** 需要就触发一次标定（后台跑，不挡主流程） */
  function maybeCalibrate(app, action = "join", reason = "") {
    if (!isArmed()) return { started: false, skipped: "not-armed" }
    if (!cfg.autoCalibrate) return { started: false, skipped: "disabled" }
    const need = uiMap.needsRecalibration(app && app.name, action, cfg.recalibrateThreshold)
    if (!need.needed) return { started: false, skipped: "not-needed" }
    const meta = uiMap.meta(app && app.name, action)
    calibrator
      .trigger({ app: app.name, action, reason: reason || meta.lastReason || "", failures: meta.failures || 0 })
      .catch(() => {})
    return { started: true, why: need.why, failures: need.failures }
  }
  const living = new LivingWorld(join(CONFIG_DIR, 'living'))
  let personaAt = 0
  let personaCache = ''
  function currentPersona() {
    const now = Date.now()
    if (now - personaAt < 1500 && personaCache) return personaCache
    try {
      // 四层 markdown（手写底色）+ 结构化画像（会后自动成长）
      personaCache = fullPersonaBlock(personaDir)
    } catch { personaCache = '' }
    personaAt = now
    return personaCache
  }

  const brain = new MeetingBrain({ minGapMs: cfg.brain.minGapMs, names: resolveWakeWords() })

  // ── ASR 纠错：用大模型把同音错字改回正确人名/术语 ──────────────
  const fixNames = Array.from(new Set([cfg.userName, ...(cfg.wakeWords || []), ...((cfg.apps || []).map((a) => a.name))].filter(Boolean)))

    /**
     * 走 DSH 会话的补全：不自己挑模型，直接让会议会话回答。
     *
     * 用户的要求：会议助手的所有 agent 功能都在 dsh 的 session 里原生实现，
     * 不需要"默认模型"这类额外配置——会话用什么模型，判定就用什么模型。
     *
     * 代价是每次都是一个完整回合（比裸调模型慢、更贵），
     * 所以只用于低频场景：建议卡片、候选词、目标润色。逐句纠错不用它。
     */
    /**
     * 判定专用会话（内部）：ASR 纠错、候选词、建议、决策都走它。
     *
     * 为什么不复用会议会话：那些调用都是"完整回合"，会以用户消息的形式
     * 出现在会话列表里——用户会看到
     *   The input is "Hello, 你在吗？" — no names to fix, no errors. Output as-is.
     * 这种内部提示词，一次说话冒出 N 条，完全没法看。
     * 判定照旧用 DSH 会话（模型与配置沿用会话），只是换一个不给人看的会话。
     */
    let judgementSessionId = ''
    let judgementBusyUntil = 0
    let judgementTurns = 0
    let judgementAt = 0
    /**
     * 判定会话需要**定期轮换**。
     *
     * 它是普通 DSH 会话：每一轮问答都会留在会话历史里（进程内常驻）。
     * 一场会里逐句纠错 + 候选词 + 建议，很容易累积几百轮，
     * 而 DSH 会把这些历史保留在内存里 —— 长时间运行就是持续增长。
     * 所以每 200 轮或 45 分钟换一个新会话：旧的自然被回收。
     */
    async function ensureJudgementSession() {
      const stale = judgementSessionId && (
        judgementTurns >= (Number(cfg.judgementMaxTurns) || 200) ||
        (judgementAt && Date.now() - judgementAt > (Number(cfg.judgementMaxAgeMs) || 45 * 60 * 1000))
      )
      if (judgementSessionId && !stale) return judgementSessionId
      if (stale) logger?.info?.('[soulmirror] 判定会话轮换（已用 ' + judgementTurns + ' 轮）')
      const ws = ensureMeetingWorkspace('', lifecycle?.lastWindowTitle || '')
      const cwd = ws.agentCwd || ws.dir
      judgementSessionId = await createSession(ctx, { cwd, title: '会议助手 · 判定（内部）' })
      judgementTurns = 0
      judgementAt = Date.now()
      logger?.info?.('[soulmirror] 判定会话已就绪：' + judgementSessionId)
      return judgementSessionId
    }

    function makeSessionCompleter() {
      // 所有"判定"类调用（建议/候选词/润色）共用这一个闸门：
      // 同一时刻只跑一个回合，排队上限 2，同内容自动合并。
      // 不这么做的话，一句话同时触发建议+候选词、或多句连着落地，
      // 就会在会议会话里看到 N 条排队消息。
      const gate = createSessionGate({
        maxPending: 2,
        run: async (prompt) => {
          const sid = await ensureJudgementSession()
          const r = await promptSession(ctx, sid, prompt, { timeoutMs: Math.min(120000, cfg.twin.timeoutMs || 120000) })
          judgementBusyUntil = Date.now()
          judgementTurns += 1
          if (!r.ok) throw new Error(r.error || '会话未返回结果')
          const text = String(r.text || '').trim()
          if (!text) throw new Error('会话返回空内容')
          return text
        },
      })
      gateStatsRef = () => gate.stats()
      return async function complete(messages) {
        const list = Array.isArray(messages) ? messages : []
        const system = list.filter((m) => m && m.role === 'system').map((m) => String(m.content || '')).join('\n')
        const user = list.filter((m) => m && m.role !== 'system').map((m) => String(m.content || '')).join('\n')
        const prompt = [system, user].filter(Boolean).join('\n\n')
        const out = await gate.submit(keyOf(prompt), prompt)
        // 被合并/丢弃：不是错误，是"这一轮不做了"。用 code 标出来，
        // 让调用方安静跳过，别把它写成"模型失败"吓用户。
        if (out && typeof out === 'object' && out.skipped) {
          const e = new Error('已合并到后一次请求')
          e.code = 'COALESCED'
          throw e
        }
        return String(out || '')
      }
    }

    /**
   * 纪要专用补全器。
   *
   * 为什么不能复用 sessionCompleter：
   *   那个补全器被"逐句判定/候选词/润色"共用，有闸门（maxPending=2、同内容合并、120s 超时）。
   *   而生成纪要是**一次性、长输入、长输出**的调用：
   *     · 正好有逐句判定在排队 → 被闸门合并/丢弃 → 纪要退化成"抽取式"
   *     · 转录 400 句 + 长输出 → 常常超过 120s → 同样失败
   *   实测后果就是用户看到"纪要基本上啥都没有"。
   *
   * 所以这里单独开一条路：直接向会议会话提问，不走闸门，超时放宽。
   */
  function makeMinutesCompleter() {
    return async function completeMinutes(messages) {
      const list = Array.isArray(messages) ? messages : []
      const system = list.filter((m) => m && m.role === 'system').map((m) => String(m.content || '')).join('\n\n')
      const user = list.filter((m) => m && m.role !== 'system').map((m) => String(m.content || '')).join('\n\n')
      const prompt = [system, user].filter(Boolean).join('\n\n')
      const sid = await ensureJudgementSession()
      // 纪要要读完整场转写再写长文：给 5 分钟，且不经过闸门
      const r = await promptSession(ctx, sid, prompt, { timeoutMs: 300000 })
      if (!r || !r.ok) throw new Error((r && r.error) || '纪要会话未返回结果')
      const text = String(r.text || '').trim()
      if (!text) throw new Error('纪要会话返回空内容')
      return text
    }
  }

  /**
   * 用 **DSH 后台任务** 写纪要：起一个 headless 进程，读转写文件、写纪要文件。
   *
   * 为什么不塞进主会话：
   *   · 主会话补全器有闸门（maxPending=2、合并、120s），纪要被合并/超时后静默退化成原文节选
   *   · 纪要是重活，压在会议会话里会拖慢其它判断
   *   · 用户明确要求：结束后的整理交给 dsh 的后台任务
   *
   * @returns {Promise<{ok: boolean, markdown?: string, error?: string, elapsed?: number}>}
   */
  async function minutesViaBackgroundTask(dir, lines, title = '') {
    if (!dir) return { ok: false, error: '没有会议目录' }
    if (!shouldUseBackgroundTask({ minutesViaDsh: cfg.minutesViaDsh !== false })) {
      return { ok: false, error: '已关闭后台任务（minutesViaDsh=false）' }
    }
    // 纪要进度：准备 → 起后台任务 → 模型写 → 读回
    const mnProgress = createProgress({ pipeline: 'minutes' })
    const reportMinutes = () => {
      const snap = mnProgress.snapshot()
      setPostMeeting({ phase: 'minutes', ...snap, progressText: describeProgress(snap) })
    }
    mnProgress.stage('prepare', { detail: '整理转写文本' })
    reportMinutes()

    resetMinutesOutput(dir)
    const src = writeMinutesSource({ dir, lines })
    if (!src.sentences) return { ok: false, error: '没有可写的转写句子' }
    mnProgress.stage('prepare', { detail: src.sentences + ' 句 / ' + src.chars + ' 字', fraction: 1 })
    reportMinutes()

    const prompt = buildMinutesTaskPrompt({
      transcriptPath: src.path.replace(/\\/g, '/'),
      outputPath: join(dir, 'minutes-by-dsh.md').replace(/\\/g, '/'),
      title,
    })
    mnProgress.stage('spawn', { detail: '启动 DSH 后台任务', fraction: 1 })
    reportMinutes()
    const t0 = Date.now()
    mnProgress.stage('generate', { detail: '模型写纪要中（已等 0 秒）', fraction: 0.05 })
    reportMinutes()
    const mnTimer = setInterval(() => {
      try {
        const snap = mnProgress.snapshot()
        const frac = Math.min(0.9, 0.05 + snap.elapsedSec / 120)
        mnProgress.detail('模型写纪要中（已等 ' + snap.elapsedSec + ' 秒）', frac)
        reportMinutes()
      } catch { /* ignore */ }
    }, 2000)
    mnTimer.unref?.()
    const r = await runDshTask(prompt, {
      profile: cfg.minutesProfile || cfg.twin.profile || 'headless',
      cwd: dir,
      timeoutMs: Math.max(120000, Number(cfg.minutesTimeoutMs) || 300000),
    })
    clearInterval(mnTimer)
    mnProgress.stage('read', { detail: '读回纪要', fraction: 0.5 })
    reportMinutes()
    const elapsed = Math.round((Date.now() - t0) / 1000)
    const out = readMinutesResult({ dir })
    if (out.ok) {
      logger?.info?.('[soulmirror] 纪要由 DSH 后台任务完成（' + src.sentences + ' 句，用时 ' + elapsed + 's）')
      return { ok: true, markdown: out.markdown, elapsed, sentences: src.sentences }
    }
    const why = out.error + (r && r.error ? '；任务错误：' + String(r.error).slice(0, 160) : '')
    logger?.warn?.('[soulmirror] 后台任务没写出纪要：' + why)
    return { ok: false, error: why, elapsed }
  }

  function makeDshCompleter(brainCfg) {
      const llm = ctx.get('llm')
      if (!llm || typeof llm.stream !== 'function') return null
      const controller = ctx.get('sessionController')
      return createDshCompleter({
        llm,
        provider: String(brainCfg.provider || ''),
        model: String(brainCfg.model || ''),
        // 逐级回退：配置 → 宿主默认 → 第一个可用 provider 的第一个模型。
        // 以前只查 catalog.default，它为空时整条判定链路直接死掉（现场错误："DSH 没有可用的默认模型"）
        resolveModel: async () => {
          const r = await resolveDefaultModel({
            preferred: { provider: brainCfg.provider, model: brainCfg.model },
            catalog: async () => (controller?.modelCatalog ? await controller.modelCatalog() : null),
            listProviders: async () => (llm.listProviders ? await llm.listProviders() : []),
            listModels: async (p) => (llm.listModels ? await llm.listModels(p) : []),
          })
          brainModel = { provider: r.provider, model: r.model, source: r.source }
          logger?.info?.('[soulmirror] 判定用模型：' + r.provider + '/' + r.model + '（' + r.source + '）')
          return { provider: r.provider, model: r.model }
        },
      })
    }

  const brainKey = cfg.brain.apiKey
    || process.env[cfg.brain.apiKeyEnv || 'BRAIN_API_KEY']
    || process.env.ARK_API_KEY
    || process.env.OPENAI_API_KEY
  // 留空 = 用 DSH 当前模型；只有真的配置了 Key 才走自定义 endpoint。
  const httpCompleter = brainKey ? createCompleter(cfg.brain) : null
  // 优先级：显式配置的 OpenAI 兼容端点 → DSH 会话（默认）。
  // 用户明确要求"用 dsh 的 session 跑"，所以不再依赖 catalog.default 这类全局默认模型。
  // 判定/候选词实际用的模型（由 resolveModel 填入，供界面显示）
  let brainModel = null

  const sessionCompleter = makeSessionCompleter()
  let lastMinutesFallbackReason = ''
  /** 本次纪要由谁产出：background（DSH 后台任务）/ session（会议会话）/ extractive（原文节选） */
  let minutesSource = ''
  const minutesCompleter = makeMinutesCompleter()
  const completer = httpCompleter
    || (cfg.brain.provider ? makeDshCompleter(cfg.brain) : sessionCompleter)

  // 注意：必须在 completer 初始化之后再装配纠错器，否则会踩 TDZ
  //
  // 纠错只在 agent 模式下有意义（它要理解语义再决定是否接话）。
  // 只转录模式每句都等一次模型 = 纯粹增加延迟，所以直接跳过。
  // mode 可以在运行时切换，因此判断放在函数内部，而不是装配时。
  const corrector = (cfg.asr.llmCorrect === false || !completer)
    ? null
    : makeCorrector({ names: fixNames, context: (cfg.asr.context || '') + (currentPersona() ? '\n' + currentPersona().slice(0, 800) : ''), completer })

  session.correctText = corrector
    ? async (text) => {
      if (!cfg.reply.enabled) return '' // 没开 Agent 发言：原样落库，不做任何模型调用
      try {
        const out = await corrector(text)
        // 事故：纠错器把"思考过程"当结果返回，整段被写进转写，越滚越大。
        // 只接受"改好的那一句"，其余一律丢弃（返回空 = 用原文）。
        return sanitizeCorrection(text, out)
      } catch {
        return ''
      }
    }
    : null
  const agent = { running: false, lastDecision: null, spoken: 0, errors: 0 }
  // 同一段话 5 分钟内不重复播；同样内容的展示行 30 秒内不重复插
  const speechGuard = new SpeechDeduper({ windowMs: 5 * 60 * 1000 })
  const lineGuard = new TranscriptDeduper({ windowMs: 30 * 1000 })

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

  /** 最近我们说过的话（新到旧），用于识别回采回声 */
  function recentSaidTexts() {
    const out = []
    try {
      for (const l of (session.transcript || []).slice(-20)) {
        if (l && (l.src === 'assistant' || l.role === 'assistant') && l.text) out.push(l.text)
      }
    } catch { /* ignore */ }
    try {
      if (replyState && replyState.spoken) out.push(replyState.spoken)
    } catch { /* ignore */ }
    try {
      if (lastSpokenText) out.push(lastSpokenText)
    } catch { /* ignore */ }
    return out
  }

  // 转写入库前的最后一道闸：挡掉"模型自己的话"和"我们刚说过的回声"
  let echoSkipped = 0
  session.acceptLine = (item) => {
    if (Date.now() < brain.muteUntil) return false
    const text = String((item && item.text) || '')
    // ① 模型思考/元指令（纠错器与判定器都可能漏出来）
    if (isModelCommentary(text)) {
      echoSkipped += 1
      logger?.warn?.('[soulmirror] 挡掉自己的输出（第 ' + echoSkipped + ' 次）：' + text.slice(0, 50))
      return false
    }
    // ② 我们刚说出去的话被回采成新的一句
    if (isSelfEcho(text, recentSaidTexts())) {
      echoSkipped += 1
      logger?.warn?.('[soulmirror] 挡掉自己的回声（第 ' + echoSkipped + ' 次）：' + text.slice(0, 50))
      return false
    }
    return true
  }
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
    // 说过的话不再说：重复语音最扰人，宁可少说一句
    if (speechGuard.recentlySpoken(d.text)) {
      logger?.info?.('[soulmirror] 跳过重复播报：' + String(d.text).slice(0, 30))
      return
    }
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


  let lastReplyAt = 0
  async function maybeReply(item) {
    if (!cfg.reply.enabled) return
    const text = String(item?.text || '').trim()
    if (!text) return
    // 候选句判别：称谓（容忍识别错字）+ 口语疑问 + 祈使请求。
    // 之前只用「名字 + 问号」，现场两样都不可靠，导致叫了也不动。
    const trig = detectTrigger(text, {
      names: [...(cfg.brain.names || []), ...(cfg.reply.extraNames || [])],
      extraAddress: cfg.reply.extraAddress || [],
    })
    if (!trig.hit) return
    const now = Date.now()
    if (now - lastReplyAt < Math.max(5000, Number(cfg.reply.cooldownMs) || 20000)) return
    lastReplyAt = now
    const r = await generateReplyCandidates(text)
    if (!r.ok) return
    const decision = shouldStartTask({ needsTask: r.needsTask, line: text, names: cfg.brain.names || [] })
    if (decision.start && r.task) {
      logger?.info?.('[soulmirror] 启动 DSH 任务（' + decision.why + '）：' + r.task.slice(0, 60))
      startTaskInBackground(r.task, { why: decision.why }).catch?.(() => {})
    }
    // 要说的内容：优先第一条候选；模型没给候选但有明确触发时，至少应一句
    const sayText = (r.candidates && r.candidates[0]) || (trig.hit ? '我在，你说。' : '')
    if (sayText && cfg.reply.autoSpeak) {
      const said = await speakNow(sayText)
      if (said.ok) {
        replyState = { ...replyState, spoken: sayText }
        // 桌宠同步说一遍（气泡），这样不上会也能看到它在说什么
        try { pushSay(sayText).catch(() => {}) } catch { /* ignore */ }
        addAssistantLine(sayText, 'Agent 发言')
      }
    } else if (sayText) {
      logger?.info?.('[soulmirror] 预览模式：候选已就绪，未自动说 —— ' + sayText.slice(0, 30))
    }
  }

  session.onLine = async (item) => {
    // 每句转写后：① 建议卡片按阈值自动生成（给人看） ② Agent 发言只在候选句触发（说给会议听）
    try { tickAdvice() } catch { /* ignore */ }
    // 让桌宠跟着会议状态走（内部按"有没有变化"去重）
    try { pushWorkStatus().catch(() => {}) } catch { /* ignore */ }
    // 把最新一句送进气泡（节流 8 秒，碎片与重复句跳过）
    try {
      const line = formatTranscriptBubble(item)
      if (shouldPushTranscript(lastTranscriptBubble, line)) {
        bubbleByPriority({ transcript: line }).catch(() => {})
      }
    } catch { /* ignore */ }
    // 会话回合可能要十几秒，不能阻塞转写流程：发出去就不管了
    try { maybeReply(item).catch((e) => noteLlmError('候选词', e)) } catch (e) { noteLlmError('候选词', e) }
    noteSpeech()
    try {
      const spk = await speakerNow()
      if (spk) item.speaker = spk
    } catch { /* ignore */ }
    if (!agent.running) return
    try { memory.add({ role: 'user', text: item.text, session: session.dir }) } catch { /* ignore */ }
    try { living.absorb(item.text, { speaker: item.speaker || '', source: 'meeting' }) } catch { /* ignore */ }
    // 只转录模式：到此为止——不判定要不要接话、不发言、不建任务会话
    if (!cfg.reply.enabled) return
    const trig = brain.push(item)
    // brain.push 返回 null 有两种含义：静音期（自说自听）或规则未命中。
    // 前者必须无条件退出，否则 LLM 模式会把我们自己的 TTS 当成别人说话，形成回声自答。
    if (!trig && Date.now() < brain.muteUntil) {
      logger?.info?.('[soulmirror] 静音期内的转写，忽略')
      return
    }
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
        const key = resolveDashScopeKey({ ...cfg.asr, apiKey: keyFor(cfg.asr, 'asr') }).key
        if (!key) {
          return { ok: false, result: '缺少 DashScope Key：环境变量 ' + (cfg.asr.apiKeyEnv || 'DASHSCOPE_API_KEY') + ' 未设置，配置里也没有填。\n在「会议 → 配置」里填 Key 并保存，或 setx 后重启 DSH。' }
        }
      }
      agent.running = true
      armed = true
      await session.startCapture(a.label || 'agent')
      lastSessionDir = session.dir || ''
      try {
        saveMeta(session.dir, {
          startedAt: session.startedAt || new Date().toISOString(),
          title: (loadPreparation(session.dir).goal || '').slice(0, 60),
          app: (cfg.activeApp || cfg.processName || ''),
        })
      } catch { /* ignore */ }
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
      armed = false
      // 停止大脑 = 这场会不听了：同样要整理，否则用户拿不到纪要
      const o = await stopAndOrganize('停止会议大脑', { wasCapturing: true })
      const tail2 = o.organized ? '；已开始会后整理' : (o.reason ? '；' + o.reason : '')
      return { ok: true, result: `已停止：听过 ${brain.stats.seen} 句，触发 ${brain.stats.triggered} 次，播报 ${agent.spoken} 次` + tail2 }
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

  ctx.tools.register(defineTool({
    name: 'meeting_recalibrate',
    description:
      '重新标定会议软件按钮位置：开一个带 computer-use 的会话，让它自己试出「加入会议」按钮位置并存进坐标表。入会反复失败时用它。',
    parameters: {
      app: { type: 'string', description: '会议软件名（可选，默认当前）' },
      action: { type: 'string', description: 'join / quick / schedule / share（默认 join）' },
    },
    output: OUT(),
    execute: wrap('meeting_recalibrate', async (a) => {
      const app = a.app ? meetingApp(a.app) : await detectMeetingApp()
      const action = String(a.action || 'join')
      if (!app || !app.name) return { ok: false, result: '没检测到会议软件，先把客户端打开' }
      if (!isArmed()) return { ok: false, result: '会议功能未开启，不会去操作桌面。先在面板里打开开关，或调用 meeting_agent_start' }
      if (!cfg.autoCalibrate) return { ok: false, result: '自动标定已在配置里关闭（autoCalibrate: false）' }
      const meta = uiMap.meta(app.name, action)
      const need = uiMap.needsRecalibration(app.name, action, cfg.recalibrateThreshold)
      const r = calibrator.trigger({ app: app.name, action, reason: meta.lastReason || '', failures: meta.failures || 0 })
      if (!r.started) {
        return { ok: false, result: '没启动：' + (r.skipped === 'running' ? '已经在标定了，等它跑完' : r.skipped === 'cooldown' ? '刚标定过，几分钟后再试' : r.skipped === 'not-armed' ? '会议功能未开启' : String(r.skipped)) }
      }
      const entry = await r.job
      const saved = uiMap.get(app.name, action)
      const lines = []
      lines.push('标定' + (entry.ok ? '完成' : '未确认') + '（' + entry.ms + 'ms）')
      lines.push('当前坐标：' + (saved ? saved.x + ', ' + saved.y : '仍未标定'))
      if (entry.text) lines.push('会话回报：' + entry.text)
      if (!entry.ok && entry.error) lines.push('错误：' + entry.error)
      if (need.failures) lines.push('（此前连续失败 ' + need.failures + ' 次）')
      return { ok: !!saved, result: lines.join('\n') }
    }),
  }))
  // ── 工作模式：只转录 / Agent 自动回复 ────────────────────────────────
  ctx.tools.register(defineTool({
    name: 'meeting_mode',
    description: '查看或切换会议助手的工作模式：transcribe=只转录（不判定不发言不建会话）；agent=开启自动回复。',
    parameters: {
      mode: { type: 'string', description: 'transcribe | agent；不传则只查看当前模式' },
    },
    output: OUT(),
    execute: wrap('meeting_mode', async (a) => {
      const want = String(a.mode || '').trim().toLowerCase()
      if (!want) {
        return { ok: true, result: '当前模式：' + (cfg.mode === 'agent' ? 'agent（自动回复）' : 'transcribe（只转录）') }
      }
      if (want !== 'transcribe' && want !== 'agent') {
        return { ok: false, result: '只支持 transcribe 或 agent' }
      }
      cfg.mode = want
      try { savePersisted({ mode: want }) } catch { /* ignore */ }
      logger?.info?.('[soulmirror] 模式切换为 ' + want)
      return {
        ok: true,
        result: want === 'agent'
          ? '已切到 Agent 模式：会判断要不要接话、需要时发言、并把活交给 DSH'
          : '已切到只转录模式：只采集和转写，不判定、不发言、不建会话（省 token）',
      }
    }),
  }))
  // ── 到点自动参会：落到 DSH 的「自动化任务」上 ────────────────────────
  ctx.tools.register(defineTool({
    name: 'meeting_auto_attend',
    description:
      '预约一次自动参会：用 DSH 自动化任务在指定时间投递一条去入会的指令，到点由会话自己入会、开始采集、散会出纪要。适合那个时间我不在、你替我去。',
    parameters: {
      at: { type: 'string', required: true, description: '入会时间：15:00 / 2026-10-27 15:00 / ISO' },
      url: { type: 'string', description: '入会链接（优先）' },
      code: { type: 'string', description: '会议号（没有链接时用）' },
      title: { type: 'string', description: '会议主题' },
      durationMin: { type: 'number', description: '会议时长（分钟）' },
      sessionId: { type: 'string', description: '挂到哪个会话（可选，默认当前）' },
    },
    output: OUT(),
    execute: wrap('meeting_auto_attend', async (a) => {
      if (!cfg.enabled) return { ok: false, result: '插件未开启，先打开总开关' }
      const svc = scheduleService()
      if (!svc) return { ok: false, result: '宿主没有 schedule 服务，无法安排自动化任务' }
      if (!a.url && !a.code) return { ok: false, result: '需要会议号或入会链接' }
      const when = parseWhenLoose(a.at)
      if (!when) return { ok: false, result: '时间解析失败：' + a.at }
      const sid = String(a.sessionId || (a._session && a._session.id) || '').trim()
      if (!sid) return { ok: false, result: '拿不到会话 id，请在会话里调用' }
      const job = { url: a.url || '', code: a.code || '', title: a.title || '', durationMin: Number(a.durationMin) || 0 }
      try {
        const rec = await svc.create(sid, {
          title: '替你去开会：' + (job.title || job.code || '会议'),
          prompt: buildAttendPrompt(job),
          at: when.toISOString(),
        })
        return {
          ok: true,
          result: [
            '已排进 DSH 自动化任务：' + when.toLocaleString(),
            '任务 id：' + (rec && rec.id ? rec.id : '(已创建)'),
            '到点会在该会话投递指令 → 入会 → 采集 → 散会出纪要',
            '前提：DSH 保持运行、插件开关保持开启',
          ].join('\n'),
        }
      } catch (e) {
        return { ok: false, result: '创建自动化任务失败：' + e.message }
      }
    }),
  }))

  ctx.tools.register(defineTool({
    name: 'meeting_schedule_list',
    description: '列出已安排的自动参会任务（读 DSH 自动化任务）。',
    parameters: { sessionId: { type: 'string', description: '会话 id（可选）' } },
    output: OUT(),
    execute: wrap('meeting_schedule_list', async (a) => {
      const svc = scheduleService()
      if (!svc) return { ok: false, result: '宿主没有 schedule 服务' }
      const sid = String(a.sessionId || (a._session && a._session.id) || '').trim()
      try {
        const rows = sid && svc.list ? await svc.list({ sessionId: sid }) : (svc.catalog ? await svc.catalog() : [])
        const mine = (rows || []).filter((r) => /替你去开会/.test(String(r.title || '')))
        if (!mine.length) return { ok: true, result: '没有待执行的自动参会任务' }
        return { ok: true, result: mine.map((r) => '- ' + (r.scheduledAt || r.at || '') + ' ' + (r.title || '') + ' [id=' + (r.id || '') + ']').join('\n') }
      } catch (e) {
        return { ok: false, result: '读取失败：' + e.message }
      }
    }),
  }))

  ctx.tools.register(defineTool({
    name: 'meeting_schedule_cancel',
    description: '取消一个自动参会任务（删除对应的 DSH 自动化任务）。',
    parameters: { id: { type: 'string', required: true, description: '任务 id' } },
    output: OUT(),
    execute: wrap('meeting_schedule_cancel', async (a) => {
      const svc = scheduleService()
      if (!svc) return { ok: false, result: '宿主没有 schedule 服务' }
      try {
        if (svc.delete) await svc.delete({ id: String(a.id || "") })
        return { ok: true, result: '已取消：' + a.id }
      } catch (e) {
        return { ok: false, result: '取消失败：' + e.message }
      }
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
        cfg.activeAppAuto = false
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
      cfg.activeAppAuto = false
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

  /**
   * 给模型看的转写行：只保留"人说的话"。
   *
   * 事故根因之一：assistant 行（我们自己的回复与判定输出）也躺在 session.transcript 里，
   * 于是每一次纪要/建议都把上一轮的模型输出当成"会议内容"再喂一遍——
   * 转写越长、喂得越多，越像在无限复读。
   */
  function speechLines(limit = 80) {
    const all = Array.isArray(session.transcript) ? session.transcript : []
    const human = all.filter((l) => l && l.text && l.role !== 'assistant' && l.src !== 'assistant')
    return human.slice(-limit)
  }

  async function buildMinutes(limit = 80) {
    const lines = speechLines(limit)
    if (lines.length === 0) return ''
    const text = lines.map((l) => l.text).join('\n')
    // 快照 = 目录 + 句数 + 末句。三者都没变 → 内容必然一样，没有重算的理由。
    const key = [session.dir || '', lines.length, lines[lines.length - 1].t || '', (lines[lines.length - 1].text || '').slice(0, 40)].join('|')
    if (key && key === minutesKey) {
      minutesKeyRuns += 1
      logger?.warn?.('[soulmirror] 跳过重复的纪要生成（转写快照未变，第 ' + minutesKeyRuns + ' 次），' + lines.length + ' 句')
      return lastMinutesMd || ''
    }
    minutesKey = key
    minutesKeyRuns = 0
    minutesRuns += 1
    logger?.info?.('[soulmirror] 生成纪要（第 ' + minutesRuns + ' 次）：' + lines.length + ' 句，dir=' + (session.dir || '(空)'))
    if (completer) {
      try {
        const out = await completer([
          { role: 'system', content: '你是会议纪要助手。输出 Markdown：## 决议 / ## 待办 / ## 风险 / ## 未决问题，没有就写“无”。不要编造。' },
          { role: 'user', content: text },
        ])
        if (out) { lastMinutesMd = out; return out }
    } catch (e) {
      lastMinutesFallbackReason = '纪要模型调用失败：' + (e && e.message ? e.message : String(e))
      logger?.warn?.('[soulmirror] ' + lastMinutesFallbackReason)
    }
    // 兜底必须诚实：这不是摘要，是原文节选，并说明为什么没生成
    }
    const reason = lastMinutesFallbackReason || (typeof getLastMinutesError === 'function' && getLastMinutesError()) || '模型未就绪'
    const fallback = '> ⚠ 本次没有生成正式纪要（' + reason + '）。\n> 下面是最后 12 句原文节选，不是摘要。\n\n' +
      '## 会议要点（原文节选）\n' + lines.slice(-12).map((l) => '- ' + l.text).join('\n')
    lastMinutesMd = fallback
    return fallback
  }

  // ── 会中建议（追问 / 回应）与模型错误 ──────────────────────────
  // 模型失败必须能看见：只写日志等于没写，用户只会觉得"没反应"
  let lastLlmError = null
  // 发言失败的原因：TTS 没 key、虚拟声卡没配、mic 切换失败都会落在这里
  let lastSpokenText = ''
  let lastSpeakError = null
  // 发言链路的体检结果：音频有没有进虚拟声卡、会议有没有真的在用虚拟麦克风
  let lastSpeakInfo = null
  let adviceState = { at: 0, questions: [], replies: [], lines: 0, error: '', busy: false }

  // ── Agent 发言的候选词 ──────────────────────────────────────
  // 与建议卡片分开：建议是给人看的，候选词是要说给会议里所有人听的
  let replyState = { at: 0, line: '', candidates: [], needsTask: false, task: '', spoken: '', error: '' }

  /** 真正把一句话说进会议；返回 {ok,error} 便于界面反馈 */
  async function speakNow(text) {
    const t = String(text || '').trim()
    // 这些"提前返回"也是失败，必须记录，否则界面一片安静
    const bail = (why) => {
      lastSpeakError = { at: new Date().toISOString(), message: why }
      logger?.warn?.('[soulmirror] 未发言：' + why)
      return { ok: false, error: why }
    }
    if (!t) return bail('没有内容可说')
    if (!cfg.enabled) return bail('插件未开启')
    if (cfg.policy === 'observe') return bail('policy=observe（只记不说）')
    try {
      // switchMic=false：会议已经把虚拟麦克风选死了，不需要每次切系统默认
      if (cfg.devices.speak && cfg.devices.micRestore && cfg.devices.switchMic !== false) {
        const spoken = await sayToMeeting(t, cfg.tts, { speakDevice: cfg.devices.speak, micRestore: cfg.devices.micRestore, windowTitle: cfg.windowTitle, logger })
        lastSpeakInfo = {
          at: new Date().toISOString(),
          switched: !!spoken.switched,
          verified: !!spoken.verified,
          activeDevice: spoken.activeDevice || '',
          cableMic: spoken.cableMic || '',
          ptt: !!spoken.ptt,
        }
        if (spoken.switched && !spoken.verified) {
          logger?.warn?.('[soulmirror] 会议没有使用虚拟麦克风（当前：' + (spoken.activeDevice || '未知') + '），对方可能听不到')
        }
      } else {
        // 没配虚拟声卡时也会播到扬声器，由 sayToMeeting 自己处理
        await sayToMeeting(t, cfg.tts, { logger })
      }
      agent.spoken = (agent.spoken || 0) + 1
      lastSpeakError = null
    lastSpokenText = String(text || "")
      return { ok: true, text: t }
    } catch (e) {
      lastSpeakError = { at: new Date().toISOString(), message: String(e.message || e).slice(0, 300) }
      logger?.warn?.('[soulmirror] 发言失败：' + lastSpeakError.message)
      return { ok: false, error: e.message }
    }
  }

  async function generateReplyCandidates(lineText) {
    if (!completer) return { ok: false, error: '没有可用模型' }
    const text = String(lineText || '').trim()
    if (!text) return { ok: false, error: '没有内容可回复' }
    try {
      const msgs = buildReplyPrompt({
        line: text,
        context: (session.transcript || []).slice(-8),
        names: cfg.brain.names || [],
      })
      const raw = await completer(msgs)
      const parsed = parseReply(raw)
      replyState = {
        at: Date.now(),
        reason: replyState.reason || '',
        line: text,
        candidates: parsed.candidates,
        needsTask: parsed.needsTask,
        task: parsed.task,
        spoken: '',
        error: parsed.candidates.length ? '' : '模型没有给出可用候选',
      }
      lastLlmError = null
      return { ok: parsed.candidates.length > 0, ...replyState }
    } catch (e) {
      if (e && e.code === 'COALESCED') {
        return { ok: false, skipped: 'coalesced' }
      }
      noteLlmError('生成候选词', e)
      replyState = { ...replyState, at: Date.now(), line: text, candidates: [], error: e.message }
      return { ok: false, error: e.message }
    }
  }

  function noteLlmError(stage, err) {
    // 被闸门合并掉的请求不是失败，别写进 lastLlmError 让用户以为模型坏了
    if (err && err.code === 'COALESCED') return
    lastLlmError = { at: new Date().toISOString(), stage, message: String(err && err.message ? err.message : err).slice(0, 300) }
    logger?.warn?.('[soulmirror] ' + stage + ' 失败：' + lastLlmError.message)
  }

  // 自动触发的状态（与参考项目同构）：throughLine / failedThroughLine / 冷却
  let adviceTrigger = { throughLine: 0, failedThroughLine: -1, lastAttemptAt: 0, lastSuccessAt: Date.now(), running: false, characters: 0 }

  /** 每次有新转写就检查一次该不该自动生成；返回触发原因便于日志 */
  function tickAdvice() {
    if (!cfg.advice.enabled || !cfg.advice.auto) return null
    if (!completer) return null
    const linesAll = speechLines(40)
    if (linesAll.length === 0) return null
    let chars = 0
    for (const l of linesAll) chars += countCharacters(l.text)
    const newChars = Math.max(0, chars - adviceTrigger.characters)
    const reason = automaticReason(
      { ...adviceTrigger, running: adviceTrigger.running },
      { latestLine: linesAll.length, newChars, now: Date.now() },
      cfg.advice,
    )
    if (!reason) return null
    adviceTrigger.lastAttemptAt = Date.now()
    adviceTrigger.running = true
    generateAdvice({ reason })
      .then((r) => {
        if (r && r.ok) {
          adviceTrigger.throughLine = linesAll.length
          adviceTrigger.characters = chars
          adviceTrigger.lastSuccessAt = Date.now()
          adviceTrigger.failedThroughLine = -1
        } else {
          // 同样的内容失败后不再自动重试（避免反复烧钱）
          adviceTrigger.failedThroughLine = linesAll.length
        }
      })
      .catch(() => { adviceTrigger.failedThroughLine = linesAll.length })
      .finally(() => { adviceTrigger.running = false })
    return reason
  }

  async function generateAdvice({ force = false, reason = 'manual' } = {}) {
    if (adviceState.busy) return { ok: false, error: '上一次生成还没结束' }
    if (!completer) return { ok: false, error: '没有可用模型：先在设置里配置 brain.provider / brain.model' }
    const linesAll = speechLines(40)
    if (linesAll.length === 0) return { ok: false, error: '还没有转写内容' }

    adviceState.busy = true
    try {
      const prep = loadPreparation(session.dir || lastSessionDir)
      const msgs = buildAdvicePrompt({ goal: prep.goal, invite: prep.invite, lines: linesAll, maxLines: 40 })
      const raw = await completer(msgs)
      const parsed = parseAdvice(raw)
      if (!shouldReplaceAdvice(parsed)) {
        const msg = '模型没有给出可用建议（可能内容太少）'
        adviceState = { ...adviceState, at: Date.now(), error: msg, busy: false, lines: linesAll.length }
        return { ok: false, error: msg, raw: String(raw || '').slice(0, 500) }
      }
      adviceState = {
        at: Date.now(),
        questions: parsed.questions,
        replies: parsed.replies,
        lines: linesAll.length,
        error: '',
        busy: false,
      }
      lastLlmError = null
      logger?.info?.('[soulmirror] 已生成建议：追问 ' + parsed.questions.length + ' 条，回应 ' + parsed.replies.length + ' 条')
      // 建议也送到桌宠气泡（优先级低于发言，高于转写）
      try {
        const adv = formatAdviceBubble(adviceState)
        if (adv) bubbleByPriority({ advice: adv }).catch(() => {})
      } catch { /* ignore */ }
      return { ok: true, ...adviceState }
    } catch (e) {
      if (e && e.code === 'COALESCED') {
        adviceState = { ...adviceState, busy: false }
        return { ok: false, skipped: 'coalesced' }
      }
      noteLlmError('生成建议', e)
      adviceState = { ...adviceState, at: Date.now(), error: e.message, busy: false }
      return { ok: false, error: e.message }
    } finally {
      adviceState.busy = false
    }
  }

  /**
   * 把最近的会议转写作为一段上下文送进 Agent 会话。
   *
   * 为什么要用户可控：每送一次就是一轮真实对话，会产生 token 消耗，
   * 也可能让 Agent 主动说话。所以默认只在用户点按钮时发生，自动同步要显式开启。
   */
  let lastInjectAt = 0
  let lastInjectCount = 0
  async function injectTranscriptContext({ reason = 'manual', force = false } = {}) {
    const sc = ctx.get('sessionController')
    const sid = meeting.dshSessionId || ''
    if (!sc || typeof sc.prompt !== 'function') return { ok: false, error: '没有可用的会话服务' }
    if (!sid) return { ok: false, error: '还没有为这场会议建会话（先开始录音）' }

    const linesAll = speechLines(40)
    if (linesAll.length === 0) return { ok: false, error: '还没有转写内容' }
    // 没有新内容就别重复发（自动同步会一直空转）
    if (!force && linesAll.length === lastInjectCount) return { ok: true, skipped: '没有新转写' }

    const prep = loadPreparation(session.dir || lastSessionDir)
    const text = buildSnapshot(linesAll, {
      maxLines: cfg.context.maxLines,
      maxChars: cfg.context.maxChars,
      invite: prep.invite,
      goal: prep.goal,
    })
    if (!text) return { ok: false, error: '还没有转写内容' }

    try {
      await sc.prompt({
        requestId: 'soulmirror-ctx-' + Date.now(),
        sessionId: sid,
        mode: 'queue',
        content: [{ type: 'text', text }],
      })
    } catch (e) {
      return { ok: false, error: '送入会话失败：' + e.message }
    }
    lastInjectAt = Date.now()
    lastInjectCount = linesAll.length
    logger?.info?.('[soulmirror] 已把 ' + linesAll.length + ' 句转写送进会话（' + reason + '）')
    return { ok: true, lines: linesAll.length, chars: text.length, reason }
  }

  /** 自动同步：只在 agent 模式下、且开关打开时跑 */
  let ctxTimer = null
  function startContextPump() {
    if (ctxTimer) return
    ctxTimer = setInterval(() => {
      if (!cfg.context.autoInject) return
      if (!cfg.reply.enabled) return
      if (!session.capturing) return
      injectTranscriptContext({ reason: 'auto' }).catch(() => {})
    }, Math.max(15000, Number(cfg.context.everyMs) || 60000))
    ctxTimer.unref?.()
  }

  /**
   * 会后离线重转写：拿整场录音按 4 倍速重跑一遍识别，得到完整句子，再生成纪要。
   * 实时那条线的价值是"边开边看"；这条线的价值是"结束后不漏句"。
   */
  // 会后整理进度：点"结束录音"后依次做 离线重转写 → 纪要 → 知识库
  // 之前这些步骤只在会议窗口退出时触发，用户点结束录音后完全没反应、也没进度可看
  let postMeeting = { phase: 'idle', at: 0, error: '', sentences: 0, speakers: 0, minutesPath: '', dir: '' }
  const setPostMeeting = (patch) => { postMeeting = { ...postMeeting, ...patch, at: Date.now() } }

  let offlineBusy = false
  /**
   * 把会后重转写交给独立的 dsh 进程（后台 agent），主进程不再承担这份内存与 CPU。
   *
   * 为什么：离线重转写要把整份录音上传、等云端排队、再解析结果，
   * 曾经在 4GB 堆上限处把宿主撑爆。放到子进程后，即使它爆了也只死那个进程，
   * 会议数据仍在磁盘上（transcript.jsonl 是流式写入的，随时可恢复）。
   */
  /**
   * 语音识别联通性：真的开一次 WebSocket，等到 task-started 就算通。
   *
   * 为什么不做"假的 HTTP 探测"：DashScope 的流式识别只有真正握手 + 建任务才算可用；
   * 拿 401 这种鉴权问题，只有握手阶段才暴露。
   */
  async function probeAsrConn() {
    const t0 = Date.now()
    const key = resolveDashScopeKey({ ...cfg.asr, apiKey: keyFor(cfg.asr, 'asr') }).key
    if (!key) return { ok: false, ms: 0, error: new Error(keyProblem('asr') || '缺少密钥：环境变量 DASHSCOPE_API_KEY 未设置') }
    return await new Promise((resolve) => {
      let settled = false
      const done = (r) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        try { asr?.finish?.()?.catch?.(() => {}) } catch { /* ignore */ }
        resolve(r)
      }
      const timer = setTimeout(() => done({ ok: false, ms: Date.now() - t0, error: new Error('timeout: 15s 内没握手成功') }), 15000)
      let asr
      try {
        asr = startDashScopeAsr({
          apiKey: key,
          model: resolveAsrModel(cfg.asr),
          sampleRate: 16000,
          asr: cfg.asr,
          onSentence: () => {},
          onError: (e) => done({ ok: false, ms: Date.now() - t0, error: e }),
          onReady: () => done({ ok: true, ms: Date.now() - t0 }),
        })
        asr.open().catch((e) => done({ ok: false, ms: Date.now() - t0, error: e }))
      } catch (e) {
        done({ ok: false, ms: Date.now() - t0, error: e })
      }
    })
  }

  /**
   * 语音合成联通性：合成一个极短词，拿到第一块音频就算通。
   * 只发"测"一个字，成本可以忽略。
   */
  async function probeTtsConn() {
    const t0 = Date.now()
    const key = resolveDashScopeKey({ ...cfg.tts, apiKey: keyFor(cfg.tts, 'tts') }).key
    const provider = String(cfg.tts.provider || 'dashscope')
    if (provider !== 'dashscope') {
      // sapi 是本机离线合成：只要没抛错就算通，不产生网络请求
      try {
        const out = join(CONFIG_DIR, 'tts-probe.wav')
        await synthesize('测', cfg.tts, out)
        return { ok: existsSync(out), ms: Date.now() - t0, detail: '本机离线合成（sapi）' }
      } catch (e) {
        return { ok: false, ms: Date.now() - t0, error: e }
      }
    }
    if (!key) return { ok: false, ms: 0, error: new Error(keyProblem('asr') || '缺少密钥：环境变量 DASHSCOPE_API_KEY 未设置') }
    return await new Promise((resolve) => {
      let settled = false
      const done = (r) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve(r)
      }
      const timer = setTimeout(() => done({ ok: false, ms: Date.now() - t0, error: new Error('timeout: 20s 内没合成出音频') }), 20000)
      synthesizeStream({
        apiKey: key,
        model: cfg.tts.model || 'cosyvoice-v2',
        voice: cfg.tts.voice || 'longxiaochun_v2',
        sampleRate: 16000,
        onAudio: () => done({ ok: true, ms: Date.now() - t0 }),
      }).then((s) => {
        // 只发一个短词，拿到第一块就停
        try { s.speak('测') } catch (e) { done({ ok: false, ms: Date.now() - t0, error: e }) }
        try { s.finish() } catch { /* ignore */ }
      }).catch((e) => done({ ok: false, ms: Date.now() - t0, error: e }))
    })
  }

  /**
   * 拿到宿主 web 服务的端口。
   *
   * 原来只看 ctx.webServer.port，取不到就 return 0 —— 于是写库静默变成
   * "跳过（宿主没装知识库或拿不到端口）"，用户只看到纪要没进库，完全不知道原因。
   * 这里多找几个来源，并把结果记进 /status 便于排查。
   */
  function resolveHostPort() {
    const tried = []
    try {
      const ws = ctx.webServer || ctx.get?.('webServer')
      if (ws?.port) return Number(ws.port)
      tried.push('webServer.port')
      const addr = ws?.server?.address?.()
      if (addr && typeof addr === 'object' && addr.port) return Number(addr.port)
      tried.push('webServer.server.address().port')
      if (ws?.server?.port) return Number(ws.server.port)
    } catch { /* ignore */ }
    for (const k of ['DSH_WEB_PORT', 'DASH_PORT', 'PORT']) {
      const v = Number(process.env[k])
      if (v) return v
    }
    tried.push('env')
    hostPortInfo = { port: 0, tried }
    return 0
  }

  /**
   * 未整理会议的扫描结果缓存。
   *
   * /status 会被面板每隔几秒轮询一次，所以：
   *   - 扫描本身只 stat、不读内容（见 lib/recovery.js）
   *   - 结果缓存 30 秒，避免每次都 walk 目录
   *   - 启动后异步跑一次，不阻塞任何请求
   */
  let pendingRecovery = []
  let pendingRecoveryAt = 0
  let pendingRecoveryBusy = false

  async function listPendingRecovery({ force = false } = {}) {
    const now = Date.now()
    if (!force && now - pendingRecoveryAt < 30000) return pendingRecovery
    if (pendingRecoveryBusy) return pendingRecovery
    pendingRecoveryBusy = true
    try {
      const root = CONFIG_DIR
      pendingRecovery = scanPendingRecovery({
        root,
        now,
        readdir: (p) => readdirSync(p),
        exists: existsSync,
        stat: (p) => { try { const s = statSync(p); return { size: s.size, mtimeMs: s.mtimeMs } } catch { return null } },
        join,
      })
      pendingRecoveryAt = now
    } catch (e) {
      logger?.warn?.('[soulmirror] 扫描未整理会议失败：' + e.message)
      pendingRecovery = []
    } finally {
      pendingRecoveryBusy = false
    }
    return pendingRecovery
  }

  /**
   * 用账本补出纪要（不重转写、不上传、不占内存）。
   *
   * 只做：读账本（回放折叠）→ 生成纪要 → 落盘 →（可选）写知识库。
   * 音频不参与，所以内存占用与"一次读一个文本文件"相当。
   */
  async function recoverMeeting(dir) {
    if (!dir) return { ok: false, error: '没有会议目录' }
    const ok = isPendingRecovery({
      dir, now: Date.now(),
      exists: existsSync,
      stat: (p) => { try { const s = statSync(p); return { size: s.size, mtimeMs: s.mtimeMs } } catch { return null } },
      join,
    })
    if (!ok) return { ok: false, error: '这场会议不需要补整理（已有纪要，或数据太新/为空）' }

    try {
      // 内存保护：补整理会把账本整份读进来做回放。正常会议账本只有几十 KB；
      // 异常大时（说明有东西在刷行）直接拒绝，避免一次读几百 MB 造成卡顿。
      const st = (() => { try { return statSync(join(dir, 'transcript.jsonl')) } catch { return null } })()
      const sizeMb = st ? st.size / 1048576 : 0
      if (sizeMb > 8) {
        return {
          ok: false,
          error: '账本过大（' + sizeMb.toFixed(1) + 'MB），不做内存回放。请改用「会后重转写」（基于录音文件），它不把账本整份读进内存。',
        }
      }
      const raw = await readFile(join(dir, 'transcript.jsonl'), 'utf8')
      const replay = readLogText(raw)
      const texts = replay.lines
        .filter((x) => x && x.text && x.role !== 'assistant' && x.src !== 'gap')
        // 别把助手自己的播报（"会议纪要已写入知识库"）当成会议内容
        .filter((x) => !/会议纪要已写入知识库|已写入知识库|开始会后整理/.test(String(x.text)))
        .map((x) => ({ text: (x.speaker ? x.speaker + '：' : '') + x.text }))
      if (!texts.length) return { ok: false, error: '账本里没有可用句子' }

      setPostMeeting({ phase: 'minutes', sentences: texts.length, dir })
      const md = await buildOfflineMinutes({ sentences: texts, completer: minutesCompleter || completer })
      if (!md) return { ok: false, error: '纪要生成失败（模型没返回内容）' }
      const saved = await persistMinutesFile(join(dir, 'minutes.md'), md)
      logger?.info?.('[soulmirror] 已从账本补出纪要：' + dir + '（' + texts.length + ' 句）')

      // 能写知识库就顺手写：失败不影响本地纪要
      let knowledge = ''
      try {
        const kd = detectKnowledge(cfg.knowledge.profile || '')
        const port = resolveHostPort()
        if (cfg.knowledge.enabled && kd.host && port) {
          const r = await writeViaHostApi({
            port, origin: 'http://127.0.0.1:' + port,
            title: '补整理 · ' + (require('node:path').basename(dir)),
            markdown: md, type: 'decision', group: '会议纪要',
          })
          knowledge = r.ok
            ? '已写入知识库（' + String(r.id || 'ok').slice(0, 8) + '）'
            : '未写入：' + (r.error || r.status || '') + (r.note ? '（' + r.note + '）' : '')
        }
      } catch { /* ignore */ }

      setPostMeeting({ phase: 'done', sentences: texts.length, dir })
      pendingRecoveryAt = 0   // 让下次轮询重新扫描
      return { ok: true, sentences: texts.length, minutesPath: saved.path, knowledge, md }
    } catch (e) {
      setPostMeeting({ phase: 'error', error: e.message, dir })
      return { ok: false, error: e.message }
    }
  }

  async function runOfflineInBackground(dir) {
    const prompt = '执行 meeting_offline_pass，dir=' + dir +
      '。只做这一件事：对这场会议的录音做会后重转写，生成纪要写到该目录，不要汇报别的内容。'
    try {
      const r = await runDshTask(prompt, { cwd: dir, timeoutMs: Math.max(60000, Number(cfg.offlineTimeoutMs) || 10 * 60 * 1000) })
      if (r && r.ok) {
        logger?.info?.('[soulmirror] 会后重转写（后台进程）完成：' + String(r.text || '').slice(0, 120))
        // 子进程已经把结果写进会议目录；这里读回摘要，保持与内联版本一致的返回形状
        return await readOfflineResult(dir, r.text)
      }
      logger?.warn?.('[soulmirror] 后台重转写失败，改为主进程内联执行：' + (r && r.error))
    } catch (e) {
      logger?.warn?.('[soulmirror] 后台重转写异常，改为主进程内联执行：' + e.message)
    }
    return runOfflinePass(dir)
  }

  /** 从会议目录读回子进程写下的结果（供 finalizeMeeting 使用） */
  async function readOfflineResult(dir, text) {
    try {
      const raw = await readFile(join(dir, 'transcript-offline.jsonl'), 'utf8')
      const lines = raw.split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
      const speakers = new Set(lines.map((x) => x.speaker).filter(Boolean)).size
      const mdPath = join(dir, 'minutes.md')
      const md = existsSync(mdPath) ? await readFile(mdPath, 'utf8') : ''
      return {
        ok: lines.length > 0,
        sentences: lines.length,
        speakers,
        mode: 'file',
        seconds: 0,
        elapsed: 0,
        md,
        minutesPath: existsSync(mdPath) ? mdPath : '',
        viaBackground: true,
      }
    } catch {
      return { ok: false, error: '后台任务已执行，但读不到结果文件：' + String(text || '').slice(0, 100) }
    }
  }

  async function runOfflinePass(dir = session.dir, { isCancelled } = {}) {
    if (offlineBusy) return { ok: false, error: '上一次离线转写还没结束' }
    if (!dir) return { ok: false, error: '没有会议目录' }
    const wav = join(dir, 'audio.wav')
    if (!existsSync(wav)) return { ok: false, error: '没有录音文件（本次可能没采到音频）' }
    const key = resolveDashScopeKey({ ...cfg.asr, apiKey: keyFor(cfg.asr, 'asr') }).key
    if (!key) {
      const why = keyProblem('asr')
      return { ok: false, error: why || '缺少语音识别密钥（未配置）' }
    }

    offlineBusy = true
    const offProgress = createProgress({ pipeline: 'offline' })
    const reportOffline = (extra = {}) => {
      const snap = offProgress.snapshot()
      setPostMeeting({ phase: 'offline', error: '', dir, ...snap, progressText: describeProgress(snap), ...extra })
    }
    setPostMeeting({ phase: 'offline', error: '', dir })
    offProgress.stage('prepare', { detail: '检查录音与设备' })
    reportOffline()
    try { pushWorkStatus(true).catch(() => {}) } catch { /* ignore */ }
    const t0 = Date.now()
    try {
      const { seconds } = readWavHeader(wav)   // 只读头，不读整份 PCM
      logger?.info?.('[soulmirror] 会后重转写开始（云端文件识别 + 说话人分离）：' + Math.round(seconds) + ' 秒音频')

      // 优先用云端文件识别：能分人、断句更准
      let lines = []
      let mode = 'file'
      try {
        // 超大录音跳过云端文件识别：它要整份上传，几十分钟的会议代价高、也更容易失败。
        // 超过 300MB（约 2.5 小时 16k 单声道）直接走本地重放，内存有界。
        const wavBytes = (() => { try { return statSync(wav).size } catch { return 0 } })()
        if (wavBytes > 300 * 1024 * 1024) {
          logger?.warn?.('[soulmirror] 录音 ' + Math.round(wavBytes / 1048576) + 'MB 过大，跳过云端文件识别，改用本地重放')
          throw new Error("录音过大（" + Math.round(wavBytes / 1048576) + "MB），跳过文件识别")
        }

        // 先看有没有人声：整段静音上传只会换来 SUCCESS_WITH_NO_VALID_FRAGMENT（白花流量）
        let uploadWav = wav
        try {
          const scan = await scanAudioLevels(wav)
          const plan = planOfflineUpload(scan)
          logger?.info?.('[soulmirror] 录音体检：' + Math.round(scan.durationSec) + ' 秒，静音占比 ' +
            Math.round(scan.silentRatio * 100) + '%，峰值 ' + scan.peakRms + ' → ' + plan.reason)
          if (plan.action === 'skip') {
            setPostMeeting({ phase: 'error', error: '跳过云端重转写：' + plan.reason, dir })
            return { ok: false, error: plan.reason }
          }
          offProgress.stage('upload', { detail: '准备上传（' + Math.round(scan.durationSec) + ' 秒有声 / 静音 ' + Math.round(scan.silentRatio * 100) + '%）', fraction: 0 })
        reportOffline()
        if (plan.action === 'trim') {
            const cut = join(dir, 'audio-offline.wav')
            const r2 = await extractRangeToWav({ src: wav, dst: cut, startSec: plan.startSec, endSec: plan.endSec })
            uploadWav = cut
            logger?.info?.('[soulmirror] 已裁出有声区间 ' + r2.seconds + ' 秒（' +
              Math.round(r2.bytes / 1048576) + 'MB），准备上传')
          }
        } catch (e) {
          logger?.warn?.('[soulmirror] 录音体检失败，按整段上传：' + e.message)
        }
        offProgress.stage('recognize', { detail: '云端识别中（已等 0 秒）', fraction: 0.05 })
        reportOffline()
        // 云端识别是主要耗时：每 2 秒推进一点百分比，并显示已等秒数（不假装快好了，封顶本阶段 90%）
        const recTimer = setInterval(() => {
          try {
            const snap = offProgress.snapshot()
            const frac = Math.min(0.9, 0.05 + snap.elapsedSec / 120)
            offProgress.detail('云端识别中（已等 ' + snap.elapsedSec + ' 秒）', frac)
            reportOffline()
          } catch { /* ignore */ }
        }, 2000)
        recTimer.unref?.()
        let r
        try {
          r = await transcribeFileWithSpeakers({
          apiKey: key,
          // 用 openAsBlob 从磁盘流式上传：readFileSync 会额外占一整份音频，再被 Blob 复制一次，
          // 长会议（几十分钟）峰值就是几百 MB，实测曾把 4GB 堆撑爆。
          // 优先传裁好的有声区间（省流量、也更容易识别成功）
          file: await openAsBlob(uploadWav, { type: 'audio/wav' }),
          fileName: 'meeting.wav',
          languageHints: ['zh', 'en'],
        })
        lines = (r.sentences || []).filter((x) => x.text)
      } catch (e) {
        // 云端失败就退回本地快速重放（至少不丢功能）
        const why = explainOfflineError(e.message)
        logger?.warn?.('[soulmirror] 云端文件识别失败（' + why + '），回退到本地重放：' + String(e.message).slice(0, 200))
        mode = 'replay'
        const { pcm } = readWavPcm(wav)
        const r2 = await transcribeOffline({ apiKey: key, model: resolveAsrModel(cfg.asr), pcm, sampleRate: 16000, speed: 4 })
        lines = (r2.sentences || []).filter((x) => x.text).map((x) => ({ ...x, speaker: '' }))
      }
      } finally {
        clearInterval(recTimer)
      }

      // 超时后被取消：不要再用迟到的结果覆盖磁盘
      if (typeof isCancelled === 'function' && isCancelled()) {
        logger?.warn?.('[soulmirror] 离线重转写已超时取消，丢弃本次结果（避免迟到写入）')
        return { ok: false, cancelled: true, error: '已取消（超时）' }
      }
      await writeFile(join(dir, 'transcript-offline.jsonl'), lines.map((x) => JSON.stringify(x)).join('\n') + (lines.length ? '\n' : ''), 'utf8').catch(() => {})
      // 纪要优先交给 DSH 后台任务（独立进程，不在会议会话里跑）
    const cleanLines = lines
      .filter((x) => x && x.text && !/知识库|会议纪要已写入/.test(String(x.text)))
      .map((x) => (x.speaker ? x.speaker + '：' : '') + x.text)
    let minutesTitle = ''
    try { minutesTitle = String(loadMeta(dir)?.title || basename(dir) || '') } catch { /* ignore */ }
    const bg = await minutesViaBackgroundTask(dir, cleanLines, minutesTitle)
    let md = ''
    if (bg.ok) {
      minutesSource = 'background'
      md = bg.markdown
    } else {
      lastMinutesFallbackReason = '后台任务未产出：' + (bg.error || '未知原因')
      md = await buildOfflineMinutes({
        sentences: cleanLines.map((text) => ({ text })),
        completer: async (msgs) => {
          try {
            const out = await (minutesCompleter || completer)(msgs)
            minutesSource = 'session'
            return out
          } catch (e) {
            // 不许静默退化：把原因记下来，界面与日志都要能看到
            const msg = '纪要模型调用失败：' + (e && e.message ? e.message : String(e))
            logger?.warn?.('[soulmirror] ' + msg)
            results.offline = (results.offline || '') + '；' + msg
            lastMinutesFallbackReason = msg
            throw e
          }
        },
        logger,
      })
    }
      let savedPath = ''
      if (md) {
        const saved = await persistMinutesFile(join(dir, 'minutes.md'), md)
        savedPath = saved.path
      }
      const elapsed = Math.round((Date.now() - t0) / 1000)
      logger?.info?.('[soulmirror] 离线转写完成：' + lines.length + ' 句，耗时 ' + elapsed + ' 秒')
      // 先算 speakers 再用：之前 setPostMeeting 引用了下一行才声明的 const，
      // 每次离线转写成功都以 ReferenceError 收尾 —— 表现就是"转完了但纪要/入库没做"。
      const speakers = new Set(lines.map((x) => x.speaker).filter(Boolean)).size
      setPostMeeting({ phase: 'minutes', sentences: lines.length, speakers })
      try { saveMeta(dir, { speakers, lines: lines.length, offlineAt: new Date().toISOString() }) } catch { /* ignore */ }
      return { ok: true, sentences: lines.length, speakers, mode, seconds: Math.round(seconds), elapsed, md, minutesPath: savedPath }
    } catch (e) {
      logger?.warn?.('[soulmirror] 离线转写失败：' + e.message)
      setPostMeeting({ phase: 'error', error: '离线转写失败：' + e.message })
      return { ok: false, error: e.message }
    } finally {
      offlineBusy = false
    }
  }

  /** 会后：纪要落盘 → 写知识库 → 沉淀人格 */
  // 按会议隔离的整理注册表（替代原来的全局 finalizing + lastFinalizedAt）
  const finalizeRegistry = createFinalizeRegistry({ debounceMs: 60000 })
  /**
   * 纪要的"同一份内容只生成一次"。
   *
   * 实测事故：一场会结束后 8 分钟里，buildMinutes 被调了 34 次，
   * 每次都把整段提示词投进会话，用户看到的就是"不断重复写纪要"。
   * 调用方一时没定位到，所以从结果侧堵：转写快照没变，就不该再生成。
   */
  let lastMinutesMd = ''
  let minutesRuns = 0
  let minutesKey = ''
  let minutesKeyRuns = 0
  /**
   * 停止采集并立即开始会后整理。
   *
   * 为什么需要它：以前只有两条路径会生成纪要 ——
   *   ① 界面点「结束录音」（/auto action=stop）
   *   ② 会议窗口关闭（lifecycle.onExit）
   * 而 meeting_capture_stop / meeting_agent_stop / meeting_leave 这些**工具**
   * 只停采集、不整理，于是就出现"停了但没纪要"。
   *
   * 现在所有停止路径都调用这里；finalizeMeeting 自身有 60 秒去抖 + 进行中互斥，
   * 所以重复调用是安全的（不会重复生成、不会重复写库）。
   *
   * @param {string} reason 记录原因：手动停止 / 离开会议 / 停止大脑 / 窗口关闭
   * @returns {Promise<{organized: boolean, reason: string, error?: string, dir?: string}>}
   */
  async function stopAndOrganize(reason = '手动停止', opts = {}) {
    const dir = session.dir || ''
    // 调用方可能在进入这里之前就已经停过采集（那会让 wasCapturing 为 false，
    // 整理被直接跳过——用户以为"停止即整理"，实际什么都没生成）。
    // 所以允许调用方显式声明"进来之前还在采集"，并且统一由本函数负责停采。
    const wasCapturing = opts.wasCapturing == null ? !!session.capturing : !!opts.wasCapturing
    let stopResult = null
    try { stopResult = await session.stopCapture() } catch { /* 已经停了也无所谓 */ }
    if (!wasCapturing || !dir) return { organized: false, reason, dir, chunks: (stopResult && stopResult.chunks) || 0 }
    setPostMeeting({ phase: 'stopping', dir, error: '' })
    logger?.info?.('[soulmirror] 停止采集（' + reason + '），开始会后整理')
    try {
      const r = await finalizeMeeting({ speak: false, writeKnowledge: true })
      setPostMeeting({ phase: 'done', minutesPath: (r && r.minutes) || postMeeting.minutesPath })
      return { organized: true, reason, dir, result: r }
    } catch (e) {
      setPostMeeting({ phase: 'error', error: e.message, dir })
      logger?.warn?.('[soulmirror] 会后整理失败：' + e.message)
      return { organized: false, reason, dir, error: e.message }
    }
  }

  async function finalizeMeeting({ speak = false, writeKnowledge = true } = {}) {
    // 按会议隔离：不同会议互不影响；同一会议同一份转写只做一次。
    // 原来用全局 finalizing + 60s 去抖，会把"紧接着结束的第二场会"误判成重复。
    const run = snapshotRun(session)
    const claim = finalizeRegistry.tryBegin(run.dir, run.revision)
    if (!claim.ok) {
      logger?.info?.('[soulmirror] 跳过整理：' + claim.reason + '（' + run.dir + '）')
      return { skipped: claim.reason }
    }
    const runDir = run.dir
    try {
    // 纪要**必须等非流式转写结果**（会后离线重转写）返回后再生成。
    // 原因：实时流式转写是"边说边猜"的中间结果——断句碎、同音字多、没有说话人；
    // 拿它写纪要等于用草稿写总结。所以这里先不生成，等下面 offline 段落拿到
    // transcript-offline.jsonl 之后再写（那才是完整、带说话人的一份）。
    let md = ''
    let minutesFromOffline = false
    const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ')
    const title = (cfg.knowledge.titlePrefix || '会议纪要') + ' · ' + stamp
    const results = { minutes: '', knowledge: '', persona: '', minutesSource: '' }

    // 1) 落盘推迟到 offline 之后（见后面的「2.5) 纪要」）

    // 记录会议结束信息（回看要用）
    try {
      const startedMs = Date.parse(loadMeta(runDir)?.startedAt || '') || Date.now()
      // 采集信息写进 meta：以后"这段录音为什么是空的"能直接查，不用猜
      let captureInfo = null
      try {
        // 时长优先取录音本身（音频秒数），拿不到再看会话起始时间；
      // 原来只靠 startedMs，解析失败就退成 now → 时长 0 → 静音占比被算成 100%（误报"整段静音"）
      let durSec = 0
      try {
        const wav = join(runDir, 'audio.wav')
        if (existsSync(wav)) {
          const st = statSync(wav)
          durSec = Math.max(0, Math.round((st.size - 44) / 32000))   // 16k/16bit/单声道
        }
      } catch { /* ignore */ }
      if (!durSec) durSec = Math.max(0, Math.round((Date.now() - startedMs) / 1000))
        const verdict = captureVerdict({
          bytes: session.bytes || 0,
          silentSec: session.silentSec || 0,
          durationSec: durSec,
        })
        captureInfo = {
          device: session.deviceLabel || cfg.devices.capture || '(系统默认)',
          captureAuto: cfg.devices.captureAuto !== false,
          bytes: session.bytes || 0,
          silentSec: session.silentSec || 0,
          durationSec: durSec,
          silentRatio: verdict.silentRatio,
          verdict: verdict.verdict || '',
          diagnosis: session.captureDiagnosis || null,
        }
        if (verdict.verdict) logger?.warn?.('[soulmirror] 采集判定：' + verdict.verdict)
      } catch { /* ignore */ }

      saveMeta(runDir, {
        endedAt: new Date().toISOString(),
        durationMin: Math.max(1, Math.round((Date.now() - startedMs) / 60000)),
        ...(captureInfo ? { capture: captureInfo } : {}),
      })
    } catch { /* ignore */ }

    // 1.5) 会后离线重转写：用整场录音补全实时那条线可能漏掉的句子
    try {
      // 总超时：离线重转写涉及"整份上传 + 云端排队 + 下载结果"，
      // 网络或服务端变慢时可能拖很久。卡住必须自己认输，
      // 否则用户看到的是"转文字一直不动"，最后什么都没落盘。
      const offlineTimeoutMs = Math.max(60000, Number(cfg.offlineTimeoutMs) || 10 * 60 * 1000)
      // 遵循"节约资源"：会后重转写是唯一的重活（整份上传 + 云端排队），
      // 交给**独立的 dsh 子进程**跑，主进程只等结果。子进程挂了也不影响宿主。
      // 超时后置位：底层若还在跑，写盘前会看到它并丢弃迟到结果
      let offlineCancelled = false
      const off = await withTimeout(
        // 默认走内联：子进程那条路要在另一个 dsh 里调到本插件工具，未经验证且容易卡到超时。
        // 需要隔离时再显式打开 offlineViaChild。
        cfg.offlineViaChild === true
          ? runOfflineInBackground(runDir)
          : runOfflinePass(runDir, { isCancelled: () => offlineCancelled }),
        offlineTimeoutMs,
        '离线重转写超时（' + Math.round(offlineTimeoutMs / 60000) + ' 分钟）',
          { onTimeout: () => { offlineCancelled = true } },
      )
      if (off.ok) {
        results.offline = '会后重转写：' + off.sentences + ' 句' +
          (off.speakers ? '（' + off.speakers + ' 位说话人）' : '') +
          '，' + off.seconds + ' 秒音频，用时 ' + off.elapsed + ' 秒' +
          (off.mode === 'replay' ? '（云端不可用，本地重放）' : '')
        if (off.minutesPath) results.minutes = off.minutesPath
        // 会后重转写的纪要比实时版更完整（含说话人），优先把它写进知识库
        if (off.md) {
          md = off.md
          minutesFromOffline = true
          results.minutesSource = minutesSource || 'background'
        }
        if (!minutesSource) results.minutesSource = off.md ? 'background' : ''
      } else if (off.error) {
        results.offline = '跳过：' + off.error
      }
    } catch (e) {
      // 不能静默：否则界面会永远停在"云端识别中 79%"，而实际早已进入下一步
      const why = '离线重转写异常：' + (e && e.message ? e.message : String(e))
      lastMinutesFallbackReason = lastMinutesFallbackReason || why
      logger?.warn?.('[soulmirror] ' + why)
      setPostMeeting({ phase: 'minutes', error: '', dir: runDir, progressText: why.slice(0, 80) })
    }


    // 2) 纪要：到这里"非流式转写"已经跑完（成功用它的结果，失败才回退实时转写）
    if (!md) {
      const liveLines = (session.transcript || [])
        .filter((x) => x && x.text && x.role !== 'assistant' && x.src !== 'gap')
        .map((x) => (x.speaker ? x.speaker + "：" : "") + x.text)
      if (liveLines.length) {
        logger?.warn?.("[soulmirror] 没有非流式转写结果，退回用实时转写生成纪要（质量会差一些）")
        const bgLive = await minutesViaBackgroundTask(runDir, liveLines, title)
        if (bgLive.ok) {
          md = bgLive.markdown
          results.minutesSource = 'background:live'
        } else {
          try {
            md = await buildMinutes()
            results.minutesSource = 'session:live'
          } catch (e) { logger?.warn?.('[soulmirror] 实时转写生成纪要失败：' + e.message) }
        }
      }
    }
    if (md) {
      results.minutesSource = results.minutesSource || (minutesFromOffline ? "background" : "unknown")
      try {
        if (runDir) {
          const r = await persistMinutesFile(join(runDir, 'minutes.md'), md)
          results.minutes = r.path
          // 收尾：否则界面停在最后一个阶段，用户以为还在跑
          setPostMeeting({
            phase: 'done',
            minutesPath: r.path,
            progressText: '整理完成 · 来源 ' + (results.minutesSource || 'unknown'),
            stage: 'done',
            stageLabel: '整理完成',
            percent: 100,
            detail: '',
          })
          if (r.reason) logger?.info?.('[soulmirror] ' + r.reason)
        }
        const ws = ensureMeetingWorkspace()
        if (ws.dir) await persistMinutesFile(join(ws.dir, 'minutes.md'), md)
      } catch { /* ignore */ }
    }

    // 2) 写知识库：交给装了 dsh-knowledge 的 profile 去落库
    if (writeKnowledge && cfg.knowledge.enabled && md && cfg.twin.enabled && gate('knowledge').allowed) {
      const kd = detectKnowledge(cfg.knowledge.profile || '')
      const mode = String(cfg.knowledge.mode || 'host')
      if (!writeKnowledge) {
        results.knowledge = '已跳过（会议功能未开启，只落本地纪要）'
      } else if (mode === 'off') {
        results.knowledge = '已关闭（knowledge.mode = off）'
      } else if (!kd.installed && !kd.host) {
        results.knowledge = '跳过（未安装 dsh-knowledge）'
      } else if (mode === 'host') {
        // 直连宿主里知识库插件的本地管理 API：不需要额外安装、不需要模型
        const port = resolveHostPort()
        if (kd.host && port) {
          const origin = 'http://127.0.0.1:' + port
          const r = await writeViaHostApi({ port, origin, title, markdown: md, type: 'decision', group: '会议纪要' })
          if (r.ok && r.committed !== false) {
            results.knowledge = '已写入知识库（' + (r.id || 'ok').toString().slice(0, 8) + '）'
            addAssistantLine('会议纪要已写入知识库：' + title, '知识库')
          } else {
            // 不谎报：本地已存 / 已入队 / 未确认 要分开说
            const parts = []
            if (r.localSaved) parts.push('纪要已存本地')
            if (r.archiveQueued) parts.push('归档已入队')
            results.knowledge = '未确认写入：' + (r.error || r.status || '') +
              (parts.length ? '（' + parts.join('，') + '）' : '') +
              (r.note ? '；' + r.note : '')
            logger?.warn?.('[soulmirror] 知识库未确认写入：' + JSON.stringify(r).slice(0, 200))
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
        // 规则（用户定）：没有说话人标注的转写，不许提取人格。
        // 否则转写里混着所有人的话，会把别人的观点记成她的立场。
        // 择优：会后重转写带说话人分离，质量优于实时转写
        let offlineLines = []
        try {
          const offPath = join(runDir, 'transcript-offline.jsonl')
          if (existsSync(offPath)) offlineLines = readLogText(readFileSync(offPath, 'utf8')).lines
        } catch { /* 没有就算了 */ }
        const src = choosePersonaSource({ offline: offlineLines, live: session.transcript || [] })
        if (!src.lines.length) {
          const blocked = whyNoPersona(session.transcript || [])
          results.persona = '跳过：' + blocked + ' → ' + enableHint()
          logger?.info?.('[soulmirror] 人格提取跳过：' + blocked)
          throw new Error('__PERSONA_SKIPPED__')
        }
        const spoken = renderSpeakerTranscript(src.lines, { maxChars: 3000 })
        if (src.source === 'offline') logger?.info?.('[soulmirror] 人格提取用会后重转写产物（' + src.speakers.length + ' 位说话人）')

        // 结构化提取：不只记"事实"，还要记"她怎么说话、站哪边、怎么判断"
        const existing = loadProfile(personaDir)
        const knownText = existing ? renderProfile(existing, { maxChars: 1500 }) : ''
        const out = await completer([
          {
            role: 'system',
            content: [
              '你在帮一个会议助理"长成用户本人"。从这场会议里抽取**关于用户本人**的信息，只输出 JSON。',
              '',
              '五个分区（section 取值只能用它）：',
              '- identity：长期不变的身份（职位、团队、负责的项目、汇报关系）',
              '- style：她怎么说话（语气、句长、常用词/口头禅、忌讳的说法）',
              '- stance：她的立场与偏好（优先级、判断标准、红线、明确反对什么）',
              '- facts：关于她的稳定事实（习惯、工具、协作对象）',
              '- state：当前阶段的项目进展/下一步（会过期）',
              '',
              '输出格式：{"items":[{"section":"stance","key":"上线节奏","value":"先小范围验证再全量","confidence":0.8}]}',
              '规则：',
              '1. key 用 2~8 个字概括主题（同一主题以后会用来判重/取代，请保持稳定）',
              '2. value 一句话、不超过 40 字、必须是她本人的事（不是会议内容摘要）',
              '3. confidence 0~1：她明确表达/反复强调给高分，推断给低分',
              '4. 只写会议里**能证实**的；不确定就不写，宁缺勿编',
              '5. 已经有的事实不要重复列举；若有变化，用同一个 key 写新值',
            ].join('\n'),
          },
          ...(knownText ? [{ role: 'user', content: '已知画像（避免重复）：\n' + knownText }] : []),
          { role: 'user', content: '本场会议转写（带说话人）：\n' + spoken.text },
        ])
        const jsonText = String(out).replace(/^```(?:json)?|```$/gm, '').trim()
        const parsed = JSON.parse(jsonText)
        const items = Array.isArray(parsed) ? parsed : (parsed.items || [])
        const merged = mergeProfile(existing || emptyProfile(), items)
        saveProfile(personaDir, merged.profile)

        // 四层记忆：先把本场会写进「暖态」与「流水」，再整理出「冷储」与「归档」
        // 流水 = 原始（不筛选）；暖态 = 候选（会遗忘）；冷储 = 跨会议稳定（注入）
        const memDir = join(personaDir, 'memory')
        try {
          appendJournal({
            dir: memDir,
            at: Date.now(),
            title: (session.display || '会议'),
            lines: (session.transcript || []).slice(-40)
              .filter((x) => x && x.text && x.role !== 'assistant' && x.src !== 'gap')
              .map((x) => x.text),
          })
          for (const it of items) {
            appendWarm({
              dir: memDir,
              text: it && it.value,
              kind: it && it.section === 'stance' ? 'rule' : 'fact',
              confidence: it && it.confidence,
              at: Date.now(),
            })
          }
          const cons = consolidate({ dir: memDir, now: Date.now() })
          const conv = convergence({ profile: merged.profile, dir: memDir })
          const layers = layersStatus(memDir)
          results.memory = '暖态 ' + layers.warm + ' / 冷储 ' + layers.cold +
            ' / 流水 ' + layers.journalDays + ' 天（本次晋升 ' + cons.promoted.length +
            '、归档 ' + cons.archived + '）'
          results.convergence = conv.score + '（' + conv.label + '）'

          // 人格画像 → 独立知识库（同一篇反复更新，不混进会议纪要）
          if (cfg.knowledge.personaSync !== true) results.personaKb = '未开启自动同步（可手动编辑知识库，或置 knowledge.personaSync=true）'
          // 可选功能：默认**不**自动写知识库。
          // 理由：那篇文档用户会自己编辑；自动覆盖会把手改的内容冲掉。
          // 需要自动同步时显式打开 knowledge.personaSync = true。
          if (cfg.knowledge.personaSync === true) {
            try {
              const port = resolveHostPort()
              if (!port) {
                results.personaKb = '跳过（拿不到宿主端口）'
              } else {
                const md2 = renderPersonaDoc({
                  profile: merged.profile,
                  layers,
                  convergence: conv,
                  rules: readRules({ dir: join(personaDir, 'ontology'), maxTopics: 8, maxPerTopic: 4 }),
                  at: Date.now(),
                })
                const kb = await syncPersonaDoc({
                  origin: 'http://127.0.0.1:' + port,
                  name: cfg.knowledge.personaBaseName || undefined,
                  markdown: md2,
                  profile: merged.profile,
                  convergence: conv,
                  // 画像太薄就不写：知识库里那篇是对外可见的印象，
                  // 只有两三条零散信息就发出去，会让人以为它认错人了。
                  minItems: Number(cfg.knowledge.personaMinItems) || 5,
                  minScore: Number(cfg.knowledge.personaMinScore) || 0.2,
                })
                results.personaKb = kb.ok
                  ? (kb.action === 'created' ? '已建库并写入：' + kb.kbName : '已更新：' + kb.kbName)
                  : (kb.skipped
                    ? '暂不写入（' + kb.reason + '）'
                    : '失败（' + (kb.stage || '?') + '）：' + kb.error)
                if (!kb.ok) logger?.warn?.('[soulmirror] 画像写库失败：' + (kb.stage || '?') + ' ' + kb.error)
              }
            } catch (e) {
              results.personaKb = '异常：' + e.message
            }
          }
        } catch (e) {
          logger?.warn?.('[soulmirror] 记忆层写入失败：' + e.message)
        }

        // 三分法：技术知识 / 项目记忆 / 经验规则分开存
        // 混在一起的后果是"三个月前的进展被当成当前状态"、"随口一句被当成规则"
        const routed = { knowledge: 0, memory: 0, rule: 0 }
        for (const it of items) {
          try {
            const r = routeItem({ dir: join(personaDir, 'ontology'), item: it })
            if (r && r.kind) routed[r.kind] = (routed[r.kind] || 0) + 1
          } catch { /* 单条失败不影响整体 */ }
        }
        results.ontology = '知识 ' + (routed.knowledge || 0) + ' 条 / 记忆 ' + (routed.memory || 0) +
          ' 条 / 规则 ' + (routed.rule || 0) + ' 条'
        // 人类可读的 markdown 也同步追加一份（便于直接翻看）
        const bySection = (s) => items.filter((x) => x && x.section === s).map((x) => x.value)
        const r1 = appendPersonaSection(personaDir, 'user', [...bySection('identity'), ...bySection('facts')], { stamp })
        const r2 = appendPersonaSection(personaDir, 'state', bySection('state'), { stamp })
        results.personaDetail = '画像：新增 ' + merged.stats.added + ' 条、强化 ' + merged.stats.reinforced +
          ' 条、取代 ' + merged.stats.superseded + ' 条、过期 ' + merged.stats.expired +
          ' 条（markdown 追加 ' + (r1.added + r2.added) + ' 条）'
        personaAt = 0
        results.persona = items.length + ' 条'
      } catch { /* ignore */ }
    }

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
      finalizeRegistry.end(claim.token)
    }
  }

  // 注意：不能叫 saveMinutes —— 会遮蔽导入的同名文件写入函数，
  // 导致 saveMinutes(path, md) 变成递归调用自己（纪要保持不落盘、会后整理卡死）。
  async function saveCurrentMinutes() {
    const md = await buildMinutes()
    if (!md || !session.dir) return ''
    try {
      const r = await persistMinutesFile(join(session.dir, 'minutes.md'), md)
      if (r.reason) logger?.info?.('[soulmirror] ' + r.reason)
      return r.path
    } catch { return '' }
  }

  const lifecycle = new MeetingLifecycle(
    { apps: activeApps() },
    {
      listWindows,
      meters: metersMax,
      micHeldByApp: async () => {
        const app = await detectMeetingApp().catch(() => null)
        return await micHeldByApp(app)
      },
      logger,
      onEnter: async ({ reason }) => {
        // 只有一个总开关：没开就什么都不做（连听都不听，省 token）
        if (!cfg.enabled) {
          logger?.info?.('[soulmirror] 检测到会议（' + reason + '），但插件未开启，不做任何事')
          return
        }
        if (!session.capturing) await session.startCapture('auto').catch((e) => logger?.warn?.('[soulmirror] 自动采集失败: ' + e.message))
        agent.running = true
        budget.reset()
        // 只转录模式不建会话：会消耗模型、也会刷会话列表
        if (cfg.reply.enabled) ensureMeetingSession(reason).catch(() => {})
        logger?.info?.('[soulmirror] 已开启：开始采集转写并建会话（' + reason + '）')
      },
      onExit: async () => {
        // 不能只看 session.capturing：采集进程可能还在跑、标志却已为 false
        // （重连间隙、异常退出后残留）。所以这里一律先真停采集。
        const wasCapturing = !!session.capturing
        const wasRunning = !!session.running
        agent.running = false
        if (!wasCapturing && !wasRunning) return
        try { await session.stopCapture() } catch { /* 已停也无所谓 */ }
        try {
          // 纪要写本地；知识库回写与发言属于"对外动作"，未开启时不做
          const o = await stopAndOrganize('离开会议', { wasCapturing })
          logger?.info?.('[soulmirror] 会议结束：' + JSON.stringify(o.result || o).slice(0, 200))
        } catch (e) {
          logger?.warn?.('[soulmirror] 会议收尾失败: ' + e.message)
        }
      },
    },
  )

// ── 会议结束自愈：检测不到会议窗口就停采集并整理 ─────────────
// 为什么需要：生命周期依赖窗口形态，客户端崩溃/最小化到托盘/直接结束会议时
// 可能判不出来，于是采集一直跑、"转录停不下来"。这条是兜底，代价很低。
let noMeetingTicks = 0
const meetingWatchdog = setInterval(async () => {
  try {
    // 采集在跑但迟迟没有转写：自动体检一次，把原因写进状态与日志
    // （别人的机器上"没内容"多半是平台/桥接/端点/Key 的问题，不能让人靠猜）
    if (session.capturing) {
      const lastLine = session.transcript && session.transcript.length
        ? Date.parse((session.transcript[session.transcript.length - 1] || {}).t || "") || 0
        : 0
      const idleSec = lastLine ? Math.round((Date.now() - lastLine) / 1000) : Math.round((Date.now() - (session.capturingSince || Date.now())) / 1000)
      if (idleSec >= 90 && !lastPreflight) {
        try {
          const env = await collectPreflightEnv({ probeNet: true })
          lastPreflight = buildPreflight(env)
          if (!lastPreflight.ok) {
            logger?.warn?.("[soulmirror] 采集了 " + idleSec + " 秒仍无转写 → " + lastPreflight.verdict)
            session.lastError = lastPreflight.verdict
          } else {
            logger?.info?.("[soulmirror] 采集 " + idleSec + " 秒无转写，但体检全绿：可能只是没人说话")
          }
        } catch { /* 体检失败不影响采集 */ }
      }
    }
    if (!session.capturing && !session.running) { noMeetingTicks = 0; return }
    const wins = await listWindows()
    const apps = activeApps()
    const procs = new Set(apps.map((a) => String(a.proc || "").toLowerCase()).filter(Boolean))
    const frag = String(cfg.windowTitle || "腾讯会议")
    const alive = (wins || []).some((w) => {
      const proc = String(w.proc || "").toLowerCase()
      if (procs.size && !procs.has(proc)) return false
      return String(w.title || "").includes(frag) || /FloatSpeakingWnd|VideoMainWindow|MeetingView/.test(String(w.cls || ""))
    })
    if (alive) { noMeetingTicks = 0; return }
    noMeetingTicks += 1
    if (noMeetingTicks >= 2) {
      noMeetingTicks = 0
      logger?.info?.("[soulmirror] 连续 " + 2 + " 次没检测到会议窗口，自动停止采集并整理")
      setPostMeeting({ phase: "stopping", error: "", dir: session.dir || "", progressText: "会议已结束，正在收尾" })
      await stopAndOrganize("会议已结束（窗口消失）", { wasCapturing: true })
    }
  } catch { /* 检测失败不算结束 */ }
}, 15000)
meetingWatchdog.unref?.()
ctx.effect?.(() => () => clearInterval(meetingWatchdog), "soulmirror: meeting watchdog")

  // 恢复上次的开关状态：上次开着就继续开，上次关着就保持待命
  if (cfg.enabled === true) armed = true
  // 桌面宠物是可选项：上次开着就自动恢复
  // 桌面宠物是可选项：开着就在启动时注册菜单并推一次状态
  // 先做一次可选插件体检：没装的能力不启动（用户要求）
  try {
    refreshOptionalDeps()
    const gatePet = gate('pet')
    const gateKb = gate('knowledge')
    if (!gatePet.allowed) logger?.info?.('[soulmirror] ' + gatePet.message)
    if (!gateKb.allowed) logger?.info?.('[soulmirror] ' + gateKb.message)
  } catch { /* ignore */ }

  if (cfg.pet.enabled !== false) {
    ensurePetMenu().catch((e) => logger?.warn?.('[soulmirror] 桌宠联动失败: ' + e.message))
  }
  // 只在总开关打开时才轮询窗口，关闭时完全不碰桌面
  if (cfg.enabled && cfg.autoWatch && process.env.SOULMIRROR_TEST !== '1') lifecycle.start()

  // 启动时做一次环境自检（只打日志，不阻塞）
  if (process.env.SOULMIRROR_TEST !== '1') {
    try {
      const env = detectEnv()
      if (!env.ready) logger?.warn?.('[soulmirror] 环境待补：' + env.missing.join('、') + ' → 运行 soul_setup')
      else logger?.info?.('[soulmirror] 环境自检：就绪（' + env.platform + '）')
    } catch { /* ignore */ }
  }
  // 预算守护：超限就停采集并明确告知（不偷偷继续花钱）
  // 每拍记录内存水位，便于事后判断"什么时候开始涨"
  let memPeakMb = 0
  let memHistory = []
  function memSnapshot() {
    try {
      const m = process.memoryUsage()
      const heapMb = Math.round(m.heapUsed / 1048576)
      if (heapMb > memPeakMb) memPeakMb = heapMb
      memHistory.push(heapMb)
      if (memHistory.length > 40) memHistory = memHistory.slice(-40)
      return { heapMb, rssMb: Math.round(m.rss / 1048576), externalMb: Math.round(m.external / 1048576) }
    } catch { return { heapMb: 0, rssMb: 0, externalMb: 0 } }
  }

  const budgetGuard = setInterval(() => {
    const mem = memSnapshot()
    // 内存接近上限：优雅停止，而不是让 V8 抛 FATAL ERROR 把宿主带走
    const heapLimitMb = Math.round(v8.getHeapStatistics().heap_size_limit / 1048576)
    const memLimitMb = Number(cfg.memLimitMb) || Math.round(heapLimitMb * 0.8)
    if (session.capturing && mem.heapMb >= memLimitMb) {
      logger?.warn?.('[soulmirror] 内存接近上限（' + mem.heapMb + 'MB / 阈值 ' + memLimitMb + 'MB），停止采集以保护宿主')
      session.lastError = '内存接近上限（' + mem.heapMb + 'MB），已停止采集以保护 DSH 主进程。录音与转写都已落盘，重启后可继续整理。'
      session.stopCapture?.().catch?.(() => {})
      return
    }
    if (!session.capturing) return
    if (budget.overBudget()) {
      logger?.warn?.('[soulmirror] 已达识别预算 ' + budget.limitMinutes + ' 分钟，自动停止采集')
      session.lastError = '已超出本次会议的识别预算（' + budget.limitMinutes + ' 分钟），已停止。可在设置里调整。'
      session.stopCapture?.().catch?.(() => {})
    }
  }, 30000)
  budgetGuard.unref?.()
  ctx.effect(() => () => clearInterval(budgetGuard))

  // 启动后延迟扫描"未整理完的会议"：只 stat 不读内容，且不阻塞任何请求
  const recoveryBoot = setTimeout(() => {
    listPendingRecovery({ force: true })
      .then((l) => { if (l.length) logger?.info?.('[soulmirror] 发现 ' + l.length + ' 场未整理的会议，可在面板补出纪要') })
      .catch(() => {})
  }, 8000)
  recoveryBoot.unref?.()
  ctx.effect(() => () => clearTimeout(recoveryBoot))

  // 混沌注入：SOULMIRROR_FAULT=kill-capture 时，开会 5 秒后杀掉采集进程，
  // 用于验证"采集死了能自己恢复、且不抖动"这条不变量
  const fault = String(process.env.SOULMIRROR_FAULT || '')
  if (fault.includes('kill-capture')) {
    const t0 = setInterval(() => {
      if (session.capturing && session.child) {
        logger?.warn?.('[soulmirror] 混沌注入：杀掉采集进程')
        try { session.child.kill() } catch { /* ignore */ }
        clearInterval(t0)
      }
    }, 5000)
    t0.unref?.()
    ctx.effect(() => () => clearInterval(t0))
  }

  // 状态接口的探测结果缓存（见 GET /status）
  const probeCache = { at: 0, value: null, slow: false }

  // ── 识别预算：开会一小时也在花钱，得有个上限 ────────────────────────
  const budget = {
    startedAt: 0,
    limitMinutes: Number(cfg.asr.hourlyBudgetMinutes) || 0,
    reset() { this.startedAt = Date.now() },
    minutes() { return this.startedAt ? (Date.now() - this.startedAt) / 60000 : 0 },
    overBudget() { return this.limitMinutes > 0 && this.minutes() > this.limitMinutes },
    snapshot() {
      return {
        limitMinutes: this.limitMinutes,
        usedMinutes: Math.round(this.minutes() * 10) / 10,
        over: this.overBudget(),
      }
    },
  }

  // ── 演练模式（不需要会议软件、不需要网络） ────────────────────────────
  const demo = new DemoController({
    root: join(CONFIG_DIR, 'demo'),
    makeTranscriber: async ({ onEvent }) => {
      const key = resolveApiKey({ apiKeyEnv: 'DASHSCOPE_API_KEY' }).key
      if (!key) throw new Error('没有 DASHSCOPE_API_KEY')
      const asr = startDashScopeAsr({
        apiKey: key,
        model: cfg.asr.dashscopeModel || 'paraformer-realtime-v2',
        sampleRate: 16000,
        asr: cfg.asr,
        onSentence: (s) => onEvent({ text: s.text, sentenceEnd: s.sentenceEnd }),
        onError: (e) => onEvent({ error: e.message }),
      })
      return {
        start: () => asr.open(),
        feed: (pcm) => asr.send(pcm),
        stop: () => asr.finish(),
      }
    },
    logger,
    // 与真实会议共用同一套钩子：演练也要能验到建议、候选词、桌宠状态
    onLine: (item) => {
      // 演练的句子也要进 session.transcript：建议与纪要读的是它，
      // 否则演练只能验转写，验不到"建议/纪要"这两段。
      try {
        if (session && Array.isArray(session.transcript) && !session.transcript.some((x) => x.t === item.t && x.text === item.text)) {
          session.transcript.push(item)
        }
      } catch { /* ignore */ }
      try { tickAdvice() } catch { /* ignore */ }
      try { maybeReply(item).catch((e) => noteLlmError('候选词', e)) } catch { /* ignore */ }
      try { pushWorkStatus().catch(() => {}) } catch { /* ignore */ }
    },
  })

  // ── 演练：不需要任何会议软件就能验证整条链路 ──────────────────────────
  ctx.tools.register(defineTool({
    name: 'meeting_demo',
    description: '演练模式：用内置样例音频和模拟会议信号跑一遍「检测→转写→条目→归档」，不连接真实会议、不需要会议软件、默认不联网。用于自检、演示和排障。',
    parameters: {
      action: { type: 'string', description: 'start | stop | status，默认 start' },
      speed: { type: 'number', description: '播放倍速，默认 1；调试可用 4–8' },
      real: { type: 'boolean', description: '是否用真实云端识别（需要 key）；默认 false 用离线模拟' },
    },
    output: OUT(),
    execute: wrap('meeting_demo', async (a) => {
      const action = String(a.action || 'start')
      if (action === 'stop') {
        await demo.stop()
        return { ok: true, result: '演练已停止，共 ' + demo.transcript.length + ' 句' }
      }
      if (action === 'status') {
        const s = demo.snapshot()
        return {
          ok: true,
          result: s.running ? '演练进行中：' + s.lines + ' 句' : (s.finished ? '演练已结束：' + s.lines + ' 句（目录 ' + s.dir + '）' : '当前没有演练'),
          data: s,
        }
      }
      const s = await demo.start({ speed: a.speed, real: a.real })
      if (s.error) return { ok: false, result: s.error, data: s }
      return {
        ok: true,
        result: '演练已开始（' + s.audioSeconds + ' 秒样例，' + (s.real ? '真实识别' : '离线模拟') + '）。面板会显示「演练中」，不会连接真实会议，也不会发言。',
        data: s,
      }
    }),
  }))

  // ── 实时纪要 ────────────────────────────────────────────────────────
  ctx.tools.register(defineTool({
    name: 'meeting_offline_pass',
    description: '对某场会议的录音做会后再转写（云端文件识别 + 说话人分离），并把纪要写到会议目录。会后整理交给后台 agent 调用本工具，可以避免占用主进程内存。参数 dir 是会议目录。',
    parameters: {
      dir: { type: 'string', description: '会议目录（含 audio.wav）' },
      minutes: { type: 'boolean', description: '是否同时生成纪要，默认 true' },
    },
    output: OUT(),
    execute: wrap('meeting_offline_pass', async (a) => {
      const dir = String(a.dir || session.dir || '').trim()
      if (!dir) return { ok: false, result: '没有会议目录' }
      if (!cfg.enabled) return { ok: false, result: '会议功能未开启' }
      const r = await runOfflinePass(dir)
      if (!r.ok) return { ok: false, result: r.error || '会后重转写失败' }
      return {
        ok: true,
        result: '会后重转写完成：' + r.sentences + ' 句' +
          (r.speakers ? '（' + r.speakers + ' 位说话人）' : '') +
          '，' + r.seconds + ' 秒音频，用时 ' + r.elapsed + ' 秒',
        minutesPath: r.minutesPath || '',
        sentences: r.sentences,
        speakers: r.speakers,
      }
    }),
  }))

  ctx.tools.register(defineTool({
    name: 'meeting_minutes',
    description: '生成会议纪要：有 LLM 时输出"决议/待办/风险/未决"，没有则做抽取式摘要。可随时调用，取最近 N 句。',
    parameters: {
      limit: { type: 'integer', description: '取最近多少句，默认 80。' },
      save: { type: 'boolean', description: '是否写到会话目录 minutes.md。' },
    },
    output: OUT(),
    execute: wrap('meeting_minutes', async (a) => {
      const lines = speechLines(a.limit || 80)
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
          // 工具产出的是"最近 N 句的摘要"，绝不能覆盖完整纪要，
          // 所以写到独立的 minutes-live.md
          await persistMinutesFile(join(session.dir, 'minutes-live.md'), out, { keepHistory: false })
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
      action: { type: 'string', enum: ['get', 'set', 'backfill'], required: true, description: 'get 查看全部 / set 写入某一份 / backfill 用历史会议账本补出画像（只读账本，不重转写）' },
      limit: { type: 'integer', description: 'backfill 时最多回填几场会，默认 5' },
      confirm: { type: 'boolean', description: 'backfill 必须传 true（会调用模型）' },
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
      if (a.action === 'backfill') {
        // 可选功能：必须显式确认。回填会调 N 次模型，不该被顺手触发
        if (a.confirm !== true) {
          return {
            ok: false,
            result: '回填会调用模型（每场约 1 次），请确认后重试：soul_persona { action:"backfill", confirm:true, limit:5 }\n' +
              '注意：只处理**带说话人标注**的会议；没有标注的一律跳过。',
          }
        }
        // 用历史账本补画像：只读 transcript.jsonl，不碰音频、不重转写
        const limit = Math.max(1, Math.min(20, Number(a.limit) || 5))
        if (!completer) return { ok: false, result: '没有可用的模型会话，无法回填' }
        try {
          const root = CONFIG_DIR
          let dirs = []
          try {
            dirs = readdirSync(root)
              .filter((d) => d !== 'persona' && d !== 'workspace')
              .map((d) => join(root, d))
              .filter((d) => existsSync(join(d, 'transcript.jsonl')))
          } catch { dirs = [] }

          const picked = pickBackfillMeetings({
            dirs,
            stat: (d) => { try { const s = statSync(join(d, 'transcript.jsonl')); return { mtimeMs: s.mtimeMs, size: s.size } } catch { return null } },
            options: { limit },
          })
          if (!picked.picked.length) {
            return { ok: false, result: '没有可回填的会议（账本太小或太旧）' + (picked.skipped.length ? '；跳过 ' + picked.skipped.length + ' 场' : '') }
          }

          const stats = { meetings: 0, added: 0, reinforced: 0, superseded: 0, failed: 0 }
          let profile = loadProfile(personaDir) || emptyProfile()
          const details = []

          for (const it of picked.picked) {
            try {
              const raw = await readFile(join(it.dir, 'transcript.jsonl'), 'utf8')
              const replay = readLogText(raw)
              const texts = replay.lines
                .filter((x) => x && x.text && x.role !== 'assistant' && x.src !== 'gap')
                .map((x) => (x.speaker ? x.speaker + '：' : '') + x.text)
              // 没标注就不提取（用户定的规则）；这里用原始行判断，而不是拼好的文本
              const why = whyNoPersona(replay.lines)
              if (why) { details.push('跳过 ' + basename(it.dir) + '（' + why + '）'); continue }
              if (texts.length < 4) { details.push('跳过 ' + basename(it.dir) + '（句子太少）'); continue }

              const slim = slimMeetingText(texts)
              const known = renderProfile(profile, { maxChars: 1200 })
              const out = await completer(buildBackfillPrompt({
                meetingText: slim.text,
                knownText: known,
                title: basename(it.dir),
              }))
              const jsonText = String(out).replace(/^```(?:json)?|```$/gm, '').trim()
              const parsed = JSON.parse(jsonText)
              const items = Array.isArray(parsed) ? parsed : (parsed.items || [])
              const merged = mergeProfile(profile, items)
              profile = merged.profile
              saveProfile(personaDir, profile)

              // 同步进四层记忆（暖态），下次整理时晋升冷储
              const memDir = join(personaDir, 'memory')
              for (const x of items) {
                try {
                  appendWarm({ dir: memDir, text: x && x.value, kind: x && x.section === 'stance' ? 'rule' : 'fact', confidence: x && x.confidence, at: Date.now() })
                } catch { /* ignore */ }
              }
              consolidate({ dir: memDir, now: Date.now() })

              stats.meetings += 1
              stats.added += merged.stats.added
              stats.reinforced += merged.stats.reinforced
              stats.superseded += merged.stats.superseded
              details.push(basename(it.dir) + '：' + items.length + ' 条')
            } catch (e) {
              stats.failed += 1
              details.push('失败 ' + basename(it.dir) + '：' + e.message)
            }
          }

          const conv = convergence({ profile, dir: join(personaDir, 'memory') })
          stats.convergence = conv
          personaAt = 0
          return {
            ok: stats.meetings > 0,
            result: summarizeBackfill(stats) + '\n\n' + details.join('\n'),
            convergence: conv,
          }
        } catch (e) {
          return { ok: false, result: '回填失败：' + e.message }
        }
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
      action: { type: 'string', enum: ['check', 'report', 'build', 'auto', 'deps', 'install-deps', 'links', 'audio'], required: true, description: 'check 看环境 / report 安装体检清单（缺什么、怎么补） / build 编译 mbridge / auto 自动处理 / deps 看虚拟声卡 / install-deps 尝试安装虚拟声卡 / audio 音频路由诊断' },
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
      if (a.action === 'audio') {
        let defaultDevice = ''
        try { defaultDevice = await defaultRenderDevice() } catch { /* ignore */ }
        let meters = []
        try { meters = parseMeters(await bridge(['meters'], { timeoutMs: 20000 })) } catch { /* ignore */ }
        const picked = resolveCaptureTarget({ configured: cfg.devices.capture, defaultDevice, meters })
        let app = { name: '' }
        let inMeeting = false
        try {
          app = meetingApp(cfg.activeApp || '') || (await detectMeetingApp())
          inMeeting = await meetingActive(app, await listWindows().catch(() => []))
        } catch { /* ignore */ }
        return {
          ok: true,
          result: formatAudioDiag({
            app: app && app.name, inMeeting, defaultDevice, meters, target: picked,
            processLoopback: false,
          }),
        }
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
      if (a.action === 'report') {
        const env = detectEnv()
        const cfgFile = ensureConfigFile(CONFIG_FILE, cfg)
        const rows = installChecklist({
          configFile: !cfgFile.error,
          bridge: !!(env.tools && env.tools.mbridge),
          key: !!resolveDashScopeKey({ ...cfg.asr, apiKey: keyFor(cfg.asr, 'asr') }).key,
          captureDevice: cfg.devices.capture,
          virtualMic: !!(cfg.devices.speak && (cfg.devices.speak || '').toUpperCase().includes('CABLE')),
        })
        return { ok: rows.every((r) => r.ok), result: formatChecklist(rows) }
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
      // 越用越像的进度：四层记忆 + 画像收敛度
      let memLine = ''
      try {
        const md = join(personaDir, 'memory')
        const layers = layersStatus(md)
        const conv = convergence({ profile: loadProfile(personaDir) || emptyProfile(), dir: md })
        memLine = '\n\n记忆四层：暖态 ' + layers.warm + ' · 冷储 ' + layers.cold +
          ' · 归档 ' + layers.episodicDays + ' 天 · 流水 ' + layers.journalDays + ' 天' +
          '\n像她的程度：' + Math.round(conv.score * 100) + '%（' + conv.label + '）'
      } catch { /* ignore */ }
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

  // ── 会话里收到会议链接/会议号 → 自动入会 ────────────────────────────
  const autoJoinGate = new AutoJoinGate({ cooldownMs: (cfg.autoJoin && cfg.autoJoin.cooldownMs) || 300000 })
  const autoJoinBusy = { at: 0 }
  async function autoJoinFromSession(text, source) {
    if (!isArmed()) return null
    // 已经在会里（能读到会议号/会中窗口）就没必要再入会，否则会弹出加入对话框打断当前会议
    try {
      const wins0 = await listWindows()
      const appNow = await detectMeetingApp().catch(() => null)
      if (appNow && await meetingActive(appNow, wins0)) {
        logger?.info?.('[soulmirror] 已在会中，跳过自动入会：' + String(text).slice(0, 60))
        return { ok: true, skipped: 'already-in-meeting' }
      }
    } catch { /* 探测失败就按未入会处理 */ }
    if (!cfg.autoJoin || cfg.autoJoin.enabled === false) return null
    const hit = findMeeting(text)
    if (!hit) return null
    if (cfg.autoJoin.urlOnly && hit.kind !== "url") return null
    const gate = autoJoinGate.allow(hit)
    if (!gate.ok) return null
    if (Date.now() - autoJoinBusy.at < 20000) return null
    autoJoinBusy.at = Date.now()
    autoJoinGate.mark(hit)
    const app = await detectMeetingApp().catch(() => null)
    const label = hit.kind === "url" ? hit.url : hit.value
    logger?.info?.("[soulmirror] 会话里发现会议（" + source + "），自动入会：" + label)
    try {
      const r = await joinTool.execute({
        url: hit.kind === "url" ? hit.url : undefined,
        code: hit.kind === "code" ? hit.value : undefined,
        app: app && app.name,
        displayName: cfg.userName || "",
        confirm: true,
      })
      logger?.info?.("[soulmirror] 自动入会结果：" + (r && r.ok ? "成功" : "未成功"))
      return r
    } catch (e) {
      logger?.warn?.("[soulmirror] 自动入会失败：" + e.message)
      return null
    }
  }

  // 记住用户当前工作目录：会议会话要继承它，否则 agent 看不到任何项目文件
  try {
    const offCwd = ctx.on('session/event', (session) => {
      const cwd = session?.cwd || session?.header?.cwd || session?.meta?.cwd
      if (typeof cwd === 'string' && cwd) activeSessionCwd = cwd
    }, true)
    ctx.effect?.(() => () => { try { offCwd?.() } catch { /* ignore */ } }, 'soulmirror: workspace cwd watcher')
  } catch { /* ignore */ }

  // 监听宿主会话事件：任何一条消息里出现会议信息就试一次（内部有去重与冷却）
  try {
    const offAutoJoin = ctx.on("session/event", (session, event) => {
      if (!cfg.autoJoin || cfg.autoJoin.enabled === false) return
      if (!event || !event.type) return
      // 安全边界：只认**用户本人**的输入。
      // 原来只跳过 assistant/*，于是工具结果、引用材料、别的会话内容里
      // 只要出现会议链接就会被当成"用户要入会"——等于让外部内容替用户按键。
      if (!isUserAuthoredEvent(event)) return
      const hit = findMeetingInEvent(event)
      if (!hit) return
      const sid = String((session && session.id) || "")
      autoJoinFromSession(hit.kind === "url" ? hit.url : hit.value, event.type + (sid ? " " + sid.slice(0, 12) : "")).catch(() => {})
    }, true)
    ctx.effect?.(() => () => { try { offAutoJoin?.() } catch { /* ignore */ } }, "soulmirror: auto join watcher")
    logger?.info?.("[soulmirror] 会话自动入会已开启（" + (cfg.autoJoin.urlOnly ? "仅链接" : "链接与会议号") + "）")
  } catch (e) {
    logger?.warn?.("[soulmirror] 会话自动入会监听失败: " + e.message)
  }

  // 说明：标定不再随安装自动触发。只有"已开启会议功能"且入会失败时才自动重学，
  // 或者由用户/agent 显式调用 meeting_recalibrate。

  logger?.info?.('soulmirror: 全部工具已注册')
}

export default { name, inject, Config, apply }
