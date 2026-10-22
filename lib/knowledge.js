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
  for (const p of ['soulmirror-worker', 'headless', 'tui']) {
    if (profileHasKnowledge(p)) return p
  }
  return ''
}

/** 这个 profile 是否正在作为宿主运行（web 常见） */
export function isHostProfile(profile) {
  return profile === 'web'
}

/** 联动体检：给 soul_setup 用 */
export function linkStatus(twinProfile = 'headless') {
  const out = { knowledge: {}, twin: {}, others: [] }
  out.twin = profileInfo(twinProfile)
  out.knowledge.candidates = ['headless', 'web', 'tui']
    .map((p) => ({ profile: p, exists: profileInfo(p).exists, hasKnowledge: profileHasKnowledge(p) }))
    .filter((x) => x.exists)
  out.knowledge.pick = pickKnowledgeProfile('')
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
export async function writeToKnowledge({ title, markdown, profile, cwd, timeoutMs = 180000, runDshTask }) {
  const target = pickKnowledgeProfile(profile)
  if (!target) {
    return { ok: false, error: '没有装了 dsh-knowledge 的 profile（headless 默认没有）', profile: '' }
  }
  if (!runDshTask) return { ok: false, error: '缺少任务执行器', profile: target }
  const prompt = [
    '把下面这篇会议纪要写入知识库，用知识库工具创建一篇文档。',
    '标题：' + title,
    '分组：会议纪要',
    '正文原样使用，不要改写。',
    '完成后，最后一行必须输出 KB_DOC:<文档句柄或路径>，写不出来就输出 KB_FAIL:<原因>。',
    '',
    markdown.slice(0, 6000),
  ].join('\n')
  const r = await runDshTask(prompt, {
    profile: target,
    cwd,
    timeoutMs,
  }).catch((e) => ({ ok: false, error: e.message }))

  const text = String(r.output || r.text || '')
  const m = /KB_DOC:\s*(\S+)/.exec(text)
  const fail = /KB_FAIL:\s*(.+)/.exec(text)
  if (m) return { ok: true, handle: m[1], profile: target }
  if (fail) return { ok: false, error: fail[1].slice(0, 160), profile: target }
  if (!r.ok) return { ok: false, error: String(r.error || '任务失败').slice(0, 160), profile: target }
  return { ok: false, error: '任务跑完了但没拿到 KB_DOC 标记，无法确认已入库', profile: target }
}
