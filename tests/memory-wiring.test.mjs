import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import {
  appendWarm, appendJournal, consolidate, convergence, layersStatus, readCold,
} from '../lib/memory-layers.js'
import { emptyProfile, mergeProfile } from '../lib/persona-growth.js'

/**
 * 四层记忆的接线 + "越用越像"的端到端验证。
 *
 * 用户要求：四层记忆要加进去，并让助理的人格/喜好/工作模式逐渐与本人一致。
 * 所以这里不只测函数，还要**模拟连续几场会**，看它是否真的越来越像。
 */

const src = readFileSync(new URL('../index.js', import.meta.url), 'utf8')

test('会后会写流水与暖态，并整理出冷储', () => {
  const at = src.indexOf('const memDir = join(personaDir, \'memory\')')
  assert.ok(at > 0, '找不到四层记忆接入点')
  const seg = src.slice(at, at + 1600)
  assert.match(seg, /appendJournal\(/, '应写流水')
  assert.match(seg, /appendWarm\(/, '应写暖态')
  assert.match(seg, /consolidate\(/, '应整理（晋升冷储/归档）')
  assert.match(seg, /convergence\(/, '应计算收敛度')
})

test('人格块里含"已经稳定的认识"（冷储注入）', () => {
  const persona = readFileSync(new URL('../lib/persona.js', import.meta.url), 'utf8')
  assert.match(persona, /已经稳定的认识/, '人格块应包含冷储摘要')
  assert.match(persona, /readCold\(/, '应读冷储')
})

test('/status 暴露四层记忆与收敛度；soul_world 也能看到"像她的程度"', () => {
  assert.match(src, /memoryLayers:/, '/status 缺 memoryLayers')
  assert.match(src, /像她的程度/, 'soul_world 应展示收敛度')
})

test('越用越像：同一偏好跨三场会晋升，收敛度上升', () => {
  const d = mkdtempSync(join(tmpdir(), 'sm-grow-'))
  try {
    let profile = emptyProfile()
    const scores = []

    // 第 1 场：只出现一次
    appendJournal({ dir: d, lines: ['她说先验证再全量'], at: Date.now() })
    appendWarm({ dir: d, text: '先验证再全量，不赶工', kind: 'rule', confidence: 0.7, at: Date.now() })
    let cons = consolidate({ dir: d })
    profile = mergeProfile(profile, [
      { section: 'stance', key: '节奏', value: '先验证再全量，不赶工', confidence: 0.7 },
    ]).profile
    scores.push(convergence({ profile, dir: d }).score)
    assert.equal(cons.promoted.length, 0, '只见一次不晋升')

    // 第 2 场：再次出现 → 晋升冷储
    appendWarm({ dir: d, text: '先验证再全量，不赶工', kind: 'rule', confidence: 0.75, at: Date.now() + 1000 })
    appendWarm({ dir: d, text: '开会喜欢先看结论再讨论', kind: 'style', confidence: 0.7, at: Date.now() + 1000 })
    cons = consolidate({ dir: d, now: Date.now() + 1000 })
    profile = mergeProfile(profile, [
      { section: 'stance', key: '节奏', value: '先验证再全量，不赶工', confidence: 0.8 },
      { section: 'style', key: '开会习惯', value: '先看结论再讨论', confidence: 0.7 },
    ]).profile
    scores.push(convergence({ profile, dir: d }).score)
    assert.ok(cons.promoted.length >= 1, '第二次应晋升')
    assert.ok(readCold({ dir: d }).length >= 1, '冷储应有条目')

    // 第 3 场：继续强化 + 新增身份
    appendWarm({ dir: d, text: '先验证再全量，不赶工', kind: 'rule', confidence: 0.8, at: Date.now() + 2000 })
    profile = mergeProfile(profile, [
      { section: 'identity', key: '角色', value: '产品负责人，带 5 人小组', confidence: 0.9 },
      { section: 'stance', key: '节奏', value: '先验证再全量，不赶工', confidence: 0.9 },
    ]).profile
    consolidate({ dir: d, now: Date.now() + 2000 })
    scores.push(convergence({ profile, dir: d }).score)

    // 单调上升（允许持平，但不该倒退）
    assert.ok(scores[1] >= scores[0], '第二场不该倒退：' + scores)
    assert.ok(scores[2] >= scores[1], '第三场不该倒退：' + scores)
    assert.ok(scores[2] > scores[0], '三场之后应更像：' + scores)
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('四层各司其职：流水不筛、暖态会忘、冷储稳定、归档留痕', () => {
  const d = mkdtempSync(join(tmpdir(), 'sm-layers-'))
  try {
    appendJournal({ dir: d, lines: ['原话一', '原话二'], at: Date.now() })
    appendWarm({ dir: d, text: '临时事项', at: Date.now() })
    const st = layersStatus(d)
    assert.ok(st.journalDays >= 1, '流水应存在')
    assert.equal(st.warm, 1, '暖态应有一条')
    assert.ok(st.paths.cold.endsWith('cold.md'))
  } finally { rmSync(d, { recursive: true, force: true }) }
})
