import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { scanPendingRecovery, isPendingRecovery } from '../lib/recovery.js'

/**
 * 未整理会议回收。
 * 关键约束：扫描阶段**只 stat 不读内容**（/status 会频繁调用），
 * 且有目录数上限，避免历史很多时拖慢面板。
 */

// 一个内存版文件系统，便于精确控制场景
function makeFs({ dirs = {}, files = {} } = {}) {
  const readdir = (root) => dirs[root] || []
  const exists = (p) => Object.prototype.hasOwnProperty.call(files, p)
  const stat = (p) => (files[p] ? { size: files[p].size, mtimeMs: files[p].mtimeMs } : null)
  const join = (...a) => a.join('/')
  return { readdir, exists, stat, join }
}

const NOW = 10_000_000
const OLD = NOW - 60 * 60 * 1000   // 一小时前

test('有账本、无纪要、够旧 → 算未整理', () => {
  const fs = makeFs({
    dirs: { '/root': ['m1'] },
    files: { '/root/m1/transcript.jsonl': { size: 500, mtimeMs: OLD } },
  })
  const r = scanPendingRecovery({ root: '/root', now: NOW, ...fs })
  assert.equal(r.length, 1)
  assert.equal(r[0].name, 'm1')
  assert.equal(r[0].ageMin, 60)
})

test('已经有纪要 → 不算未整理', () => {
  const fs = makeFs({
    dirs: { '/root': ['m1'] },
    files: {
      '/root/m1/transcript.jsonl': { size: 500, mtimeMs: OLD },
      '/root/m1/minutes.md': { size: 100, mtimeMs: OLD },
    },
  })
  assert.equal(scanPendingRecovery({ root: '/root', now: NOW, ...fs }).length, 0)
})

test('会后重转写产出的纪要也算整理过', () => {
  const fs = makeFs({
    dirs: { '/root': ['m1'] },
    files: {
      '/root/m1/transcript.jsonl': { size: 500, mtimeMs: OLD },
      '/root/m1/minutes-offline.md': { size: 100, mtimeMs: OLD },
    },
  })
  assert.equal(scanPendingRecovery({ root: '/root', now: NOW, ...fs }).length, 0)
})

test('太新的不提示（可能正在开）', () => {
  const fs = makeFs({
    dirs: { '/root': ['m1'] },
    files: { '/root/m1/transcript.jsonl': { size: 500, mtimeMs: NOW - 1000 } },
  })
  assert.equal(scanPendingRecovery({ root: '/root', now: NOW, ...fs }).length, 0)
})

test('空账本（没收到任何句子）不提示', () => {
  const fs = makeFs({
    dirs: { '/root': ['m1'] },
    files: { '/root/m1/transcript.jsonl': { size: 0, mtimeMs: OLD } },
  })
  assert.equal(scanPendingRecovery({ root: '/root', now: NOW, ...fs }).length, 0)
})

test('没有账本的目录直接跳过', () => {
  const fs = makeFs({ dirs: { '/root': ['a', 'b'] }, files: {} })
  assert.equal(scanPendingRecovery({ root: '/root', now: NOW, ...fs }).length, 0)
})

test('workspace 目录被排除', () => {
  const fs = makeFs({
    dirs: { '/root': ['workspace'] },
    files: { '/root/workspace/transcript.jsonl': { size: 500, mtimeMs: OLD } },
  })
  assert.equal(scanPendingRecovery({ root: '/root', now: NOW, ...fs }).length, 0)
})

test('扫描阶段不读文件内容（只 stat）', () => {
  let readCalls = 0
  const fs = makeFs({
    dirs: { '/root': ['m1'] },
    files: { '/root/m1/transcript.jsonl': { size: 500, mtimeMs: OLD } },
  })
  const wrapped = {
    ...fs,
    // 故意提供会抛错的 read，若被调用就能发现
    read: () => { readCalls += 1; throw new Error('扫描阶段不该读内容') },
  }
  scanPendingRecovery({ root: '/root', now: NOW, ...wrapped })
  assert.equal(readCalls, 0)
})

test('目录数有上限（历史很多时不拖慢）', () => {
  const names = Array.from({ length: 500 }, (_, i) => 'm' + i)
  const files = {}
  for (const n of names) files['/root/' + n + '/transcript.jsonl'] = { size: 500, mtimeMs: OLD }
  const fs = makeFs({ dirs: { '/root': names }, files })
  const r = scanPendingRecovery({ root: '/root', now: NOW, maxDirs: 200, ...fs })
  assert.ok(r.length <= 20, '返回条数应被限制（实际 ' + r.length + '）')
})

test('目录读不出来时返回空数组而不是抛错', () => {
  const fs = { readdir: () => { throw new Error('EACCES') }, exists: () => true, stat: () => null, join: (...a) => a.join('/') }
  assert.deepEqual(scanPendingRecovery({ root: '/root', now: NOW, ...fs }), [])
})

test('最近的排前面', () => {
  const fs = makeFs({
    dirs: { '/root': ['old', 'new'] },
    files: {
      '/root/old/transcript.jsonl': { size: 500, mtimeMs: NOW - 3 * 3600 * 1000 },
      '/root/new/transcript.jsonl': { size: 500, mtimeMs: NOW - 20 * 60 * 1000 },
    },
  })
  const r = scanPendingRecovery({ root: '/root', now: NOW, ...fs })
  assert.equal(r[0].name, 'new')
})

test('isPendingRecovery 复核同样规则（防误触发）', () => {
  const fs = makeFs({ files: { '/root/m1/transcript.jsonl': { size: 500, mtimeMs: OLD } } })
  assert.equal(isPendingRecovery({ dir: '/root/m1', now: NOW, ...fs }), true)
  assert.equal(isPendingRecovery({ dir: '/root/nope', now: NOW, ...fs }), false)
})

test('补整理对超大账本有内存保护（拒绝整份回放）', () => {
  const src = readFileSync(new URL('../index.js', import.meta.url), 'utf8')
  const at = src.indexOf('async function recoverMeeting')
  assert.ok(at > 0, '找不到 recoverMeeting')
  const seg = src.slice(at, at + 1400)
  assert.match(seg, /sizeMb > 8/, '缺少账本大小上限')
  assert.match(seg, /不做内存回放/, '拒绝时要说清原因')
})
