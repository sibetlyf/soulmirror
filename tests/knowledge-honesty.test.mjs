import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeToKnowledge, verifyInKnowledge } from '../lib/knowledge.js'

/**
 * 行为测试：写库不许"假成功"。
 *
 * 修复前：函数先自己把文件写到磁盘，再让 headless 写同一个文件，
 * 最后只检查"文件是否存在"——第一步就已存在，所以 headless 失败也报成功，
 * 调用方于是显示"已写入知识库"。
 *
 * 现在：localSaved / archiveQueued / committed 三态分开，
 * ok 只有"知识库确认"才为 true。
 */

const fakeFetch = (items) => async () => ({
  ok: true,
  status: 200,
  json: async () => ({ items }),
})

test('headless 任务失败：本地已存但明确未入库（ok:false）', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sm-kn-'))
  try {
    const r = await writeToKnowledge({
      title: '周会纪要',
      markdown: '# 周会\n',
      profile: 'web',
      cwd: dir,
      runDshTask: async () => ({ ok: false, error: '子进程起不来' }),
    })
    assert.equal(r.ok, false, '失败不许报成功')
    assert.equal(r.localSaved, true, '本地确实写成功了')
    assert.equal(r.archiveQueued, false)
    assert.equal(r.committed, false)
    assert.match(r.error, /子进程/)
    assert.ok(existsSync(r.localPath), '本地文件应存在（这是事实，但不等入库）')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('headless 报成功但知识库查不到：仍是 ok:false（未确认）', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sm-kn-'))
  try {
    const r = await writeToKnowledge({
      title: '周会纪要',
      markdown: '# 周会\n',
      profile: 'web',
      cwd: dir,
      runDshTask: async () => ({ ok: true, text: 'done' }),
      // 知识库返回空列表 → 查不到
      fetchImpl: fakeFetch([]),
    })
    assert.equal(r.localSaved, true)
    assert.equal(r.archiveQueued, true)
    assert.equal(r.committed, false, '查不到就不算入库')
    assert.equal(r.ok, false)
    assert.match(r.note, /未查到|索引/)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('知识库能查到该标题：才算 committed/ok', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sm-kn-'))
  try {
    const r = await writeToKnowledge({
      title: '周会纪要',
      markdown: '# 周会\n',
      profile: 'web',
      cwd: dir,
      runDshTask: async () => ({ ok: true }),
      origin: 'http://127.0.0.1:3080',
      fetchImpl: fakeFetch([{ id: 'e-1', title: '周会纪要 2026-11-06' }]),
    })
    assert.equal(r.ok, true)
    assert.equal(r.committed, true)
    assert.equal(r.handle, 'e-1')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('verifyInKnowledge：没有地址/标题时明确说无法核验', async () => {
  const a = await verifyInKnowledge({ title: 'x' })
  assert.equal(a.committed, false)
  assert.match(a.error, /无法核验/)

  const b = await verifyInKnowledge({ title: '', port: 1234 })
  assert.equal(b.committed, false)
  assert.match(b.error, /标题为空/)
})

test('verifyInKnowledge：查询失败不谎报', async () => {
  const r = await verifyInKnowledge({
    title: '周会',
    port: 1234,
    fetchImpl: async () => ({ ok: false, status: 500, json: async () => null }),
  })
  assert.equal(r.committed, false)
  assert.match(r.error, /500/)
})
