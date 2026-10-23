import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LivingMemory, BeliefGarden, EmotionWorld, LivingWorld, detectEmotion } from '../lib/living.js'

const tmp = () => mkdtempSync(join(tmpdir(), 'sm-living-'))
const DAY = 86400000

test('记忆：新记忆为 bloom，活力接近满', () => {
  const dir = tmp()
  const m = new LivingMemory(join(dir, 'm.json'))
  const e = m.add('预算下周三确认')
  assert.equal(e.stage, 'bloom')
  assert.ok(e.vitality >= 0.6)
  rmSync(dir, { recursive: true, force: true })
})

test('记忆：长时间不碰会沉睡，被想起会复苏', () => {
  const dir = tmp()
  const m = new LivingMemory(join(dir, 'm.json'), { halfLifeMs: DAY })
  const e = m.add('上线时间周日')
  e.lastAt = Date.now() - 12 * DAY
  const r = m.decay()
  assert.equal(r.slept, 1)
  assert.equal(m.entries[0].stage, 'sleep')
  m.recall(e.id, 1)
  assert.ok(['awake', 'bloom'].includes(m.entries[0].stage))
  rmSync(dir, { recursive: true, force: true })
})

test('记忆：breathe 取最鲜活并顺手复苏', () => {
  const dir = tmp()
  const m = new LivingMemory(join(dir, 'm.json'))
  m.add('A', { weight: 0.3 })
  m.add('B', { weight: 0.9 })
  const top = m.breathe(1)
  assert.equal(top[0].text, 'B')
  assert.ok(top[0].recalls >= 1)
  rmSync(dir, { recursive: true, force: true })
})

test('信念：强化长成大树，强反驳会死亡', () => {
  const dir = tmp()
  const g = new BeliefGarden(join(dir, 'b.json'))
  const b = g.seed('先做记忆再做日程')
  assert.equal(b.stage, 'seed')
  g.reinforce(b.id, 't', 0.3)
  g.reinforce(b.id, 't', 0.3)
  assert.equal(g.beliefs[0].stage, 'tree')
  g.weaken(b.id, 't', 1)
  assert.equal(g.beliefs[0].stage, 'dead')
  assert.equal(g.alive().length, 0)
  rmSync(dir, { recursive: true, force: true })
})

test('信念：重复种下同一句会转成强化，不重复建树', () => {
  const dir = tmp()
  const g = new BeliefGarden(join(dir, 'b.json'))
  g.seed('同一句')
  g.seed('同一句')
  assert.equal(g.beliefs.length, 1)
  assert.ok(g.beliefs[0].strength > 0.3)
  rmSync(dir, { recursive: true, force: true })
})

test('情绪：地形按主导情绪着色，议会按强度排序', () => {
  const dir = tmp()
  const w = new EmotionWorld(join(dir, 'e.json'))
  for (let i = 0; i < 5; i++) w.feel('joy', 0.9)
  w.feel('anger', 0.2)
  const terrain = w.terrain()
  assert.equal(terrain.dominant, 'joy')
  assert.equal(terrain.cells.length, terrain.grid)
  const council = w.council()
  assert.equal(council[0].emotion, 'joy')
  rmSync(dir, { recursive: true, force: true })
})

test('情绪词典：能识别正负线索', () => {
  assert.equal(detectEmotion('太好了，搞定了').emotion, 'joy')
  assert.equal(detectEmotion('这个风险我担心').emotion, 'fear')
  assert.equal(detectEmotion('凭什么这样安排').emotion, 'anger')
})

test('LivingWorld：absorb 同时写记忆与情绪，snapshot 结构完整', () => {
  const dir = tmp()
  const w = new LivingWorld(dir)
  w.absorb('这个方案的风险有点大', { speaker: '亚峰' })
  const snap = w.snapshot()
  assert.equal(snap.memory.total, 1)
  assert.ok(snap.council.length >= 1)
  assert.equal(typeof snap.terrain.dominant, 'string')
  assert.ok(Array.isArray(snap.buildings))
  const breath = w.breathe()
  assert.equal(typeof breath.decay.total, 'number')
  rmSync(dir, { recursive: true, force: true })
})

test('LivingWorld：重启后数据仍在', () => {
  const dir = tmp()
  const a = new LivingWorld(dir)
  a.absorb('记住这句')
  a.beliefs.seed('信念持久化')
  const b = new LivingWorld(dir)
  assert.equal(b.memory.entries.length, 1)
  assert.equal(b.beliefs.beliefs.length, 1)
  rmSync(dir, { recursive: true, force: true })
})
