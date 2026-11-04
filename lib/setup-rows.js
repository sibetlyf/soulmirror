/**
 * 安装体检项与"手动补一项"的动作定义。
 *
 * 状态分三档，避免"没配置也打勾"的误导：
 *   ok      —— 你亲自配过，确定可用
 *   auto    —— 有值，但来自环境变量/自动跟随，没人为它做过选择
 *   missing —— 确实没有
 */

/** @typedef {'ok'|'auto'|'missing'} SetupState */
/** @typedef {{ id: string, what: string, ok: boolean, state: SetupState, detail: string, fix: string, action?: string, manual?: boolean }} SetupRow */

/**
 * @param {{ config?: boolean, bridge?: boolean, key?: boolean, keySource?: string,
 *           captureDevice?: string, captureAuto?: boolean, virtualMic?: boolean,
 *           calibrated?: boolean }} state
 * @returns {SetupRow[]}
 */
export function buildSetupRows(state = {}) {
  const rows = []
  const push = (row) => rows.push({ ok: row.state === 'ok', detail: '', ...row })

  push({
    id: 'config',
    what: '配置文件',
    state: state.config ? 'ok' : 'missing',
    detail: state.config ? '已生成' : '',
    fix: '点一下即可生成默认配置',
    action: 'config',
  })

  push({
    id: 'bridge',
    what: '音频桥接',
    state: state.bridge ? 'ok' : 'missing',
    detail: state.bridge ? 'mbridge.exe 已就绪' : '',
    fix: '用系统 csc 现场编译（需要 .NET Framework 4.x）',
    action: 'build',
  })

  // 密钥：环境变量提供 ≠ 你配过，必须说清来源
  {
    const src = String(state.keySource || '')
    const fromEnv = src === 'env' || src === 'env:registry'
    push({
      id: 'key',
      what: '语音识别密钥',
      state: state.key ? (src === 'config' ? 'ok' : 'auto') : 'missing',
      detail: state.key ? (fromEnv ? '来自环境变量，无需再填' : '已保存在配置里') : '',
      fix: '可以不填：不填就没有实时转写，其它功能照常',
      action: 'key',
    })
  }

  // 设备：自动跟随不等于"你选的设备"
  {
    const has = !!(state.captureDevice || '').trim()
    push({
      id: 'device',
      what: '采集设备',
      state: has ? (state.captureAuto ? 'auto' : 'ok') : 'missing',
      detail: has ? (state.captureAuto ? '自动跟随系统默认，未手动指定' : String(state.captureDevice)) : '',
      fix: '对齐会议软件的输出设备（读实时电平，不用先出声）',
      action: 'probe',
    })
  }

  push({
    id: 'vm',
    what: '虚拟声卡',
    state: state.virtualMic ? 'ok' : 'missing',
    detail: state.virtualMic ? '已配置为发言输出' : '',
    fix: '装 VB-CABLE 需要 Windows UAC 确认，必须你本人点',
    action: 'vb-cable',
    manual: true,
  })

  push({
    id: 'calib',
    what: '入会按钮标定',
    state: state.calibrated === false ? 'missing' : 'ok',
    detail: state.calibrated === false ? '还没标定过' : '',
    fix: '第一次入会时自动学；也可以让我用 computer-use 现场标定',
    action: 'calibrate',
  })

  return rows
}

/** 缺了几项 / 有几项是自动接管的 */
export function summarizeSetup(rows) {
  const missing = rows.filter((r) => r.state === 'missing')
  const auto = rows.filter((r) => r.state === 'auto')
  return { ok: missing.length === 0, missing: missing.length, auto: auto.length, ids: missing.map((r) => r.id) }
}

/** 面板提示语 */
export function setupHint(rows) {
  const { ok, missing, auto } = summarizeSetup(rows)
  if (ok && auto === 0) return '配置齐全，可以直接用'
  if (!ok) {
    const names = rows.filter((r) => r.state === 'missing').map((r) => r.what)
    return `还差 ${missing} 项：${names.join('、')}（点右侧按钮补齐；密钥可以留空）`
  }
  const autoNames = rows.filter((r) => r.state === 'auto').map((r) => r.what).join('、')
  return `可以用了；${auto} 项由环境自动接管（${autoNames}）`
}
