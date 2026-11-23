/**
 * lib/knowledge.js —— 与 dsh-knowledge 的联动与校验
 *
 * 教训：headless profile 默认没装 dsh-knowledge，直接丢任务过去会"看起来成功"、
 * 实际什么都没写。所以这里做三件事：
 *  1. 先查 profile 到底有没有知识库能力（读 package.json，不发任务、不花 token）
 *  2. 要求 agent 在回复里带标记 KB_DOC:<handle>，用它验证真的写成功了
 *  3. 没有可用 profile 时，明确失败并退回本地文件，不假装成功
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { resolveProfileDir, resolveProfilesRoot, resolveDshHome } from './profile-path.js'
import { fileURLToPath } from 'node:url'
import { pooledFetch } from './dsh-llm.js'

const HOME = homedir()

/**
 * profiles 根目录**运行时解析**，不再写死 homedir()/.dsh/profiles。
 *
 * 事故：用户把 DSH 装在 C:\dsh\instanceA，代码却只去 C:\Users\<user>\.dsh\profiles
 * 找，于是"知识库明明装了"被判成没装，纪要生成后直接跳过写库。
 * 现在按 DSH_HOME → DSH_PROFILE_DIR → 插件自身路径 → homedir 的顺序推。
 */
function profilesRoot() {
  try {
    return resolveProfilesRoot({
      selfUrl: 'file:///' + fileURLToPath(new URL('.', import.meta.url)).replace(/\\/g, '/').replace(/^\//, '') + '/knowledge.js',
      env: process.env,
      homeDir: HOME,
      exists: existsSync,
      join,
    }) || join(HOME, '.dsh', 'profiles')
  } catch {
    return join(HOME, '.dsh', 'profiles')
  }
}

/** 读取某个 profile 的 bundles 与依赖 */
export function profileInfo(profile) {
  const dir = join(profilesRoot(), profile)
  const pkgPath = join(dir, 'package.json')
  if (!existsSync(pkgPath)) return { profile, exists: false, bundles: [], deps: [] }
  try {
    const j = JSON.parse(readFileSync(pkgPath, 'utf8').replace(/^\uFEFF/, ''))
    const bundles = (j?.dsh?.profile?.bundles || []).slice()
    const deps = Object.keys(j.dependencies || {})
    return { profile, exists: true, bundles, deps, dir }
  } catch (e) {
    return { profile, exists: true, bundles: [], deps: [], error: e.message }
  }
}

/**
 * 当前正在运行的 profile 名。
 *
 * 为什么不能写死 'web'：真实部署里 profile 名可能不叫 web
 * （例如按实例命名为 instanceA）。写死就会导致
 * hostHasKnowledge() 永远返回空 → 走 host 模式时被判"宿主没装知识库"，
 * 于是纪要生成了也不写库。
 */
export function currentProfileName() {
  try {
    const dir = resolveProfileDir({
      selfUrl: import.meta.url,
      env: process.env,
      homeDir: HOME,
      exists: existsSync,
      join,
    })
    if (!dir) return ''
    const segs = dir.split(/[\\/]+/).filter(Boolean)
    return segs[segs.length - 1] || ''
  } catch {
    return ''
  }
}

/** 这个 profile 能不能用知识库工具 */
export function profileHasKnowledge(profile) {
  const info = profileInfo(profile)
  const all = [...info.bundles, ...info.deps]
  return all.some((x) => /dsh-knowledge|knowledge/i.test(x))
}

/**
 * 挑一个真正装了知识库的 profile。
 * 注意：web 是正在跑宿主的 profile，再起一个同 profile 的 headless 进程会争用会话缓存，
 * 所以只有显式配置时才用它；自动模式优先专用 worker profile。
 */
export function pickKnowledgeProfile(preferred = '') {
  if (preferred && profileHasKnowledge(preferred)) return preferred
  // 知识库一般装在 web profile 里；允许使用，但会标记为"与宿主同 profile"
  for (const p of ['soulmirror-worker', 'headless', 'tui', 'web']) {
    if (profileHasKnowledge(p)) return p
  }
  return ''
}

/**
 * 知识库联动检测：装没装、用哪个 profile、有没有风险。
 * 没装时调用方应直接跳过该功能，不要报错。
 */
/** 当前宿主（正在运行的 profile）里有没有装知识库 —— 决定是否提示"可以让 agent 写" */
export function hostHasKnowledge() {
  // 优先用"当前实际 profile"：它才是宿主所在的那个
  const cur = currentProfileName()
  const order = []
  if (cur) order.push(cur)
  for (const p of ['web', 'tui']) if (!order.includes(p)) order.push(p)
  for (const p of order) {
    if (profileHasKnowledge(p)) return p
  }
  return ''
}

export function detectKnowledge(preferred = '') {
  const curProfile = currentProfileName()
  const candidates = [...new Set([curProfile, 'soulmirror-worker', 'web', 'headless', 'tui'].filter(Boolean))]
    .map((p) => ({ profile: p, exists: profileInfo(p).exists, hasKnowledge: profileHasKnowledge(p) }))
    .filter((x) => x.exists)
  const installed = candidates.some((x) => x.hasKnowledge)
  const pick = pickKnowledgeProfile(preferred)
  const host = hostHasKnowledge()
  return {
    installed,
    host,
    profile: pick,
    candidates,
    sameAsHost: !!pick && pick === currentProfileName(),
    reason: installed
      ? (pick === currentProfileName() ? '使用宿主所在 profile（' + pick + '，任务串行执行）' : '使用 ' + pick + ' profile')
      : '未检测到 dsh-knowledge，会后只落本地文件',
  }
}

/** 这个 profile 是否正在作为宿主运行（默认是 web，但以实际为准） */
export function isHostProfile(profile) {
  const cur = currentProfileName()
  if (cur) return String(profile || '') === cur
  return String(profile || '') === 'web'
}

/** 联动体检：给 soul_setup 用 */
export function linkStatus(twinProfile = 'headless') {
  const out = { knowledge: {}, twin: {}, others: [] }
  out.twin = profileInfo(twinProfile)
  const k = detectKnowledge('')
  out.knowledge = { candidates: k.candidates, pick: k.profile, installed: k.installed, reason: k.reason }
  for (const p of ['web']) {
    const info = profileInfo(p)
    if (info.bundles.some((b) => /computer-use/.test(b))) out.others.push('computer-use 在 ' + p + '（会抢键盘焦点，发言注入可能互相打断）')
    if (info.bundles.some((b) => /gateway/.test(b))) out.others.push('gateway 在 ' + p)
  }
  return out
}

/**
 * 把纪要写进知识库。
 * @returns {{ok:boolean, handle?:string, profile?:string, error?:string}}
 */
export async function writeToKnowledge({ title, markdown, profile, cwd, timeoutMs = 90000, runDshTask, writeFile, port, origin, fetchImpl }) {
  const target = pickKnowledgeProfile(profile)
  if (!target) {
    return { ok: false, skipped: true, error: '未安装 dsh-knowledge', profile: '', committed: false }
  }
  if (!runDshTask) return { ok: false, skipped: true, error: '缺少任务执行器', profile: target, committed: false }

  const dir = cwd || join(resolveDshHome({ selfUrl: import.meta.url, env: process.env, homeDir: HOME, exists: existsSync, join }) || join(HOME, '.dsh'), 'soulmirror', 'workspace')
  const safeName = String(title || 'minutes').replace(/[\\/:*?"<>|\s]+/g, '-').slice(0, 80) + '.md'
  const dest = join(dir, 'knowledge', safeName)
  let localSaved = false
  try {
    const { mkdirSync, writeFileSync } = await import('node:fs')
    mkdirSync(join(dir, 'knowledge'), { recursive: true })
    writeFileSync(dest, markdown, 'utf8')
    localSaved = true
  } catch (e) {
    return { ok: false, localSaved: false, committed: false, error: '本地写入失败：' + e.message, profile: target }
  }

  // 让 headless 用它的 write 工具把文件落到工作区：dsh-knowledge 会对"文件工具写入"自动归档
  const prompt = [
    '这是一次机械的文件写入任务，不要改写内容、不要提问。',
    '用 write 工具创建文件：' + dest.replace(/\\/g, '/'),
    '内容就是下面这段 Markdown（原样）：',
    '',
    markdown.slice(0, 6000),
  ].join('\n')

  const started = Date.now()
  const task = runDshTask(prompt, { profile: target, cwd: dir, timeoutMs })
  // 计时器必须能被清掉并 unref：否则进程要等它到点才退出（测试里表现成"挂住"）
  let timer = null
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve({ ok: false, error: '超时 ' + Math.round(timeoutMs / 1000) + 's（已跳过，纪要仍在本地）' }), timeoutMs + 5000)
    timer.unref?.()
  })
  const r = await Promise.race([task, timeout])
    .catch((e) => ({ ok: false, error: e.message }))
    .finally(() => { if (timer) clearTimeout(timer); timer = null })
  const ms = Date.now() - started
  const archiveQueued = !!(r && r.ok)

  // 关键修正（安全审查 P1）：**不能**用"文件存在"判断写库成功。
  // 这个文件在本函数开头就已经被我们写好了，所以 existsSync 永远是 true，
  // 即使 headless 任务完全失败也会返回 ok —— 调用方于是显示"已写入知识库"。
  // 现在的判断：本地已保存 / 归档已入队 / 知识库确认（三态分开报）。
  const result = {
    ok: false,                 // 只有"知识库确认"才算成功
    localSaved,
    archiveQueued,
    committed: false,
    localPath: dest,
    profile: target,
    ms,
    error: '',
    note: '',
  }

  if (!archiveQueued) {
    result.error = String((r && r.error) || '归档任务未成功').slice(0, 160)
    result.note = '纪要已存本地，但未能确认进入知识库'
    return result
  }

  // 归档任务报成功还不够：向知识库核验标题是否真的存在
  const known = await verifyInKnowledge({ title, port, origin, fetchImpl: fetchImpl || globalThis.fetch })
  if (known.committed) {
    result.ok = true
    result.committed = true
    result.handle = known.id || dest
    result.note = '知识库已收录'
  } else {
    result.error = known.error || '知识库未查到该条目'
    result.note = '归档任务已提交，但知识库暂未查到该条目（可能仍在索引）'
  }
  return result
}

/**
 * 核验：知识库里是否真的存在这个标题的条目。
 * 没有宿主端口时返回 {committed:false, error:'无法核验'}——宁可说"未确认"，不谎报成功。
 * @returns {Promise<{committed: boolean, id?: string, error?: string}>}
 */
export async function verifyInKnowledge({ title, port, origin, fetchImpl } = {}) {
  const doFetch = fetchImpl || globalThis.fetch
  const base = origin || (port ? 'http://127.0.0.1:' + port : '')
  if (!base) return { committed: false, error: '拿不到知识库地址，无法核验' }
  const token = String(title || '').slice(0, 200)
  if (!token) return { committed: false, error: '标题为空，无法核验' }
  try {
    const res = await doFetch(base + '/knowledge-local/v1/entries?limit=100', {
      headers: { 'x-dsh-knowledge-client': 'management-web' },
    })
    if (!res.ok) return { committed: false, error: '查询知识库失败 HTTP ' + res.status }
    const j = await res.json().catch(() => null)
    const items = (j && (j.items || j)) || []
    const hit = (Array.isArray(items) ? items : []).find((x) => x && String(x.title || '').includes(token))
    if (hit) return { committed: true, id: hit.id }
    return { committed: false, error: '知识库里没有「' + token + '」' }
  } catch (e) {
    return { committed: false, error: e.message }
  }
}


/**
 * 通过宿主内知识库插件的本地管理 API 直接写入（推荐路径）。
 * 需要：
 *  - 宿主 profile 里装了 dsh-knowledge（它注册了 /knowledge-local/v1）
 *  - 请求带 x-dsh-knowledge-client: management-web（同源管理端身份）
 * 不依赖额外的 profile，也不会多起一个 DSH 进程。
 */
export async function writeViaHostApi({ port, origin, title, markdown, knowledgeBaseId, group = '会议纪要', type = 'decision', fetchImpl } = {}) {
  if (!port) return { ok: false, error: '拿不到宿主端口' }
  const base = origin || ('http://127.0.0.1:' + port)
  const url = base + '/knowledge-local/v1/entries'
  const body = {
    draft: {
      title: String(title || '').slice(0, 200),
      body: String(markdown || '').slice(0, 50000),
      type,
      tags: ['会议纪要', 'AI生成'],
      ...(group ? { group } : {}),
      scope: { kind: 'global' },
      // 会议纪要是模型从转写生成的，不是人工核实的事实：
      // 标 inferred + 中等置信度，并保留来源标签，避免被下游当成"已验证"
      confidence: 0.6,
      source: { evidence: 'inferred' },
      ...(knowledgeBaseId ? { knowledgeBaseId } : {}),
    },
  }
  const doFetch = fetchImpl || globalThis.fetch
  try {
    const res = await pooledFetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-dsh-knowledge-client': 'management-web',
      },
      body: JSON.stringify(body),
    }, { fetchImpl: doFetch, timeoutMs: 20_000 })
    const text = await res.text()
    if (!res.ok) return { ok: false, status: res.status, error: text.slice(0, 200) }
    let json = {}
    try { json = JSON.parse(text) } catch { /* ignore */ }
    return { ok: true, status: res.status, id: json.id || json.handle || '', title: json.title || body.draft.title }
  } catch (e) {
    return { ok: false, error: e.message }
  }
}

/** 解析知识库本地 HTTP 服务根地址 */
function resolveKnowledgeBaseUrl({ port, origin } = {}) {
  if (origin && String(origin).trim()) return String(origin).trim().replace(/\/+$/, '')
  if (port) return 'http://127.0.0.1:' + port
  return ''
}

/** 归一化知识库 FTS 搜索返回条目 */
function normalizeSearchItem(raw) {
  if (!raw || typeof raw !== 'object') return null
  const entry = raw.entry && typeof raw.entry === 'object' ? raw.entry : raw
  const title = String(entry.title || raw.title || raw.relPath || '').trim()
  const snippet = String(raw.snippet || entry.body || entry.summary || raw.content || '').trim()
  if (!title && !snippet) return null
  return {
    id: String(entry.id || raw.id || ''),
    title,
    snippet: snippet.slice(0, 400),
    score: Number.isFinite(Number(raw.score)) ? Number(raw.score) : 0,
    tags: Array.isArray(entry.tags) ? entry.tags : [],
    type: String(entry.type || raw.type || ''),
    knowledgeBaseId: String(entry.knowledgeBaseId || raw.knowledgeBaseId || ''),
    relPath: String(entry.relPath || raw.relPath || ''),
  }
}

/**
 * 直连 dsh-knowledge 的本地 HTTP/FTS 搜索接口（POST /knowledge-local/v1/search）。
 * 替代慢速 Agent 任务，实现 <50ms 本地毫秒级知识召回。
 */
export async function searchKnowledge({
  query = '',
  port,
  origin,
  projectId,
  knowledgeBaseIds = [],
  includeTags = [],
  excludeTags = [],
  types = [],
  limit = 8,
  timeoutMs = 3000,
  fetchImpl,
} = {}) {
  const started = Date.now()
  const base = resolveKnowledgeBaseUrl({ port, origin })
  if (!base) return { ok: false, items: [], ms: 0, error: '未配置知识库地址（port/origin）' }
  const text = String(query || '').trim()
  if (!text) return { ok: true, items: [], ms: 0 }

  const headers = {
    'content-type': 'application/json',
    'x-dsh-knowledge-client': 'management-web',
  }
  const payload = {
    text,
    ...(projectId ? { projectId } : {}),
    ...(knowledgeBaseIds.length ? { knowledgeBaseIds } : {}),
    ...(includeTags.length ? { includeTags } : {}),
    ...(excludeTags.length ? { excludeTags } : {}),
    ...(types.length ? { types } : {}),
    limit: Math.max(1, Math.min(50, Number(limit) || 8)),
  }

  try {
    let res = await pooledFetch(
      base + '/knowledge-local/v1/search',
      { method: 'POST', headers, body: JSON.stringify(payload) },
      { fetchImpl, timeoutMs, maxAttempts: 2 },
    )
    // 兼容仅支持 GET 查询参数的旧版知识库端点
    if (res.status === 405 || res.status === 404) {
      const qs = new URLSearchParams({ q: text, limit: String(payload.limit) })
      res = await pooledFetch(
        base + '/knowledge-local/v1/search?' + qs.toString(),
        { method: 'GET', headers: { 'x-dsh-knowledge-client': 'management-web' } },
        { fetchImpl, timeoutMs, maxAttempts: 2 },
      )
    }
    if (!res.ok) {
      return { ok: false, items: [], ms: Date.now() - started, status: res.status, error: '知识库检索失败 HTTP ' + res.status }
    }
    const json = await res.json().catch(() => null)
    const rawList = Array.isArray(json) ? json : (Array.isArray(json?.items) ? json.items : (Array.isArray(json?.results) ? json.results : []))
    const items = rawList.map(normalizeSearchItem).filter(Boolean)
    return { ok: true, items, ms: Date.now() - started }
  } catch (e) {
    return { ok: false, items: [], ms: Date.now() - started, error: e.message }
  }
}

/**
 * 面向语音润色、划词 QA 与会中建议的实时知识召回。
 * 自动截断总字数，返回紧凑引用片段与抽提出的高频术语热词。
 */
export async function recallForContext({
  query = '',
  cursorContext = '',
  port,
  origin,
  projectId,
  knowledgeBaseIds = [],
  limit = 5,
  maxChars = 1400,
  timeoutMs = 2000,
  fetchImpl,
} = {}) {
  const combined = [String(query || '').trim(), String(cursorContext || '').trim().slice(0, 120)]
    .filter(Boolean)
    .join(' ')
    .slice(0, 300)
  if (!combined) return { ok: true, snippets: [], hotwords: [], items: [], ms: 0 }

  const res = await searchKnowledge({
    query: combined,
    port,
    origin,
    projectId,
    knowledgeBaseIds,
    limit,
    timeoutMs,
    fetchImpl,
  })
  if (!res.ok) return { ok: false, snippets: [], hotwords: [], items: [], ms: res.ms, error: res.error }

  const snippets = []
  const hotwordSet = new Set()
  let used = 0
  for (const item of res.items) {
    const line = `- [${item.title || '文档'}] ${item.snippet.replace(/\s+/g, ' ').slice(0, 260)}`
    if (used + line.length > maxChars) break
    snippets.push(line)
    used += line.length
    for (const tag of item.tags || []) {
      const t = String(tag || '').trim()
      if (t.length >= 2 && t.length <= 24) hotwordSet.add(t)
    }
  }
  return {
    ok: true,
    snippets,
    hotwords: [...hotwordSet].slice(0, 20),
    items: res.items,
    ms: res.ms,
  }
}

/**
 * 一键沉淀到知识库（划词 QA 结论 / 术语确认 / 会议要点），完全走 HTTP API，不走 runDshTask。
 */
export async function depositToKnowledge({
  title,
  content,
  type = 'fact',
  tags = ['SoulMirror', '一键沉淀'],
  group = '划词沉淀',
  confidence = 0.85,
  evidence = 'confirmed',
  port,
  origin,
  knowledgeBaseId,
  fetchImpl,
} = {}) {
  const base = resolveKnowledgeBaseUrl({ port, origin })
  if (!base) return { ok: false, committed: false, error: '拿不到知识库 HTTP 地址（port/origin）' }
  const cleanTitle = String(title || '').trim().slice(0, 200)
  const cleanBody = String(content || '').trim().slice(0, 50_000)
  if (!cleanTitle || !cleanBody) return { ok: false, committed: false, error: '标题或内容为空' }

  const body = {
    draft: {
      title: cleanTitle,
      body: cleanBody,
      type,
      tags: Array.isArray(tags) && tags.length ? tags : ['SoulMirror'],
      ...(group ? { group } : {}),
      scope: { kind: 'global' },
      confidence: Math.max(0.1, Math.min(1, Number(confidence) || 0.85)),
      source: { evidence },
      ...(knowledgeBaseId ? { knowledgeBaseId } : {}),
    },
  }
  try {
    const res = await pooledFetch(
      base + '/knowledge-local/v1/entries',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-dsh-knowledge-client': 'management-web',
        },
        body: JSON.stringify(body),
      },
      { fetchImpl, timeoutMs: 10_000, maxAttempts: 2 },
    )
    const text = await res.text()
    if (!res.ok) return { ok: false, committed: false, status: res.status, error: text.slice(0, 200) }
    let json = {}
    try { json = JSON.parse(text) } catch { /* ignore */ }
    return {
      ok: true,
      committed: true,
      status: res.status,
      id: json.id || json.handle || '',
      title: json.title || cleanTitle,
    }
  } catch (e) {
    return { ok: false, committed: false, error: e.message }
  }
}

/**
 * 写库优先走直接 HTTP API（毫秒级，替代 runDshTask）；仅当未提供 HTTP 地址时才回退旧任务模式。
 */
export async function writeDirectOrFallback(opts = {}) {
  const base = resolveKnowledgeBaseUrl(opts)
  if (base) {
    const r = await writeViaHostApi({
      port: opts.port || 1,
      origin: base,
      title: opts.title,
      markdown: opts.markdown,
      knowledgeBaseId: opts.knowledgeBaseId,
      group: opts.group || '会议纪要',
      type: opts.type || 'decision',
      fetchImpl: opts.fetchImpl,
    })
    if (r.ok) {
      return {
        ok: true,
        via: 'direct-http',
        localSaved: false,
        archiveQueued: true,
        committed: true,
        handle: r.id || '',
        title: r.title || opts.title,
        note: '已通过知识库直连 HTTP API 收录',
      }
    }
    if (!opts.runDshTask) {
      return { ok: false, via: 'direct-http', committed: false, error: r.error || '直连写库失败' }
    }
  }
  return writeToKnowledge(opts)
}
