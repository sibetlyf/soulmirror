import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * 文档结构约束。
 *
 * 用户明确要求：主 README 只保留禅境理念、功能简介、所需插件与环境要求，
 * 其余内容拆到对应文件夹的 README，用链接串起来。
 *
 * 这里钉住三件事：
 *   1. 主 README 不能再次膨胀成 700 行长文
 *   2. 每个代码目录都有自己的 README
 *   3. 所有相对链接都真实存在（文档搬家后最容易断的就是链接）
 */

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(root, p), 'utf8')

test('主 README 保持精简（只放理念/功能/要求）', () => {
  const lines = read('README.md').split('\n').length
  assert.ok(lines <= 200, '主 README 已 ' + lines + ' 行，细节应拆到 docs/')
})

test('主 README 必须包含四块核心内容与文档入口', () => {
  const t = read('README.md')
  assert.match(t, /禅 · 与魂|禅境/, '缺少设计理念')
  assert.match(t, /魂/, '缺少"魂"这一层（用户明确要求介绍 soul 如何复刻灵魂）')
  assert.match(t, /它做什么|功能/, '缺少功能简介')
  assert.match(t, /运行所需|必需/, '缺少所需插件/环境')
  assert.match(t, /文档地图/, '缺少文档入口')
  assert.match(t, /docs\/README\.md/, '应指向 docs 索引')
})

test('每个代码目录都有 README', () => {
  for (const d of ['lib', 'tests', 'tools', 'scripts', 'docs']) {
    const p = join(root, d, 'README.md')
    assert.ok(existsSync(p), d + '/ 缺少 README.md')
    assert.ok(statSync(p).size > 300, d + '/README.md 内容太少，像是占位')
  }
})

test('lib/README.md 是模块地图，覆盖主要分层', () => {
  const t = read('lib/README.md')
  for (const layer of ['会议会话', '音频', '识别与发言', '会后与持久化', '会议软件与桌面']) {
    assert.ok(t.includes(layer), '模块地图缺少分层：' + layer)
  }
  // 关键模块必须被点到
  for (const m of ['session.js', 'transcript-log.js', 'recovery.js', 'meeting-name.js', 'profile-path.js']) {
    assert.ok(t.includes(m), '模块地图缺少 ' + m)
  }
})

test('所有文档里的相对链接都真实存在', () => {
  const files = []
  const walk = (d) => {
    for (const n of readdirSync(d)) {
      if (n === 'node_modules' || n.startsWith('.')) continue
      const p = join(d, n)
      if (statSync(p).isDirectory()) walk(p)
      else if (n.endsWith('.md')) files.push(p)
    }
  }
  walk(root)

  const bad = []
  for (const f of files) {
    const text = readFileSync(f, 'utf8')
    for (const m of text.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
      const target = m[1].split('#')[0].trim()
      if (!target || /^(https?:|mailto:)/.test(target)) continue
      if (!existsSync(resolve(dirname(f), target))) {
        bad.push(f.replace(root + '\\', '') + ' → ' + target)
      }
    }
  }
  assert.deepEqual(bad, [], '失效链接：\n' + bad.join('\n'))
})

test('旧的长篇设计文档被保留在 archive 而不是丢弃', () => {
  const dir = join(root, 'docs', 'archive')
  assert.ok(existsSync(dir), '缺少 docs/archive')
  const names = readdirSync(dir)
  for (const f of ['DESIGN-v2.md', 'DESIGN-v3.md', 'DESIGN-v4.md']) {
    assert.ok(names.includes(f), 'archive 缺少 ' + f)
  }
})

test('灵魂文档存在且讲清了四根柱子', () => {
  const p = join(root, 'docs', 'soul-architecture.md')
  assert.ok(existsSync(p), '缺少 docs/soul-architecture.md')
  const s = readFileSync(p, 'utf8')
  for (const k of ['四层人格', '记忆会呼吸', '情绪成地形', '信念会进化']) {
    assert.ok(s.includes(k), '灵魂文档缺少：' + k)
  }
  // 必须写清哪些自动、哪些手动（避免读成"全自动"）
  assert.match(s, /自动跑|需要叫它/, '应说明自动/手动的边界')
  assert.match(s, /soul_belief/, '应给出信念工具用法')
})
