/**
 * 音频路由诊断：一次性把"现在到底是什么情况"说清楚。
 *
 * 起因：排查"采不到声音"时反复靠猜（默认设备对不对、会议在哪个设备出声、
 * 进程级环回能不能用），每次都要手动敲几个命令。这里固化成一条输出。
 */

/** @param {{ defaultDevice?: string, meters?: Array<{name:string,peak:number}>, target?: object, inMeeting?: boolean, app?: string, processLoopback?: boolean }} s */
export function formatAudioDiag(s = {}) {
  const lines = []
  lines.push('【音频路由诊断】')
  lines.push('  会议软件：' + (s.app || '未识别') + (s.inMeeting ? '（在会中）' : '（不在会中）'))
  lines.push('  系统默认播放：' + (s.defaultDevice || '（读不到）'))

  const meters = Array.isArray(s.meters) ? s.meters : []
  if (meters.length === 0) {
    lines.push('  实时电平：读不到（桥接可能不可用）')
  } else {
    const loud = meters.slice().sort((a, b) => (b.peak || 0) - (a.peak || 0))[0]
    lines.push('  实时电平：')
    for (const m of meters) {
      const mark = (m.peak || 0) >= 0.01 ? '[有声]' : '[静音]'
      lines.push('    ' + mark + ' ' + m.name + '  peak=' + Number(m.peak || 0).toFixed(4))
    }
    const loudEnough = loud && loud.name && (loud.peak || 0) >= 0.01
    lines.push('  最响的是：' + (loudEnough ? loud.name + '（peak=' + Number(loud.peak).toFixed(4) + '）' : '（没有设备在出声）'))
  }

  const t = s.target || {}
  if (t.device) {
    const sourceText = { configured: '配置指定', playing: '此刻在出声', 'system-default': '系统默认', none: '未定' }[t.source] || t.source
    lines.push('  将采集：' + t.device + '（' + sourceText + '）')
  } else {
    lines.push('  将采集：（未确定）')
  }

  lines.push('  进程级环回：' + (s.processLoopback ? '可用' : '不可用（这台机器上 VAD\\Process_Loopback 激活失败，只能用设备环回）'))

  // 给出可执行的下一步，而不是让用户猜
  const tips = []
  if (!s.inMeeting) tips.push('先在会议软件里进会，再来看这一页')
  if (meters.length && meters.every((m) => (m.peak || 0) < 0.01)) {
    tips.push('当前所有渲染设备都静音：确认会议没静音、有人说话；不放心就让系统放一段音乐再测')
  }
  if (t.source === 'system-default') tips.push('采集走系统默认设备；如果会议在别处出声，点「检测」会改用它')
  if (!tips.length) tips.push('看起来正常：直接开始采集即可')
  lines.push('  建议：')
  for (const tip of tips) lines.push('    · ' + tip)

  return lines.join('\n')
}
