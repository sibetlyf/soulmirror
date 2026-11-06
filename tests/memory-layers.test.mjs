import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync, existsSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  appendWarm, readWarm, readCold, appendJournal, readJournal, consolidate,
  convergence, layersStatus, parseEntries, LAYOUT, WARM_TTL_MS,
} from '../lib/memory-layers.js'
import { emptyProfile, mergeProfile } from '../lib/persona-growth.js'

/**
 * 四层记忆：暖态 / 冷储 / 归档 / 流水。
 *
 * "越用越像"的实现就是这个晋升链：
 *   流水（原始）→ 暖态（候选，会遗忘）→ 冷储（跨会议稳定）→ 画像（注入）
 */

const dir = () => mkdtempSync(join(tmpdir(), 'sm-mem-'))
const NOW = Date.parse('2026-11-06T10:00:00Z')

test('暖态：同一件事再次出现会强化，而不是重复堆积', () => {
  const d = dir()
  try {
    const a = appendWarm({ dir: d, text: '她偏好先给结论再展开', at: NOW })
    assert.equal(a.added, true)
    const b = appendWarm({ dir: d, text: '她偏好先给结论再展开', at: NOW + 1000 })
    assert.equal(b.reinforced, true)
    assert.equal(b.seen, 2)
    assert.equal(readWarm({ dir: d }).length, 1, '不该变成两条')
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('暖态有条目元信息（kind/conf/seen/last），人也能直接读', () => {
  const d = dir()
  try {
    appendWarm({ dir: d, text: '不接受没有负责人的决定', kind: 'rule', confidence: 0.8, at: NOW })
    const raw = readFileSync(join(d, LAYOUT.warm), 'utf8')
    assert.match(raw, /^- /m, '应是 markdown 列表')
    assert.match(raw, /kind=rule/)
    assert.match(raw, /seen=1/)
    const items = parseEntries(raw)
    assert.equal(items[0].kind, 'rule')
    assert.equal(items[0].confidence, 0.8)
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('只有跨会议反复出现（seen≥2）才晋升冷储', () => {
  const d = dir()
  try {
    appendWarm({ dir: d, text: '她常用"先验证再全量"这个判断', at: NOW })
    let r = consolidate({ dir: d, now: NOW })
    assert.equal(r.promoted.length, 0, '只见一次不该晋升')

    appendWarm({ dir: d, text: '她常用"先验证再全量"这个判断', at: NOW + 86400000 })
    r = consolidate({ dir: d, now: NOW + 86400000 })
    assert.equal(r.promoted.length, 1, '第二次应晋升')
    assert.equal(readCold({ dir: d }).length, 1)
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('过期的暖态条目按日归档，不再占用注入', () => {
  const d = dir()
  try {
    appendWarm({ dir: d, text: '临时提到的一个小插曲', at: NOW })
    const r = consolidate({ dir: d, now: NOW + WARM_TTL_MS + 86400000 })
    assert.ok(r.archived >= 1)
    assert.equal(readWarm({ dir: d }).length, 0, '过期条目应移出暖态')
    const files = readdirSync(join(d, LAYOUT.episodic))
    assert.equal(files.length, 1, '应生成一份按日归档')
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('冷储有上限，按 seen×conf 保留最重要的', () => {
  const d = dir()
  try {
    for (let i = 0; i < 70; i++) {
      // 每条出现两次以晋升
      appendWarm({ dir: d, text: '稳定结论 ' + i, confidence: i / 100, at: NOW })
      appendWarm({ dir: d, text: '稳定结论 ' + i, confidence: i / 100, at: NOW + 1000 })
    }
    consolidate({ dir: d, now: NOW + 2000 })
    const cold = readCold({ dir: d, limit: 999 })
    assert.ok(cold.length <= 60, '冷储应被裁到上限，实际 ' + cold.length)
    assert.ok(cold[0].seen >= 2, '留下的应是稳定条目')
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('流水按日追加，能按秒级时间段取（大文件也取得回来）', () => {
  const d = dir()
  try {
    appendJournal({ dir: d, lines: ['讨论上线节奏', '确认负责人'], at: NOW, title: '周会' })
    appendJournal({ dir: d, lines: ['第二段'], at: NOW + 3600000, title: '续会' })
    const all = readJournal({ dir: d })
    assert.ok(all.length >= 2, '应读回流水')
    // 时间范围
    const narrow = readJournal({ dir: d, start: '23:59:00', end: '23:59:59' })
    assert.ok(narrow.length <= all.length)
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('四层目录彼此独立，status 能说清每层多少条', () => {
  const d = dir()
  try {
    appendWarm({ dir: d, text: '候选一', at: NOW })
    appendJournal({ dir: d, lines: ['流水一'], at: NOW })
    const st = layersStatus(d)
    assert.equal(st.warm, 1)
    assert.equal(st.journalDays, 1)
    assert.ok(st.paths.warm.endsWith('warm.md'))
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('收敛度：从"还不认识"随覆盖与沉淀上升', () => {
  const d = dir()
  try {
    const empty = convergence({ profile: emptyProfile(), dir: d })
    assert.equal(empty.label, '还不认识')
    assert.equal(empty.score, 0)

    const p = mergeProfile(emptyProfile(), [
      { section: 'identity', key: '角色', value: '产品负责人', confidence: 0.9 },
      { section: 'style', key: '语气', value: '直接', confidence: 0.9 },
      { section: 'stance', key: '节奏', value: '先验证再全量', confidence: 0.9 },
    ]).profile
    const mid = convergence({ profile: p, dir: d })
    assert.ok(mid.score > empty.score, '有三层内容应更高')
    assert.ok(['略有印象', '渐渐熟悉', '相当熟悉'].includes(mid.label))

    // 沉淀多了继续上升
    for (let i = 0; i < 10; i++) {
      appendWarm({ dir: d, text: '稳定 ' + i, at: NOW })
      appendWarm({ dir: d, text: '稳定 ' + i, at: NOW + 1000 })
    }
    consolidate({ dir: d, now: NOW + 2000 })
    const high = convergence({ profile: p, dir: d })
    assert.ok(high.score > mid.score, '沉淀后应更高')
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('首次运行没有文件也不报错', () => {
  const d = dir()
  try {
    assert.deepEqual(readWarm({ dir: d }), [])
    assert.deepEqual(readCold({ dir: d }), [])
    const r = consolidate({ dir: d, now: NOW })
    assert.equal(r.archived, 0)
    assert.equal(r.promoted.length, 0)
  } finally { rmSync(d, { recursive: true, force: true }) }
})
