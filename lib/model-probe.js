/**
 * 模型联通性测试：把底层错误翻译成"用户该做什么"。
 *
 * 为什么单独成文件：
 *   同一个 401，可能是 Key 没填、Key 填错、Key 被停用、Key 不是百炼的。
 *   用户看到 "ws handshake failed: HTTP/1.1 401 Unauthorized" 完全无从下手；
 *   这里把各种底层错误归成几类，每类给一句可操作的话。
 */

/** 错误分类：返回 { kind, title, hint, retryable } */
export function classifyProbeError(raw) {
  const text = String((raw && (raw.message || raw.error)) || raw || '')
  const code = String((raw && raw.code) || '')
  const all = (text + ' ' + code).toLowerCase()

  if (/401|unauthorized|invalid.?api.?key|authentication|bearer/.test(all)) {
    return {
      kind: 'auth',
      title: 'Key 无效或未被接受',
      hint: '到百炼控制台重新复制 Key（注意不要带空格/引号），保存后再测。若刚清空过，请确认 Key 已写入配置。',
      retryable: false,
    }
  }
  if (/403|forbidden|permission|not.?authorized|disable|suspend/.test(all)) {
    return {
      kind: 'forbidden',
      title: 'Key 无权限或账号被停用',
      hint: '检查该 Key 是否开通了对应模型（语音识别/语音合成），以及账号是否欠费或被停用。',
      retryable: false,
    }
  }
  if (/404|model.?not.?found|no such model|unsupported.?model/.test(all)) {
    return {
      kind: 'model',
      title: '模型名不对',
      hint: '换回默认模型名（识别 paraformer-realtime-v2，合成 cosyvoice-v2），或确认你的账号开通了这个模型。',
      retryable: false,
    }
  }
  if (/429|rate.?limit|too many requests|throttl/.test(all)) {
    return {
      kind: 'quota',
      title: '被限流或额度用尽',
      hint: '稍等几十秒再测；长期出现请到控制台看用量与限额。',
      retryable: true,
    }
  }
  if (/enotfound|econnrefused|econnreset|etimedout|network|socket|dns|proxy|getaddrinfo/.test(all)) {
    return {
      kind: 'network',
      title: '网络连不上百炼',
      hint: '确认这台机器能访问 dashscope.aliyuncs.com；公司网络常需配置代理或放行 443。',
      retryable: true,
    }
  }
  if (/timeout|超时/.test(all)) {
    return {
      kind: 'timeout',
      title: '连接超时',
      hint: '服务端没在预期时间内响应：检查网络质量，或稍后重试。',
      retryable: true,
    }
  }
  if (/缺少|not set|missing.?key|no.?api.?key|empty/.test(all)) {
    return {
      kind: 'missing',
      title: '没有配置 Key',
      hint: '在「会议 → 配置」里填 Key，或设置环境变量 DASHSCOPE_API_KEY。',
      retryable: false,
    }
  }
  return {
    kind: 'unknown',
    title: '未预期的错误',
    hint: '把下面的原始错误发给维护者。',
    retryable: true,
  }
}

/**
 * 组装一份可读报告。
 * @param {{ asr?: object, tts?: object }} results 每个模型的结果 { ok, error?, ms?, detail? }
 */
export function buildProbeReport(results = {}) {
  const lines = []
  let ok = true
  for (const [name, r] of [['语音识别', results.asr], ['语音合成', results.tts]]) {
    if (!r) continue
    if (r.ok) {
      lines.push('✅ ' + name + '：连通' + (r.ms ? '（' + r.ms + 'ms）' : ''))
      continue
    }
    ok = false
    const c = classifyProbeError(r.error && r.error.message ? r.error : (r.error || r.detail || ''))
    lines.push('❌ ' + name + '：' + c.title)
    lines.push('   → ' + c.hint)
    const raw = String((r.error && (r.error.message || r.error)) || r.detail || '').slice(0, 200)
    if (raw) lines.push('   原始错误：' + raw)
  }
  return { ok, text: lines.join('\n') }
}
