/**
 * 解析"用哪个模型"。
 *
 * 真实事故：会议里 agent 一直不回复，日志写"DSH 没有可用的默认模型"。
 * 原因是只查了 sessionController.modelCatalog().default，而它在某些情况下
 * （没有会话、默认模型未落库）返回空，直接把整条链路打死。
 *
 * 这里改成逐级回退，并且失败时把"看到过哪些 provider"写进错误里，
 * 让人一眼知道是没配置还是查询失败。
 */

/**
 * @param {{
 *   preferred?: { provider?: string, model?: string },
 *   catalog?: () => Promise<{ default?: { provider: string, model: string } } | null>,
 *   listProviders?: () => Promise<Array<{ id: string }>>,
 *   listModels?: (provider: string) => Promise<Array<{ id: string }>>,
 * }} deps
 * @returns {Promise<{ provider: string, model: string, source: string }>}
 */
export async function resolveDefaultModel(deps = {}) {
  const { preferred = {}, catalog, listProviders, listModels } = deps
  const wantProvider = String(preferred.provider || '').trim()
  const wantModel = String(preferred.model || '').trim()

  // 1) 配置里写死的优先
  if (wantProvider && wantModel) {
    return { provider: wantProvider, model: wantModel, source: 'config' }
  }

  // 2) 宿主默认模型
  let seen = []
  try {
    const c = catalog ? await catalog() : null
    if (c && c.default && c.default.provider && c.default.model) {
      return {
        provider: wantProvider || c.default.provider,
        model: wantModel || c.default.model,
        source: 'catalog',
      }
    }
  } catch (e) {
    seen.push('catalog 查询失败：' + (e && e.message ? e.message : e))
  }

  // 3) 退回到"第一个可用 provider 的第一个模型"
  try {
    const providers = listProviders ? await listProviders() : []
    const ids = (Array.isArray(providers) ? providers : [])
      .map((p) => (typeof p === 'string' ? p : p && p.id))
      .filter(Boolean)
    if (ids.length) {
      for (const id of ids) {
        if (wantProvider && id !== wantProvider) continue
        let models = []
        try {
          models = (await listModels(id)) || []
        } catch { /* 这个 provider 列不出来，换下一个 */ }
        const first = models.map((m) => (typeof m === 'string' ? m : m && m.id)).filter(Boolean)[0]
        if (first) return { provider: id, model: wantModel || first, source: 'first-available' }
      }
      seen.push('可用 provider：' + ids.join('、'))
    } else {
      seen.push('没有任何可用 provider')
    }
  } catch (e) {
    seen.push('列 provider 失败：' + (e && e.message ? e.message : e))
  }

  throw new Error('找不到可用模型（' + (seen.join('；') || '未获取到任何信息') + '）。请在插件设置里填写 brain.provider / brain.model')
}
