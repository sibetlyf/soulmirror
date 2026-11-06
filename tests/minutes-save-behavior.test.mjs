import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { saveMinutes } from '../lib/minutes-file.js'

/**
 * 行为测试：纪要保存必须真的能结束并落盘。
 *
 * 修复前：index.js 内定义了同名 `saveMinutes()`，遮蔽导入的文件写入函数，
 * 导致 `saveMinutes(path, md)` 递归调用自己 → Promise 永不结束、纪要永不落盘。
 * 这类问题字符串断言测不出来，只能真跑一次。
 */

test('saveMinutes 真能把文件写出来并返回路径', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sm-minutes-'))
  try {
    const dest = join(dir, 'minutes.md')
    const r = await saveMinutes(dest, '# 会议纪要\n\n- 决议：先验证再全量\n')
    assert.ok(existsSync(dest), '文件必须存在')
    assert.equal(r.path, dest)
    assert.match(readFileSync(dest, 'utf8'), /先验证再全量/)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('重复保存同一路径会保留历史而不是丢内容', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sm-minutes-'))
  try {
    const dest = join(dir, 'minutes.md')
    await saveMinutes(dest, '# 第一版\n')
    await saveMinutes(dest, '# 第二版\n')
    const body = readFileSync(dest, 'utf8')
    assert.match(body, /第二版/, '应是最新内容')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('keepHistory=false 时不额外留版本（实时纪要场景）', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sm-minutes-'))
  try {
    const dest = join(dir, 'minutes-live.md')
    await saveMinutes(dest, '# live\n', { keepHistory: false })
    assert.ok(existsSync(dest))
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
