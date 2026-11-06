/**
 * 采集设备体检：**采集必须对准"会议当前出声的那个设备"**。
 *
 * 一次纠错（重要）：
 *   我最初把 "CABLE Input" 直接判成错误，这是错的。
 *   CABLE Input 是**播放端点**（App 往它播），我们从它的环回录——
 *   只要会议自己也播到它，这条路径完全成立，也是常见的"内录"做法。
 *
 *   所以真正的规则不是"虚拟声卡不能用"，而是：
 *       采集设备 == 会议当前出声的设备
 *   不一致 → 录到的是静音（哪怕播放端点本身工作正常）。
 *
 * 判断分两层：
 *   1. 静态提示（diagnoseCapture）：虚拟端点要求"会议也播到这里"，配错风险高 → 提示而非报错
 *   2. 实测校验（compareCaptureWithLoud）：当场测"哪个设备在出声"，
 *      与采集设备不一致 → 这才是真错误，必须报出来并指名该换成谁
 */

/** 常见虚拟声卡名字特征（它们既能当播放端点，也能当采集源，但要求两端一致） */
const VIRTUAL_HINTS = [
  /cable/i,
  /vb-audio/i,
  /virtual/i,
  /voicemeeter/i,
  /立体声混音/i,
  /stereo\s*mix/i,
  /loopback/i,
]

/** 名字是否指向虚拟声卡（不代表错，只代表"要确认会议也播到这里"） */
export function looksLikeVirtualDevice(name = '') {
  const s = String(name || '').trim()
  if (!s) return false
  return VIRTUAL_HINTS.some((re) => re.test(s))
}

/** 名字归一化：去掉端点前后缀与括号里的型号，便于比较 */
export function normalizeDeviceName(name = '') {
  let s = String(name || '').toLowerCase()
  // 括号可能嵌套（如「扬声器 (Realtek(R) Audio)」），多剥几轮
  for (let i = 0; i < 4; i++) {
    const next = s.replace(/[（(][^（()）]*[)）]/g, '')
    if (next === s) break
    s = next
  }
  return s
    .replace(/\b(input|output|render|capture)\b/g, '')
    .replace(/[^a-z0-9\u4e00-\u9fa5]/g, '')
    .trim()
}

/** 两个设备名是否指同一个端点（宽松：一方包含另一方也算，中文名 2 字即可） */
export function sameDevice(a = '', b = '') {
  const x = normalizeDeviceName(a)
  const y = normalizeDeviceName(b)
  if (!x || !y) return false
  if (x === y) return true
  if (x.length >= 2 && y.includes(x)) return true
  if (y.length >= 2 && x.includes(y)) return true
  return false
}

/**
 * 静态体检（采集开始前，只知道配置）。
 * @param {{capture?: string, speak?: string, captureAuto?: boolean}} o
 */
export function diagnoseCapture({ capture = '', speak = '', captureAuto } = {}) {
  const cap = String(capture || '').trim()
  const spk = String(speak || '').trim()

  if (!cap && captureAuto === false) {
    return {
      ok: false,
      level: 'warn',
      reason: '采集设备为空且关了自动跟随，会退到"系统默认播放设备"的环回',
      suggestion: '把 devices.captureAuto 打开，或显式选会议实际出声的那个**播放**设备',
    }
  }

  if (cap && looksLikeVirtualDevice(cap)) {
    return {
      ok: true,
      level: 'warn',
      reason: '采集设备「' + cap + '」是虚拟声卡端点',
      suggestion: '虚拟端点可以内录，但**要求会议自己也播到这个设备**；' +
        '如果会议声音走扬声器/耳机，这条通道就只有静音',
    }
  }

  if (cap && spk && sameDevice(cap, spk)) {
    return {
      ok: true,
      level: 'warn',
      reason: '采集与发言是同一个设备',
      suggestion: '如果它是虚拟声卡，通常没问题（会议播进来、我们也说进去）；' +
        '如果会议声音走别处，采集会录到静音',
    }
  }

  return { ok: true, level: 'ok', reason: '', suggestion: '' }
}

/**
 * 实测校验：当场测"现在哪个设备在出声"，与采集设备比对。
 *
 * 这是最可靠的判断——不靠名字猜，靠电平测。
 *
 * @param {{capture?: string, loud?: {name?: string, level?: number} | null, minLevel?: number}} o
 * @returns {{ok: boolean, level: 'ok'|'warn'|'error', reason: string, suggestion: string}}
 */
export function compareCaptureWithLoud({ capture = '', loud = null, minLevel = 0.02 } = {}) {
  const cap = String(capture || '').trim()
  if (!loud || !loud.name) {
    return { ok: true, level: 'ok', reason: '', suggestion: '' }
  }
  if ((loud.level || 0) < minLevel) {
    return { ok: true, level: 'ok', reason: '', suggestion: '' }   // 没人在出声，判断不了
  }
  if (!cap) {
    return {
      ok: true,
      level: 'warn',
      reason: '采集用的是系统默认设备，而现在是「' + loud.name + '」在出声',
      suggestion: '如果默认设备不是它，就会录到静音；建议把 devices.capture 显式设为「' + loud.name + '」',
    }
  }
  if (sameDevice(cap, loud.name)) {
    return { ok: true, level: 'ok', reason: '', suggestion: '' }
  }
  return {
    ok: false,
    level: 'error',
    reason: '会议声音现在从「' + loud.name + '」出（电平 ' + (loud.level || 0).toFixed(3) +
      '），但采集的是「' + cap + '」，两者不是同一个端点，所以录到的是静音',
    suggestion: '把 devices.capture 改成「' + loud.name + '」，或在会议软件里把扬声器切到「' + cap + '」',
  }
}

/**
 * 停止时的判定：把它写进 meta，事后能查清"这段录音有没有声音"。
 * @param {{bytes?: number, silentSec?: number, durationSec?: number}} o
 */
export function captureVerdict({ bytes = 0, silentSec = 0, durationSec = 0 } = {}) {
  if (!bytes) return { silentRatio: 1, verdict: '没有采到任何数据（采集进程没起来或设备不可用）' }
  const total = Math.max(1, durationSec || silentSec || 1)
  const ratio = Math.min(1, silentSec / total)
  if (ratio >= 0.98) return { silentRatio: ratio, verdict: '整段几乎全静音：采集设备没有会议声音' }
  if (ratio >= 0.9) return { silentRatio: ratio, verdict: '九成以上静音：设备基本没收到会议声音' }
  if (ratio >= 0.7) return { silentRatio: ratio, verdict: '静音偏多：可能设备不对或会议大部分时间无人说话' }
  return { silentRatio: ratio, verdict: '' }
}
