/**
 * 决定"采哪个设备"的纯逻辑。
 *
 * 用户的原话：直接和会议软件设置的设备一致不就行了。
 * 对——会议软件默认就把声音送到系统默认播放设备，
 * 所以不需要先让它出声再一个个试听。
 *
 * 优先级：
 *   1. 用户显式指定（最可控）
 *   2. 此刻真的有声音的设备（说明会议正往那儿送）
 *   3. 系统默认播放设备（会议软件的默认选择，静音时也能定下来）
 */

/** meters 输出 → [{name, peak}] */
export function parseMeters(text) {
  const rows = []
  for (const line of String(text || '').split(/\r?\n/)) {
    const parts = line.split('\t').map((x) => x.trim())
    if (parts.length < 2 || !parts[0]) continue
    const peak = Number(parts[1])
    if (!Number.isFinite(peak)) continue
    rows.push({ name: parts[0], peak })
  }
  return rows
}

/**
 * @param {{ configured?: string, defaultDevice?: string, meters?: Array<{name:string,peak:number}>, threshold?: number }} input
 * @returns {{ device: string, source: 'configured'|'playing'|'system-default'|'none', playedDevice?: string, note: string }}
 */
export function resolveCaptureTarget({ configured = '', defaultDevice = '', meters = [], threshold = 0.01 } = {}) {
  const cfg = String(configured || '').trim()
  if (cfg) {
    return { device: cfg, source: 'configured', note: '配置里指定的设备' }
  }

  let loudest = null
  for (const m of meters) {
    if (!m || !m.name) continue
    if (!loudest || m.peak > loudest.peak) loudest = m
  }

  if (loudest && loudest.peak >= threshold) {
    return {
      device: loudest.name,
      source: 'playing',
      playedDevice: loudest.name,
      note: '此刻正在出声的设备（峰值 ' + Number(loudest.peak).toFixed(2) + '）',
    }
  }

  const def = String(defaultDevice || '').trim()
  if (def) {
    return {
      device: def,
      source: 'system-default',
      note: '系统默认播放设备——会议软件默认也往这里送声音；等有人说话会自动切到真正有声的那个',
    }
  }

  return { device: '', source: 'none', note: '既没有默认设备也没有声音，暂时用系统默认' }
}
