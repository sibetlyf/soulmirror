/**
 * 灵魂卡：把"用户是谁"和"认知架构"分开注入。
 *
 * 结构借鉴 syyr1987/dsh-linghun 的两层设计（AGPL-3.0），按会议场景裁剪：
 *   - USER CARD：用户只填四件事（名字 / 性格 / 沟通风格 / 其他）
 *   - ARCHITECTURE：插件自动垫底的认知纪律，用户不用写，也不该被覆盖
 *
 * 为什么必须分开：
 *   1. 用户不该为了"让它像自己"去学一套提示词工程 —— 只填 4 个空就够
 *   2. 架构是**纪律**，不是人格；混进用户卡里会被一次随手编辑删掉
 *   3. 两者合并注入时"用户在上、架构在下"，不冲突、不覆盖
 *
 * 解析优先级（借鉴 linghun）：文件 > 配置 > 默认卡
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** 用户卡模板：只留四个空 */
export const DEFAULT_USER_CARD = `# 我的灵魂卡

名字：（你的名字或称呼）
性格：（几句话描述你自己）
沟通风格：（说话习惯，比如：短句、先说结论、不爱客套）
其他：（想写什么写什么，没有就不填）

## 我在会上最在意的
（可选，两三句：你最怕会议里出什么事？比如"决定没落到人头上"）

## 我不会说的话
（可选：明确不想让对方用你的口气说的话，例如"不承诺具体日期"）
`

/**
 * 认知架构：会议场景的纪律。
 *
 * 从 linghun 的"承接即预检"裁剪而来，只留会议里真正用得上的三步：
 * 复述 → 类型判断 → 失守自查。
 */
export const DEFAULT_ARCHITECTURE = `# 认知架构（自动注入，无需填写）

你不是转写器，也不只是摘要器。你是**以她的身份在场**的助理：
模型提供素材与候选表达，判断与收口在你这里完成。

## 承接即预检
接到任何要你"替她说"或"替她判断"的事，先过三步：
1. **复述**：一句话说清我要做什么，并标出我自己补上的假设
2. **类型**：这是哪种情况——事实问题 / 意见分歧 / 两难取舍 / 局面僵持 / 例行推进
3. **自查**：我是不是在用"显然/必然"武断？是不是为了自洽硬选一条路？

## 她是主体，你是影子
- 有不确定的，先问，不要替她拍板
- 说"她大概会这么说"，而不是"她就是这么想的"
- 宁可少说一句，不要替她多承诺一件

## 失守信号（出现即停）
- 用她的名义承诺了时间、金额、人力
- 把别人的观点说成她的立场
- 为了显得像她而模仿口头禅，却丢了判断
`

/** 读文件，失败返回空串 */
function tryRead(file) {
  try { return readFileSync(file, 'utf8').replace(/^\uFEFF/, '') } catch { return '' }
}

/** 首次运行：落一份模板，让用户改（改完即生效） */
export function ensureSoulCard(dir) {
  try { mkdirSync(dir, { recursive: true }) } catch { /* ignore */ }
  const file = join(dir, 'USER-CARD.md')
  if (!existsSync(file)) {
    try { writeFileSync(file, DEFAULT_USER_CARD, 'utf8') } catch { /* ignore */ }
    return { created: true, path: file }
  }
  return { created: false, path: file }
}

/**
 * 解析用户卡：文件 > 配置 > 默认模板。
 * @param {{dir?: string, settings?: string, readFile?: Function, exists?: Function}} o
 */
export function resolveUserCard({ dir = '', settings = '' } = {}) {
  const fromSettings = String(settings || '').trim()
  const fromFile = dir ? tryRead(join(dir, 'USER-CARD.md')).trim() : ''
  if (fromFile) return { text: fromFile, source: 'file' }
  if (fromSettings) return { text: fromSettings, source: 'settings' }
  return { text: DEFAULT_USER_CARD, source: 'default' }
}

/**
 * 合成最终注入块：用户卡在上，认知架构垫底。
 * 用户卡若还是空模板（只有占位），明确告诉模型"她还什么都没填"，
 * 免得模型把"（你的名字或称呼）"当成真名。
 */
export function composeSoulPrompt({ userCard = '', architecture = DEFAULT_ARCHITECTURE } = {}) {
  const card = String(userCard || '').trim()
  const looksTemplate = /（你的名字或称呼）|（几句话描述你自己）/.test(card) && card.length < 400
  const head = looksTemplate
    ? '# 关于她\n（她还没填灵魂卡，别假设她是谁；按事实说话，不要编造她的身份与偏好）'
    : '# 关于她\n' + card
  return head + '\n\n' + String(architecture || '').trim()
}

/**
 * 稳定特质折叠：把反复被强化的条目写回用户卡末尾（不覆盖手写内容）。
 * 借鉴 linghun 的 soul_update 思路——稳定的才有资格进卡。
 *
 * @param {{dir: string, lines: string[], maxLines?: number}} o
 * @returns {{folded: number, skipped: number, path: string}}
 */
export function foldStableTraits({ dir, lines = [], maxLines = 12 }) {
  const file = join(dir, 'USER-CARD.md')
  const body = tryRead(file) || DEFAULT_USER_CARD
  const marker = '\n## 自动沉淀（反复出现，已稳定）\n'
  const idx = body.indexOf(marker)
  const base = idx >= 0 ? body.slice(0, idx) : body
  const old = idx >= 0 ? body.slice(idx + marker.length) : ''
  const existing = new Set(
    old.split('\n').map((l) => l.replace(/^-\s*/, '').trim()).filter(Boolean),
  )
  let folded = 0
  let skipped = 0
  for (const raw of lines) {
    const text = String(raw || '').trim()
    if (!text) continue
    if (existing.has(text)) { skipped += 1; continue }
    existing.add(text)
    folded += 1
  }
  if (!folded) return { folded: 0, skipped, path: file }
  const next = base.trimEnd() + marker + Array.from(existing).slice(0, maxLines).map((x) => '- ' + x).join('\n') + '\n'
  try { writeFileSync(file, next, 'utf8') } catch { return { folded: 0, skipped, path: file } }
  return { folded, skipped, path: file }
}
