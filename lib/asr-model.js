/**
 * ASR 模型名的唯一解析入口。
 *
 * 历史包袱：早先有 asr.model 和 asr.dashscopeModel 两个字段，
 * 面板改的是 model、显示的是 dashscopeModel —— 用户看到"改了没生效"。
 * 现在统一以 model 为准，dashscopeModel 只作为旧配置的兼容兜底。
 */

const DEFAULT_DASHSCOPE = 'paraformer-realtime-v2'

/** 面板里对 dashscope 可选的模型 */
export const DASHSCOPE_MODELS = [DEFAULT_DASHSCOPE, 'paraformer-realtime-v1']

/**
 * @param {{ model?: string, dashscopeModel?: string, provider?: string }} asr
 * @returns {string} 实际要下发的模型名
 */
export function resolveAsrModel(asr = {}) {
  const provider = String(asr.provider || 'dashscope').trim()
  if (provider !== 'dashscope') {
    // 非 dashscope 路径沿用 model（例如 openai 兼容的 whisper-1）
    return String(asr.model || '').trim()
  }

  const model = String(asr.model || '').trim()
  const legacy = String(asr.dashscopeModel || '').trim()

  // model 是明确的 dashscope 模型 → 用它
  if (DASHSCOPE_MODELS.includes(model)) return model
  // model 是历史默认值 whisper-1（对 dashscope 无意义）→ 用旧字段
  if (!model || model === 'whisper-1') return legacy || DEFAULT_DASHSCOPE
  // 其它值原样下发（可能是新模型名），不拦
  return model
}

/** 保存时把两个字段对齐，避免旧代码读到过期值 */
export function withSyncedModel(asr = {}) {
  const model = resolveAsrModel(asr)
  return { ...asr, model, dashscopeModel: model }
}
