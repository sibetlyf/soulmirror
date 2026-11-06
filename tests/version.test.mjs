import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  VERSION, STORAGE_VERSION, MIN_DSH, MIN_NODE,
  parseVersion, compareVersions, checkCompatibility, planStorageMigration, versionInfo,
} from '../lib/version.js'

/**
 * 版本号体系。
 *
 * 两个版本号必须分开：
 *   插件版本 = 能力变了什么（1.0.0 → 1.1.0 加功能，旧数据照样能读）
 *   存储版本 = 文件格式变没变（1 → 2 必须迁移，否则读懂一半）
 */

test('版本常量形状合法', () => {
  assert.ok(parseVersion(VERSION), 'VERSION 应是 semver：' + VERSION)
  assert.ok(Number.isInteger(STORAGE_VERSION) && STORAGE_VERSION >= 1)
  assert.ok(parseVersion(MIN_DSH))
  assert.ok(parseVersion(MIN_NODE))
})

test('package.json 的版本与代码里的 VERSION 一致（防走岔）', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  assert.equal(pkg.version, VERSION, 'package.json 与 lib/version.js 的版本必须同步')
})

test('解析：容忍 v 前缀与预发布', () => {
  assert.deepEqual(parseVersion('v1.2.3'), { major: 1, minor: 2, patch: 3, pre: '' })
  assert.deepEqual(parseVersion('1.0.0-beta.2'), { major: 1, minor: 0, patch: 0, pre: 'beta.2' })
  assert.equal(parseVersion('1.2'), null, '两位版本号应拒绝')
  assert.equal(parseVersion('abc'), null)
})

test('比较：主次修订依次比，预发布低于正式', () => {
  assert.equal(compareVersions('1.0.0', '1.0.0'), 0)
  assert.equal(compareVersions('1.1.0', '1.0.9'), 1)
  assert.equal(compareVersions('0.9.0', '1.0.0'), -1)
  assert.equal(compareVersions('1.0.0-beta', '1.0.0'), -1, '预发布低于正式')
  assert.ok(Number.isNaN(compareVersions('x', '1.0.0')))
})

test('兼容性：Node 太低要报出来', () => {
  const r = checkCompatibility({ nodeVersion: '18.0.0' })
  assert.equal(r.ok, false)
  assert.match(r.problems[0], /Node/)
})

test('兼容性：DSH 太低要报出来，够了就通过', () => {
  const low = checkCompatibility({ dshVersion: '0.8.0', nodeVersion: '20.18.0' })
  assert.equal(low.ok, false)
  assert.ok(low.problems.some((p) => /DSH/.test(p)))

  const ok = checkCompatibility({ dshVersion: MIN_DSH, nodeVersion: MIN_NODE })
  assert.equal(ok.ok, true)
  assert.deepEqual(ok.problems, [])
})

test('存储迁移：一致 / 需要迁移 / 数据太新 三种判断', () => {
  assert.equal(planStorageMigration(STORAGE_VERSION).action, 'ok')

  // 迁移只在"存在更旧的正式版本"时才有意义；
  // 当前 STORAGE_VERSION=1，0 表示"没有标记"，按首次运行处理。
  if (STORAGE_VERSION > 1) {
    const older = planStorageMigration(STORAGE_VERSION - 1)
    assert.equal(older.action, 'migrate')
    assert.match(older.note, /迁移/)
  }

  const newer = planStorageMigration(STORAGE_VERSION + 1)
  assert.equal(newer.action, 'too-new')
  assert.match(newer.note, /升级插件/)

  const none = planStorageMigration(undefined)
  assert.equal(none.action, 'unknown', '没有标记时按首次运行处理')
  assert.equal(planStorageMigration(0).action, 'unknown', '0 等同于没有标记')
})

test('versionInfo 汇总包含两个版本号与兼容性', () => {
  const v = versionInfo({ dshVersion: MIN_DSH })
  assert.equal(v.version, VERSION)
  assert.equal(v.storage, STORAGE_VERSION)
  assert.equal(v.compatible, true)
  assert.equal(typeof v.node, 'string')
})
