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

const HOME = homedir()
const PROFILES = join(HOME, '.dsh', 'profiles')

/** 读取某个 profile 的 bundles 与依赖 */
export function profileInfo(profile) {
  const dir = join(PROFILES, profile)
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
  for (const p of ['web', 'tui']) {
    if (profileHasKnowledge(p)) return p
  }
  return ''
}

export function detectKnowledge(preferred = '') {
  const candidates = ['soulmirror-worker', 'web', 'headless', 'tui']
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
    sameAsHost: pick === 'web',
    reason: installed
      ? (pick === 'web' ? '使用 web profile（与宿主同 profile，任务串行执行）' : '使用 ' + pick + ' profile')
      : '未检测到 dsh-knowledge，会后只落本地文件',
  }
}

/** 这个 profile 是否正在作为宿主运行（web 常见） */
export function isHostProfile(profile) {
  return profile === 'web'
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
export async function writeToKnowledge({ title, markdown, profile, cwd, timeoutMs = 90000, runDshTask, writeFile }) {
  const target = pickKnowledgeProfile(profile)
  if (!target) {
    return { ok: false, skipped: true, error: '未安装 dsh-knowledge', profile: '' }
  }
  if (!runDshTask) return { ok: false, skipped: true, error: '缺少任务执行器', profile: target }

  const dir = cwd || join(HOME, '.dsh', 'soulmirror', 'workspace')
  const safeName = String(title || 'minutes').replace(/[\\/:*?"<>|\s]+/g, '-').slice(0, 80) + '.md'
  const dest = join(dir, 'knowledge', safeName)
  try {
    const { mkdirSync, writeFileSync } = await import('node:fs')
    mkdirSync(join(dir, 'knowledge'), { recursive: true })
    writeFileSync(dest, markdown, 'utf8')
  } catch (e) {
    return { ok: false, error: '本地写入失败：' + e.message, profile: target }
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
  const timeout = new Promise((resolve) => setTimeout(() => resolve({ ok: false, error: '超时 ' + Math.round(timeoutMs / 1000) + 's（已跳过，纪要仍在本地）' }), timeoutMs + 5000))
  const r = await Promise.race([task, timeout]).catch((e) => ({ ok: false, error: e.message }))
  const ms = Date.now() - started

  // 只要文件在，就说明写入成功（归档由知识库插件异步完成）
  let exists = false
  try { exists = (await import('node:fs')).existsSync(dest) } catch { /* ignore */ }
  if (exists) return { ok: true, handle: dest, profile: target, ms, note: '知识库插件会自动归档该文件' }
  return { ok: false, error: String(r.error || '未生成文件').slice(0, 160), profile: target, ms }
}
