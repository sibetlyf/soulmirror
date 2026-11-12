/**
 * 会前 / 出问题时的采集自检（preflight）。
 *
 * 为什么需要：
 *   别人反馈"模型和设备都配对了，会议开始但没有转录"，而我本地正常。
 *   这类问题的成因几乎全在**机器差异**上，且失败是静默的：
 *     · 不是 Windows（本插件依赖 WASAPI 环回 + UIAutomation + mbridge.exe）
 *     · mbridge.exe 缺失或跑不起来（缺 .NET Framework / 被杀软拦 / 装的是旧包）
 *     · 没有可采的播放端点（虚拟声卡没装、设备被独占）
 *     · 采错了端点（会议从扬声器出声，却去采 CABLE Input）
 *     · ASR 密钥无效 / provider 不是 dashscope / 网络到不了 wss
 *   所以要有一份**逐项 PASS/FAIL + 怎么修**的清单，而不是让用户猜。
 *
 * 本模块只做判定与文案（纯函数），检测能力由调用方注入，便于单测。
 */

/** 采集错误 → 修法（密钥 / 桥接 / 设备三类分开，别让人查错方向） */
function classifyCaptureFix(text) {
  const s = String(text || '')
  if (/DASHSCOPE|密钥|apiKey|api key|unauthor|401/i.test(s)) {
    return '在「设置 → 会议助手」填自己的百炼 Key（或设环境变量 DASHSCOPE_API_KEY）'
  }
  if (/mbridge|桥接|spawn|ENOENT/i.test(s)) {
    return '重装插件，或运行 soul_setup { action: "build" } 重新编译桥接'
  }
  if (/设备|device|端点|endpoint|占用|busy|静音|silent/i.test(s)) {
    return '确认会议声音从当前采集设备出：设备静音 / 端点选错 / 被独占'
  }
  return '点「一键体检」逐项定位'
}

/** 单条检查的结果 */
export function check(id, label, ok, { detail = '', fix = '', fatal = false } = {}) {
  return { id, label, ok: !!ok, detail: String(detail || ''), fix: ok ? '' : String(fix || ''), fatal: !!fatal }
}

/**
 * 汇总：整体是否可用 + 第一条致命问题（给界面显示一句话）。
 * @param {Array} checks
 */
export function summarize(checks = []) {
  const list = Array.isArray(checks) ? checks : []
  const failed = list.filter((c) => !c.ok)
  const fatal = failed.filter((c) => c.fatal)
  const blocked = fatal[0] || failed[0] || null
  // 语义要准：
  //   ok      = 采集链路能不能用（只看致命项；"当前没在会议中"不影响可用性）
  //   ready   = 所有检查都通过（含"正在开会"这类上下文项）
  //
  // 一句话结论优先用检查项自己的 verdict（例如声纹项的"声纹模型未安装"），
  // 没有 verdict 的老项仍按 label + detail 拼——旧文案不变。
  const why = (c) => {
    const verdict = String((c && c.verdict) || '')
    const detail = String((c && c.detail) || '')
    if (verdict) return '（' + verdict + '）'
    return detail ? '（' + detail + '）' : ''
  }
  const because = (c) => {
    const verdict = String((c && c.verdict) || '')
    const detail = String((c && c.detail) || '')
    const text = verdict || detail
    return text ? '：' + text : ''
  }
  const verdict = fatal.length
    ? ('无法转录：' + fatal[0].label + why(fatal[0]) + (fatal[0].fix ? ' → ' + fatal[0].fix : ''))
    : (failed.length
      ? ('链路就绪，但' + failed[0].label + because(failed[0]) + (failed[0].fix ? ' → ' + failed[0].fix : ''))
      : '采集链路就绪')

  return {
    ok: fatal.length === 0,
    ready: failed.length === 0,
    total: list.length,
    failed: failed.length,
    fatal: fatal.length,
    verdict,
    blocked: blocked ? claimed(blocked) : null,
    checks: list,
  }
}

function claimed(c) {
  return { id: c.id, label: c.label, detail: c.detail, fix: c.fix, verdict: String(c.verdict || '') }
}

/**
 * 声纹体检项。
 *
 * 输入**全部来自只读事实**（index.js 的 collectVoiceprintEnv：文件/清单/库 JSON），
 * 没有加载 ONNX 模型——加载会锁住运行库 DLL，装/换运行库就会被 Windows 拒绝。
 * 所以这一项能回答的是"配置、文件、库是不是齐"，而不是"模型这一次能不能推理"；
 * 真的推理只在用户点「一键安装」（安装末尾自检）和会后认人时发生。
 *
 * 分档（level 只是显示用；ok 只表示"这一项要不要人动手"）：
 *   关闭          info   不是故障，只是本机不认人
 *   模型没装      warn
 *   模型校验不过  warn   ← 被截断/替换的 25MB 文件最容易骗过"文件存在"的判定
 *   运行库不可用  warn
 *   库文件损坏    warn   读不出人时不能说"还没录过人"（那是编的）
 *   库空          info   都装好了，只是还没录
 *   就绪          ok     几个人 / 几个样本 / 门槛
 */
export function voiceprintCheck(input) {
  const vp = input && typeof input === 'object' ? input : {}
  const enabled = vp.enabled === true
  const people = Number(vp.people) || 0
  const samples = Number(vp.samples) || 0
  const manualPath = vp.manualPath === true
  const modelExists = vp.modelExists === true
  const modelVerified = vp.modelVerified === true
  const runtimeOk = vp.runtimeHostOk === true || (vp.runtimeInstalled === true && vp.runtimeFilesOk === true)
  const error = String(vp.error || '')
  const accept = Number.isFinite(Number(vp.acceptSimilarity)) ? Number(vp.acceptSimilarity) : 0.60
  const margin = Number.isFinite(Number(vp.matchMargin)) ? Number(vp.matchMargin) : 0.15
  const modelFile = String(vp.modelFile || vp.modelPath || '')

  const item = (ok, level, verdict, detail, fix) => ({
    id: 'voiceprint', key: 'voiceprint', label: '本机声纹识别',
    ok: ok === true, level, verdict: String(verdict || ''),
    detail: String(detail || ''),
    // info 档的 fix 是"下一步建议"而不是"故障修法"，所以不能像 check() 那样清空
    fix: (ok === true && level !== 'info') ? '' : String(fix || ''),
    fatal: false,
  })

  if (!enabled) {
    return item(true, 'info', '本机声纹未启用（会后只按匿名说话人整理纪要）', '', '在「纪要与产物」页开启')
  }
  // 读不出模型状态（清单丢了/插件没装全）时不能猜"没装"，要说清是读不出来
  if (error && !modelExists) {
    return item(false, 'warn', '声纹状态读不出来，无法判断能不能认人', error,
      '重装/升级插件后再点「一键体检」；仍然失败就把这条原因一起反馈')
  }
  if (!modelExists) {
    return item(false, 'warn', '声纹模型未安装', modelFile ? ('应放在 ' + modelFile) : '没有找到模型文件',
      '点「一键安装」下载并校验')
  }
  if (!modelVerified && !manualPath) {
    return item(false, 'warn', '模型文件校验不通过（可能被截断或被替换）',
      modelFile ? ('文件：' + modelFile) : '',
      '删掉后重新安装（一键安装会重新下载并按清单 sha256 校验）')
  }
  if (!runtimeOk) {
    return item(false, 'warn',
      vp.runtimeInstalled === true ? '声纹运行库文件不全（加载入口缺失）' : '声纹运行库未安装',
      vp.runtimeInstalled === true
        ? 'package/dist/index.js 不在或为空；上次可能解压到一半被中断'
        : '模型在，但运行库没装，模型加载不起来',
      '点「一键安装」补齐运行库（会解到数据目录，不写宿主 node_modules）')
  }
  if (vp.libraryCorrupted === true) {
    return item(false, 'warn', '声纹库文件读不出来（可能已损坏）', '读不出已入库的人，不能按 0 人处理',
      '把 <数据目录>/voiceprint/library.json 备份后删掉，再重新录（历史纪要不受影响）')
  }
  if (people > 0 && samples > 0) {
    return item(true, 'ok',
      '声纹就绪：' + people + ' 人 / ' + samples + ' 个样本（阈值 ' + accept.toFixed(2) + ' + margin ' + margin.toFixed(2) + '）',
      '模型与运行库都已就绪' + (manualPath ? '（模型用的是手动指定的路径，未按清单校验）' : '') + (error ? '｜' + error : ''))
  }
  if (people > 0) {
    return item(true, 'info', '声纹就绪，但当前模型下没有可用样本（可能换过模型）',
      samples === 0 ? '人还在，样本不属于当前模型空间，不能用来认人' : '',
      '在「本机声纹」里重新录一段（≥10 秒）')
  }
  return item(true, 'info', '声纹就绪，但还没有录过人',
    '模型与运行库都已就绪，库里 0 人；会后不会认人',
    '在「本机声纹」里录一段（≥10 秒）')
}

/**
 * 把环境探测结果转成清单。
 *
 * @param {{
 *   platform?: string,
 *   bridgePresent?: boolean,
 *   bridgeRuns?: boolean,
 *   deviceCount?: number,
 *   deviceName?: string,
 *   meetingActive?: boolean,
 *   asrProvider?: string,
 *   asrKey?: string,
 *   asrKeySource?: string,
 *   asrReachable?: boolean | null,
 *   lastCaptureError?: string,
 *   voiceprint?: { enabled?: boolean, modelId?: string, modelFile?: string, modelExists?: boolean,
 *     modelVerified?: boolean, manualPath?: boolean, runtimeInstalled?: boolean, runtimeFilesOk?: boolean,
 *     runtimeHostOk?: boolean, people?: number, samples?: number, libraryCorrupted?: boolean,
 *     acceptSimilarity?: number, matchMargin?: number, error?: string },
 * }} env
 */
export function buildPreflight(env = {}) {
  const checks = []
  const platform = String(env.platform || process.platform)

  checks.push(check('platform', '运行平台', platform === 'win32', {
    detail: platform,
    fix: '本插件的采集依赖 Windows 的 WASAPI 环回与 UI Automation；macOS / Linux 上无法采集，只能看历史与纪要',
    fatal: true,
  }))

  checks.push(check('bridge', '音频桥接 mbridge.exe', !!env.bridgePresent, {
    detail: env.bridgePresent ? '' : '文件不存在',
    fix: '插件安装不完整（升级或重装 soulmirror），或运行 soul_setup { action: "build" } 重新编译',
    fatal: true,
  }))

  checks.push(check('bridge-run', '桥接可执行', !!env.bridgeRuns, {
    detail: env.bridgeRuns ? '' : '无法列出音频端点',
    fix: '装 .NET Framework 4.x；若被杀软拦截请放行 mbridge.exe',
    fatal: true,
  }))

  const devCount = Number(env.deviceCount) || 0
  checks.push(check('device', '可采集的播放端点', devCount > 0, {
    detail: devCount ? (devCount + ' 个' + (env.deviceName ? '，当前：' + env.deviceName : '')) : '一个都没枚举到',
    fix: '确认系统有可用的播放设备（扬声器/耳机）；用虚拟声卡内录时需装 VB-CABLE',
    fatal: true,
  }))

  const provider = String(env.asrProvider || '')
  checks.push(check('asr-provider', '识别服务', provider === 'dashscope', {
    detail: provider || '未配置',
    fix: '把 asr.provider 设为 dashscope（实时识别走百炼 paraformer-realtime）',
    fatal: true,
  }))

  const key = String(env.asrKey || '')
  checks.push(check('asr-key', '识别密钥', key.length >= 20, {
    detail: key ? ('来源 ' + (env.asrKeySource || '未知')) : '为空',
    fix: '在「设置 → 会议助手」填百炼 Key；或设环境变量 DASHSCOPE_API_KEY。Key 是账号资产，插件不会替你申请',
    fatal: true,
  }))

  // 可选：网络连通（null 表示没测，不算失败）
  if (env.asrReachable === true || env.asrReachable === false) {
    checks.push(check('asr-net', '识别服务连通', env.asrReachable === true, {
      detail: env.asrReachable ? '' : '握手失败',
      fix: '检查网络/代理是否放行 wss://dashscope.aliyuncs.com；公司网络可能需要白名单',
      fatal: true,
    }))
  }

  // 会议检测：不是故障，但决定"现在该不该录音"
  if (env.meetingActive === false) {
    checks.push(check('meeting', '会议窗口', false, {
      detail: '当前没检测到会议窗口',
      fix: '开始会议后会自动录音；若已在会中仍检测不到，检查 apps 配置里的进程名',
    }))
  } else if (env.meetingActive === true) {
    checks.push(check('meeting', '会议窗口', true, { detail: '已检测到' }))
  }

  if (env.lastCaptureError) {
    checks.push(check('last-error', '上次采集错误', false, {
      detail: String(env.lastCaptureError).slice(0, 120),
      fix: classifyCaptureFix(String(env.lastCaptureError || '')),
    }))
  }

  // 声纹：不影响"能不能转录"，所以非致命；但它是"会后能不能认出人"的唯一答案。
  // 事实来自只读探测（不加载模型）；没给就不产生这一项（只装采集链路时体检不变）。
  if (env.voiceprint && typeof env.voiceprint === 'object') {
    checks.push(voiceprintCheck(env.voiceprint))
  }

  return summarize(checks)
}
