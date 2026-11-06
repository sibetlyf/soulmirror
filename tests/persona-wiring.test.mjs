import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  ensurePersona, loadProfile, saveProfile, fullPersonaBlock, loadPersona,
} from '../lib/persona.js'
import { emptyProfile, mergeProfile, renderProfile } from '../lib/persona-growth.js'

/**
 * 人格系统的接线（不止纯函数能用，还要真的挂在会后流程上）。
 *
 * 目标：每场会议后更像用户本人 —— 能代替她参会、也能按她的角度整理纪要。
 */

const src = readFileSync(new URL('../index.js', import.meta.url), 'utf8')

test('画像文件 PROFILE.json 能读写', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sm-persona-'))
  try {
    ensurePersona(dir)
    assert.equal(loadProfile(dir), null, '初始应没有画像')
    const p = mergeProfile(emptyProfile(), [
      { section: 'identity', key: '角色', value: '产品负责人', confidence: 0.9 },
    ]).profile
    saveProfile(dir, p)
    const back = loadProfile(dir)
    assert.ok(back, '应能读回')
    assert.equal(back.sections.identity[0].value, '产品负责人')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('人格块 = 手写四层 + 自动画像，且画像带"按此判断与口吻"', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sm-persona-'))
  try {
    ensurePersona(dir)
    const p = mergeProfile(emptyProfile(), [
      { section: 'style', key: '语气', value: '说话直接，先给结论', confidence: 0.8 },
      { section: 'stance', key: '上线节奏', value: '先小范围验证再全量', confidence: 0.85 },
    ]).profile
    saveProfile(dir, p)
    const block = fullPersonaBlock(dir)
    assert.match(block, /SOUL/, '应含手写 SOUL')
    assert.match(block, /关于她/, '应含自动画像')
    assert.match(block, /按此判断与口吻/, '应明确告诉模型用她的角度')
    assert.match(block, /说话直接/, '风格必须进块')
    assert.match(block, /先小范围验证/, '立场必须进块')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('模型上下文用的是 fullPersonaBlock（不是只看 markdown）', () => {
  const at = src.indexOf('function currentPersona()')
  assert.ok(at > 0, '找不到 currentPersona')
  const seg = src.slice(at, at + 400)
  assert.match(seg, /fullPersonaBlock\(/, '人格块必须包含自动画像')
})

test('会后提取是五层结构化，且喂入已知画像避免重复', () => {
  const at = src.indexOf('personaAutoUpdate && md && completer')
  assert.ok(at > 0, '找不到会后人格更新')
  const seg = src.slice(at, at + 3000)

  for (const s of ['identity', 'style', 'stance', 'facts', 'state']) {
    assert.ok(seg.includes(s), '提取提示词应包含分层：' + s)
  }
  assert.match(seg, /confidence/, '应要求置信度')
  assert.match(seg, /已知画像/, '应把已有画像给模型，避免重复与冲突')
  assert.match(seg, /mergeProfile\(/, '应走合并（而不是纯追加）')
  assert.match(seg, /saveProfile\(/, '应落盘画像')
})

test('合并结果里能看出增/强化/取代/过期四类统计', () => {
  assert.match(src, /merged\.stats\.added/, '应报告新增')
  assert.match(src, /merged\.stats\.reinforced/, '应报告强化')
  assert.match(src, /merged\.stats\.superseded/, '应报告取代')
  assert.match(src, /merged\.stats\.expired/, '应报告过期')
})

test('markdown 层仍同步追加（人可以直接翻看）', () => {
  const at = src.indexOf('personaAutoUpdate && md && completer')
  const seg = src.slice(at, at + 3000)
  assert.match(seg, /appendPersonaSection\(personaDir, 'user'/, '应继续追加 user')
  assert.match(seg, /appendPersonaSection\(personaDir, 'state'/, '应继续追加 state')
})

test('没有画像时也能工作（首次会议）', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sm-persona-'))
  try {
    ensurePersona(dir)
    const block = fullPersonaBlock(dir)
    assert.ok(block.length > 0, '至少应有 SOUL/IDENTITY 底色')
    assert.equal(/关于她/.test(block), false, '还没画像时不该出现空标题')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
