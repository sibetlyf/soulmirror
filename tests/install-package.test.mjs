import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/**
 * 从 GitHub 直接安装必须一次成功，不能卡在 pnpm 的"构建脚本审批"。
 *
 * 真实故障（用户在另一台机器上）：
 *   dsh plugin --profile web add github:sibetlyf/soulmirror
 *   → [ERR_PNPM_IGNORED_BUILDS] Ignored build scripts: soulmirror@...
 *   → dsh: plugin command failed
 *
 * 原因：package.json 里有 postinstall。pnpm 10 默认拦截**依赖**的生命周期脚本，
 * 需要人工 approve-builds / allowBuilds 才放行；DSH 把这个忽略当成安装失败。
 *
 * 我们的 postinstall 本来也不需要：mbridge.exe 随包分发，配置由运行时
 * ensureConfigFile 幂等生成。它还会写入 enabled:false ——
 * 正是"每次装完都是未启用"的真凶之一。所以整体移除。
 */

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const postinstall = readFileSync(new URL('../scripts/postinstall.mjs', import.meta.url), 'utf8')

const BUILD_SCRIPTS = ['preinstall', 'install', 'postinstall', 'prepare', 'prepack', 'prepublishOnly']

test('package.json 不包含任何会被 pnpm 拦截的构建脚本', () => {
  const present = BUILD_SCRIPTS.filter((k) => pkg.scripts && pkg.scripts[k])
  assert.deepEqual(present, [], '这些脚本会让 git 安装失败：' + present.join(', '))
})

test('安装包包含运行所需的文件（含 mbridge.exe 与 manifest）', () => {
  const files = (pkg.files || []).join(' ')
  for (const must of ['manifest.json', 'index.js', 'lib/', 'tools/mbridge.exe']) {
    assert.ok(files.includes(must), 'files 白名单缺少 ' + must)
  }
})

test('files 不包含整个 tools/（避免把本地模型打进包）', () => {
  const files = pkg.files || []
  assert.equal(files.includes('tools/'), false, '不要整目录放 tools/，体积会暴涨')
})

test('保留的脚本里没有 postinstall 的兜底残留', () => {
  const scripts = pkg.scripts || {}
  assert.equal(scripts.setup, undefined, 'setup 也只是 postinstall 的别名，一并去掉')
  assert.ok(scripts.test, '应保留 test')
})

test('脚本文件本身仍可手动执行，且默认是启用而不是关闭', () => {
  // 即使不再自动跑，这个脚本被人手动执行时也不该把用户配置改成关闭
  assert.match(postinstall, /enabled: true/, '默认应为启用，不再是 enabled: false')
})
