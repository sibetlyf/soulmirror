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
  const verdict = fatal.length
    ? ('无法转录：' + fatal[0].label + (fatal[0].detail ? '（' + fatal[0].detail + '）' : '') +
      (fatal[0].fix ? ' → ' + fatal[0].fix : ''))
    : (failed.length
      ? ('链路就绪，但' + failed[0].label + (failed[0].detail ? '：' + failed[0].detail : '') +
        (failed[0].fix ? ' → ' + failed[0].fix : ''))
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
  return { id: c.id, label: c.label, detail: c.detail, fix: c.fix }
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

  return summarize(checks)
}
