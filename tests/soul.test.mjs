import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LivingWorld } from '../lib/living.js'

/**
 * 「魂」的四根柱子：人格 / 记忆 / 信念 / 情绪。
 *
 * 这里测的是**能力真实存在**，以及它真的接在会上：
 * 之前活数据层只有 breathe/snapshot，会中既不记忆也不感知情绪，
 * 于是"有魂"只停留在文档里。
 */

const src = readFileSync(new URL('../index.js', import.meta.url), 'utf8')

function world() {
  const dir = mkdtempSync(join(tmpdir(), 'sm-soul-'))
  return { w: new LivingWorld(dir), dir }
}

test('记忆会呼吸：记下来、能衰减', () => {
  const { w, dir } = world()
  try {
    w.absorb('这个方案下周一上线', { source: 'meeting' })
    w.absorb('预算还需要再确认', { source: 'meeting' })
    const s = w.snapshot()
    assert.equal(s.memory.total, 2, '两条话应记住两条')

    const r = w.breathe()
    assert.ok(typeof r.decay.slept === 'number', '呼吸应返回沉睡记忆数')
    assert.ok(typeof r.wither.died === 'number', '呼吸应返回枯萎信念数')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('情绪成地形：愤怒会长出火山，喜悦会长出光原', () => {
  const { w, dir } = world()
  try {
    w.absorb('这完全不能接受，我很生气', { source: 'meeting', speaker: '张三' })
    w.absorb('太好了，终于上线了', { source: 'meeting', speaker: '李四' })
    const s = w.snapshot()
    const names = (s.council || []).map((x) => x.emotion)
    assert.ok(names.includes('anger'), '应感知到愤怒')
    assert.ok(names.includes('joy'), '应感知到喜悦')
    const biomes = (s.council || []).map((x) => x.biome)
    assert.ok(biomes.some((b) => /火山|光原/.test(b)), '情绪应长成地貌，实际：' + biomes.join(','))
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('信念会进化：seed → 强化 → 升阶；反驳 → 枯萎', () => {
  const { w, dir } = world()
  try {
    const b = w.beliefs.seed('这个项目要慢一点')
    assert.equal(b.stage, 'seed')
    assert.ok(Math.abs(b.strength - 0.3) < 0.01)

    for (let i = 0; i < 3; i++) w.beliefs.reinforce(b.id, 'meeting', 0.2)
    const grown = w.beliefs.beliefs.find((x) => x.id === b.id)
    assert.notEqual(grown.stage, 'seed', '强化后应升阶，实际 ' + grown.stage)
    assert.ok(grown.strength > 0.3)

    for (let i = 0; i < 5; i++) w.beliefs.weaken(b.id, 'contradict', 0.25)
    const dead = w.beliefs.beliefs.find((x) => x.id === b.id)
    assert.equal(dead.stage, 'dead', '被持续反驳应枯萎')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('会议里每句话都会喂给魂（记忆 + 情绪），且不花模型调用', () => {
  // 接线点：落账之后调用 absorb，且排除助手自己的话与断点标记
  const at = src.indexOf('living.absorb(')
  assert.ok(at > 0, '会议流水没有调用 living.absorb，魂吃不到东西')
  const seg = src.slice(Math.max(0, at - 400), at + 200)
  assert.match(seg, /item\.role !== 'assistant'/, '不该把助手自己的话再喂回去')
  assert.match(seg, /item\.src !== 'gap'/, '断点标记不该当成人话')
  assert.match(seg, /try \{/, '魂不该因为出错挡住会议')
})

test('有 soul_belief 工具可手动种下/强化/反驳信念', () => {
  assert.match(src, /name: 'soul_belief'/, '缺少信念工具')
  const at = src.indexOf("name: 'soul_belief'")
  const seg = src.slice(at, at + 900)
  assert.match(seg, /'seed'/, '缺少 seed')
  assert.match(seg, /'reinforce'/, '缺少 reinforce')
  assert.match(seg, /'weaken'/, '缺少 weaken')
})

test('四层人格文件齐全（SOUL / IDENTITY / USER / STATE）', () => {
  const persona = readFileSync(new URL('../lib/persona.js', import.meta.url), 'utf8')
  for (const f of ['SOUL.md', 'IDENTITY.md', 'USER.md', 'STATE.md']) {
    assert.ok(persona.includes(f), '人格缺一层：' + f)
  }
})

test('会后人话会写进 USER 与 STATE（人格会长）', () => {
  const at = src.indexOf('personaAutoUpdate && md && completer')
  assert.ok(at > 0, '找不到人格自动更新')
  // 会后更新块变长了（结构化提取 + markdown 追加），窗口要足够大
  const seg = src.slice(at, at + 4000)
  assert.match(seg, /appendPersonaSection\(personaDir, 'user'/, '应更新 USER')
  assert.match(seg, /appendPersonaSection\(personaDir, 'state'/, '应更新 STATE')
})
