import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { detectInstallKind, canUpgradeInPlace, describeInstallKind } from '../lib/upgrade.js'

/**
 * 远程安装也能增量升级。
 *
 * 三种安装位置处理方式不同：
 *   · link 目录（<profile>/plugins/<name>）→ 直接按 manifest 覆盖
 *   · git 工作副本 → 可以 pull，也可以按 manifest 覆盖
 *   · node_modules（npm / pnpm 装的）→ 不该直接写！下次 install 会被覆盖，
 *     pnpm store 还可能只读；必须升级包版本后重新 install
 */

const src = readFileSync(new URL('../index.js', import.meta.url), 'utf8')

test('识别 link 目录', () => {
  const kind = detectInstallKind('C:/Users/a/.dsh/profiles/web/plugins/soulmirror', { exists: () => false })
  assert.equal(kind, 'link')
  assert.equal(canUpgradeInPlace(kind), true)
})

test('识别 node_modules（不允许原地覆盖）', () => {
  const kind = detectInstallKind('C:/proj/node_modules/soulmirror', { exists: () => false })
  assert.equal(kind, 'node_modules')
  assert.equal(canUpgradeInPlace(kind), false)
  const msg = describeInstallKind(kind, 'C:/proj/node_modules/soulmirror')
  assert.match(msg, /pnpm add|重新 install/, '应给出正确的升级方式')
  assert.match(msg, /link 安装/, '应给出替代方案')
})

test('识别 git 工作副本', () => {
  const kind = detectInstallKind('G:/dsh-test/soulmirror', { exists: (p) => p.endsWith('.git') })
  assert.equal(kind, 'git')
  assert.equal(canUpgradeInPlace(kind), true)
})

test('升级动作会先检查安装形态，node_modules 直接拒绝并解释', () => {
  const at = src.indexOf("if (a.action === 'upgrade') {")
  assert.ok(at > 0)
  const seg = src.slice(at, at + 700)
  assert.match(seg, /detectInstallKind\(pluginDir/, '应先识别安装形态')
  assert.match(seg, /canUpgradeInPlace/, '应判断能否原地升级')
  assert.match(seg, /describeInstallKind/, '不能时应解释原因与正确做法')
  assert.match(seg, /a\.force !== true/, '应允许显式 force 覆盖')
})

test('远程 fork / 私有部署可指定自己的源', () => {
  assert.match(src, /SOULMIRROR_UPGRADE_REPO/, '支持环境变量指定仓库')
  assert.match(src, /SOULMIRROR_UPGRADE_BRANCH/, '支持环境变量指定分支')
  assert.match(src, /upgrade: z\.object\(\{/, '配置里应有 upgrade 段')
  const at = src.indexOf("const base = 'https://raw.githubusercontent.com/'")
  const seg = src.slice(at - 400, at + 120)
  assert.match(seg, /cfg\.upgrade && cfg\.upgrade\.repo/, '应优先读配置里的 repo')
})
