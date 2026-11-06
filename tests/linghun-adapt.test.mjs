import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  DEFAULT_USER_CARD, DEFAULT_ARCHITECTURE, ensureSoulCard, resolveUserCard,
  composeSoulPrompt, foldStableTraits,
} from '../lib/soul-card.js'
import {
  classifyKind, writeRule, writeKnowledge, writeMemory, readRules, renderRules,
  hitRules, routeItem, ontologyStatus, KIND,
} from '../lib/tripartite.js'

/**
 * 借鉴 syyr1987/dsh-linghun 的两处核心设计（AGPL-3.0）：
 *   1. 两层身份：用户卡（只填四个空）+ 认知架构（插件垫底，不被覆盖）
 *   2. 三分法本体：技术知识 / 项目记忆 / 经验规则分开存
 *
 * 为什么值得抄：混在一起的后果是"三个月前的进展被当成当前状态"、
 * "随口一句被当成规则"，模型只能一起信。
 */

function withDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'sm-linghun-'))
  try { return fn(dir) } finally { rmSync(dir, { recursive: true, force: true }) }
}

test('用户卡只有四个空，且不含认知纪律', () => {
  assert.match(DEFAULT_USER_CARD, /名字：/)
  assert.match(DEFAULT_USER_CARD, /性格：/)
  assert.match(DEFAULT_USER_CARD, /沟通风格：/)
  assert.match(DEFAULT_USER_CARD, /其他：/)
  assert.equal(/承接即预检/.test(DEFAULT_USER_CARD), false, '纪律不该写进用户卡')
})

test('认知架构包含承接即预检与失守信号', () => {
  assert.match(DEFAULT_ARCHITECTURE, /承接即预检/)
  assert.match(DEFAULT_ARCHITECTURE, /复述/)
  assert.match(DEFAULT_ARCHITECTURE, /失守信号/)
  assert.match(DEFAULT_ARCHITECTURE, /影子/, '应交代"她是主体，你是影子"')
})

test('首次运行落一份模板，改完即生效（文件优先）', () => withDir((dir) => {
  const r = ensureSoulCard(dir)
  assert.equal(r.created, true)
  assert.ok(existsSync(join(dir, 'USER-CARD.md')))

  writeFileSync(join(dir, 'USER-CARD.md'), '# 我的灵魂卡\n\n名字：老王\n性格：直\n沟通风格：短句\n', 'utf8')
  const card = resolveUserCard({ dir })
  assert.equal(card.source, 'file')
  assert.match(card.text, /老王/)
}))

test('没有文件时用配置，再没有才用默认', () => withDir((dir) => {
  ensureSoulCard(dir)
  // 文件存在但为空 → 走配置
  writeFileSync(join(dir, 'USER-CARD.md'), '   ', 'utf8')
  assert.equal(resolveUserCard({ dir, settings: '名字：配置里的人' }).source, 'settings')
  assert.equal(resolveUserCard({ dir: '' }).source, 'default')
}))

test('合成时用户卡在上、架构在下，且不覆盖', () => {
  const text = composeSoulPrompt({ userCard: '名字：老王\n性格：直接', architecture: DEFAULT_ARCHITECTURE })
  const iCard = text.indexOf('老王')
  const iArch = text.indexOf('承接即预检')
  assert.ok(iCard > 0 && iArch > iCard, '用户卡应在架构之前')
  assert.match(text, /关于她/)
})

test('用户卡还是空模板时，明确叫模型别编造身份', () => {
  const text = composeSoulPrompt({ userCard: DEFAULT_USER_CARD })
  assert.match(text, /还没填灵魂卡/)
  assert.match(text, /不要编造/)
})

test('稳定特质能折叠进用户卡，不覆盖手写内容', () => withDir((dir) => {
  ensureSoulCard(dir)
  writeFileSync(join(dir, 'USER-CARD.md'), '# 我的灵魂卡\n\n名字：老王\n', 'utf8')
  const r = foldStableTraits({ dir, lines: ['先给结论再展开', '不接受没有负责人的决定'] })
  assert.equal(r.folded, 2)
  const body = readFileSync(join(dir, 'USER-CARD.md'), 'utf8')
  assert.match(body, /名字：老王/, '手写内容必须保留')
  assert.match(body, /自动沉淀/)
  assert.match(body, /先给结论再展开/)

  // 再折一次同样的内容 → 不重复
  const r2 = foldStableTraits({ dir, lines: ['先给结论再展开'] })
  assert.equal(r2.folded, 0)
  assert.equal(r2.skipped, 1)
}))

test('三分法分类：经验→规则、通用知识→知识、进展→记忆', () => {
  assert.equal(classifyKind({ text: '以后遇到延期先给替代方案' }), KIND.rule)
  assert.equal(classifyKind({ text: 'WebSocket 要按帧解析，不能按行读' }), KIND.knowledge)
  assert.equal(classifyKind({ text: '这个项目本周上线灰度' }), KIND.memory)
  // 立场天然是规则；状态天然是记忆
  assert.equal(classifyKind({ text: '随便什么', section: 'stance' }), KIND.rule)
  assert.equal(classifyKind({ text: '随便什么', section: 'state' }), KIND.memory)
})

test('规则按主题聚合、去重、有配额', () => withDir((dir) => {
  assert.equal(writeRule({ dir, topic: '延期', text: '先给替代方案再报风险' }).added, true)
  assert.equal(writeRule({ dir, topic: '延期', text: '先给替代方案再报风险' }).added, false, '重复应跳过')
  for (let i = 0; i < 12; i++) writeRule({ dir, topic: '延期', text: '规则 ' + i, maxPerTopic: 8 })
  const rules = readRules({ dir })
  assert.equal(rules.length, 1, '同主题应聚合')
  assert.ok(rules[0].items.length <= 8, '应有配额，实际 ' + rules[0].items.length)
}))

test('知识与记忆分开落盘，记忆按日期分文件', () => withDir((dir) => {
  writeKnowledge({ dir, topic: '协议', text: '帧头两字节是长度' })
  writeMemory({ dir, text: '本周灰度上线', at: Date.parse('2026-11-06T10:00:00Z') })
  const st = ontologyStatus(dir)
  assert.equal(st.knowledge, true)
  assert.equal(st.rules, false, '没写规则就不该有 rules.md')
  assert.equal(st.memoryFiles, 1)
}))

test('routeItem 按分类落对地方', () => withDir((dir) => {
  const a = routeItem({ dir, item: { text: '以后先确认负责人再定时间' } })
  assert.equal(a.kind, KIND.rule)
  const b = routeItem({ dir, item: { text: 'HTTP 429 是限流' } })
  assert.equal(b.kind, KIND.knowledge)
  const c = routeItem({ dir, item: { text: '下周评审这个方案' } })
  assert.equal(c.kind, KIND.memory)
}))

test('规则注入：渲染带主题，别名命中能挑出相关规则', () => {
  const rules = [{ topic: '延期处理', items: ['先给替代方案再报风险'] }]
  const text = renderRules(rules)
  assert.match(text, /经验规则/)
  assert.match(text, /延期处理/)

  assert.equal(hitRules('这个延期怎么处理', rules).length, 1, '主题命中')
  assert.equal(hitRules('今天天气不错', rules).length, 0, '无关问题不该命中')
})
