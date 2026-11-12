/**
 * 一键安装状态：**只有一份**投影（宿主写、界面读）。
 *
 * 抽成模块的原因：
 *   · 状态迁移只在宿主一处发生，但"重启后归一化"和"终态长什么样"要能被验证；
 *   · 进程被杀/重启后，install.json 里的"进行中"阶段必须归一化，
 *     否则界面会永远显示"正在安装…"（假进度）。
 *
 * 阶段名与界面文案表一一对应（lib/client.js 的 installLabel）。
 */
export const INSTALL_PHASES = Object.freeze([
  'idle', 'resolving', 'download-model', 'verify-model', 'install-model',
  'download-runtime', 'verify-runtime', 'extract-runtime', 'done', 'failed',
])

/** 这些阶段是"正在做"：重启后看到它们说明上次没做完 */
export const IN_PROGRESS_PHASES = Object.freeze([
  'resolving', 'download-model', 'verify-model', 'install-model',
  'download-runtime', 'verify-runtime', 'extract-runtime',
])

export function emptyInstallState() {
  return {
    phase: 'idle', running: false, canceling: false,
    message: '', percent: 0, received: 0, total: 0,
    step: 0, stepsTotal: 0, stepLabel: '',
    modelId: '', error: '', hint: '', at: '',
  }
}

/**
 * 重启后读回来的状态归一化：
 *   · running 永远是 false（不能永久卡在"安装中"）
 *   · 上次停在中间阶段 → failed + 说明 + 可重试
 *   · 不认识的阶段 → idle，不留脏文案
 */
export function normalizeInstallState(raw) {
  if (!raw || typeof raw !== 'object') return emptyInstallState()
  const state = { ...emptyInstallState(), ...raw, running: false, canceling: false }
  if (raw.running === true || IN_PROGRESS_PHASES.includes(state.phase)) {
    return {
      ...state, phase: 'failed', running: false, canceling: false,
      percent: 0, received: 0, total: 0, step: 0,
      message: '上次安装未完成',
      error: '上次安装被中断（进程退出或重启）',
      hint: '检查网络后重新点「一键安装」',
    }
  }
  if (!INSTALL_PHASES.includes(state.phase)) {
    return { ...state, phase: 'idle', message: '', error: '', hint: '', canceling: false }
  }
  return state
}

/** 状态迁移：patch 合并 + 时间戳（每次都返回新对象，界面不会读到半更新的状态） */
export function mergeInstallState(prev, patch) {
  return { ...(prev || emptyInstallState()), ...(patch || {}), at: new Date().toISOString() }
}
