/**
 * 安装体检项与"手动补一项"的动作定义。
 *
 * 三项不能自动完成的事，这里给出统一的条目结构，
 * 让面板可以直接渲染成"一行一个按钮"，而不是让用户去翻文档。
 */

/** @typedef {{ id: string, what: string, ok: boolean, fix: string, action?: string, manual?: boolean }} SetupRow */

/**
 * @param {{ config?: boolean, bridge?: boolean, key?: boolean,
 *           captureDevice?: string, virtualMic?: boolean, calibrated?: boolean }} state
 * @returns {SetupRow[]}
 */
export function buildSetupRows(state = {}) {
  const rows = []

  rows.push({
    id: 'config',
    what: '配置文件',
    ok: !!state.config,
    fix: '点一下即可生成默认配置',
    action: 'config',
  })

  rows.push({
    id: 'bridge',
    what: '音频桥接（mbridge.exe）',
    ok: !!state.bridge,
    fix: '用系统 csc 现场编译（需要 .NET Framework 4.x）',
    action: 'build',
  })

  rows.push({
    id: 'key',
    what: '语音识别密钥',
    ok: !!state.key,
    fix: '可以不填：不填就没有实时转写，其它功能照常',
    action: 'key',
  })

  rows.push({
    id: 'device',
    what: '采集设备',
    ok: !!(state.captureDevice || '').trim(),
    fix: '对齐会议软件的输出设备（读实时电平，不用先出声）',
    action: 'probe',
  })

  rows.push({
    id: 'vm',
    what: '虚拟声卡（代为发言用）',
    ok: !!state.virtualMic,
    fix: '装 VB-CABLE 需要 Windows UAC 确认，必须你本人点',
    action: 'vb-cable',
    manual: true,
  })

  rows.push({
    id: 'calib',
    what: '入会按钮标定',
    ok: state.calibrated !== false,
    fix: '第一次入会时自动学；也可以让我用 computer-use 现场标定',
    action: 'calibrate',
  })

  return rows
}

/** 缺了几项 / 是否全部就绪 */
export function summarizeSetup(rows) {
  const missing = rows.filter((r) => !r.ok)
  return { ok: missing.length === 0, missing: missing.length, ids: missing.map((r) => r.id) }
}

/** 面板提示语 */
export function setupHint(rows) {
  const { ok, missing, ids } = summarizeSetup(rows)
  if (ok) return '配置齐全，可以直接用'
  const names = rows.filter((r) => !r.ok).map((r) => r.what)
  return `还差 ${missing} 项：${names.join('、')}（点右侧按钮补齐；密钥可以留空）`
}
