#!/usr/bin/env node
/**
 * 不经过 pnpm 安装本插件（绕开 registry 与"整库解析"）。
 *
 * 为什么可行：DSH 的 profile 只做两件事——
 *   ① 从 profile 目录解析 bundle 包名（profile/node_modules 里能解析到，就算存在）
 *   ② 按 package.json 的 dsh.profile.bundles 顺序应用每个 bundle 的 dsh.bundle.patch
 * 所以只要"建一个 node_modules 链接 + 在 bundles 里加一个名字"，不需要 pnpm、不需要 registry，
 * 也不会去解析 profile 里其它任何依赖。
 *
 * 用法：
 *   node scripts/install-without-pnpm.mjs                     # 装到 web profile，源=当前仓库
 *   node scripts/install-without-pnpm.mjs --profile headless
 *   node scripts/install-without-pnpm.mjs --source G:\some\soulmirror --profile web
 *   node scripts/install-without-pnpm.mjs --uninstall
 *
 * 安全性：
 *   - 改 package.json 前先备份成 package.json.bak-<时间戳>
 *   - 只追加/删除 bundles 里的一个名字，其它内容一字不动
 *   - node_modules 里若已存在同名真实目录（非链接）→ 拒绝，不覆盖
 *   - 全程不联网、不执行 pnpm、不碰插件数据目录
 */
import { existsSync, lstatSync, readFileSync, writeFileSync, copyFileSync, mkdirSync, rmSync, realpathSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..')
const PLUGIN_NAME = 'soulmirror'

function arg(name, fallback) {
  const i = process.argv.indexOf('--' + name)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}
const profileName = arg('profile', 'web')
const source = resolve(arg('source', REPO))
const uninstall = process.argv.includes('--uninstall')

const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh')
const profileDir = join(dshHome, 'profiles', profileName)

function fail(msg) { console.error('✗ ' + msg); process.exit(1) }
function ok(msg) { console.log('✓ ' + msg) }

if (!existsSync(profileDir)) fail('找不到 profile：' + profileDir + '\n  先用 `dsh plugin --profile ' + profileName + ' install` 初始化，或检查 --profile 名字')
if (!uninstall) {
  if (!existsSync(join(source, 'package.json'))) fail('源目录里没有 package.json：' + source)
  if (!existsSync(join(source, 'index.js'))) fail('源目录里没有 index.js：' + source)
  const pkg = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8'))
  if (pkg.name !== PLUGIN_NAME) fail('这个源不是 ' + PLUGIN_NAME + '（package.json name=' + pkg.name + '）')
  if (!pkg.dsh || !pkg.dsh.bundle) fail('源包的 package.json 没有 dsh.bundle.patch，作为 bundle 装不上')
}

const manifestPath = join(profileDir, 'package.json')
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
manifest.dsh = manifest.dsh || {}
manifest.dsh.profile = manifest.dsh.profile || {}
manifest.dsh.profile.bundles = Array.isArray(manifest.dsh.profile.bundles) ? manifest.dsh.profile.bundles : []

const linkPath = join(profileDir, 'node_modules', PLUGIN_NAME)

function linkKind(p) {
  if (!existsSync(p)) return 'absent'
  const st = lstatSync(p)
  if (st.isSymbolicLink()) return 'link'
  // Windows junction 在 lstat 里也是 isSymbolicLink()=false、isDirectory()=true，
  // 所以用 realpath 是否等于自身来判断"是不是链接"。
  return 'dir'
}

function makeJunction(target, link) {
  mkdirSync(dirname(link), { recursive: true })
  if (process.platform === 'win32') {
    execFileSync('cmd', ['/c', 'mklink', '/J', link, target], { stdio: 'pipe' })
    return
  }
  execFileSync('ln', ['-s', target, link], { stdio: 'pipe' })
}

if (uninstall) {
  const before = JSON.stringify(manifest)
  manifest.dsh.profile.bundles = manifest.dsh.profile.bundles.filter((b) => b !== PLUGIN_NAME)
  if (JSON.stringify(manifest) !== before) {
    copyFileSync(manifestPath, manifestPath + '.bak-' + new Date().toISOString().replace(/[:.]/g, '-'))
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8')
    ok('已从 dsh.profile.bundles 移除 ' + PLUGIN_NAME)
  } else {
    ok('bundles 里本来就没有 ' + PLUGIN_NAME)
  }
  if (existsSync(linkPath)) {
    rmSync(linkPath, { recursive: true, force: true })
    ok('已删除 node_modules/' + PLUGIN_NAME + ' 链接')
  } else {
    ok('node_modules/' + PLUGIN_NAME + ' 本来就不存在')
  }
  console.log('\n重启 DSH 后生效。')
  process.exit(0)
}

// ① 建链接
const kind = linkKind(linkPath)
if (kind === 'dir') {
  // 可能是真实目录（pnpm 装过的）：不动它，直接提示
  fail('node_modules/' + PLUGIN_NAME + ' 是真实目录（可能由 pnpm 安装），不覆盖。\n  先用 `dsh plugin --profile ' + profileName + ' remove ' + PLUGIN_NAME + '` 再重试')
}
let pointed = ''
try {
  const rp = realpathSync(linkPath)
  pointed = rp
} catch { /* 读不到就当没指向 */ }
if (kind === 'link' && resolve(pointed) === source) {
  ok('node_modules/' + PLUGIN_NAME + ' 已指向 ' + source + '（不动它）')
} else {
  if (kind === 'link') {
    rmSync(linkPath, { recursive: true, force: true })
    ok('替换旧的 node_modules/' + PLUGIN_NAME + ' 链接（原指向 ' + (pointed || '未知') + '）')
  }
  makeJunction(source, linkPath)
  ok('已链接 node_modules/' + PLUGIN_NAME + ' → ' + source)
}

// ② 加进 bundles（只加一个名字，其它不动）
if (!manifest.dsh.profile.bundles.includes(PLUGIN_NAME)) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  copyFileSync(manifestPath, manifestPath + '.bak-' + stamp)
  manifest.dsh.profile.bundles.push(PLUGIN_NAME)
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8')
  ok('已加入 dsh.profile.bundles（备份：package.json.bak-' + stamp + '）')
} else {
  ok('dsh.profile.bundles 里已有 ' + PLUGIN_NAME + '（位置 ' + (manifest.dsh.profile.bundles.indexOf(PLUGIN_NAME) + 1) + '/' + manifest.dsh.profile.bundles.length + '）')
}

// ③ 立刻验证：只组合配置、不启动
function runDsh(args) {
  if (process.platform === 'win32') return execFileSync('cmd', ['/c', 'dsh', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, DSH_HOME: dshHome }, timeout: 90000 })
  return execFileSync('dsh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, DSH_HOME: dshHome }, timeout: 90000 })
}
try {
  const dump = runDsh(['--profile', profileName, '--dump-config'])
  if (!dump.includes('- id: ' + PLUGIN_NAME) && !dump.includes('# == ' + PLUGIN_NAME)) {
    fail('组合后的配置里没有 ' + PLUGIN_NAME + ' 这一层；请把 --dump-config 的输出发给我')
  }
  ok('已验证：--dump-config 组合结果里包含 ' + PLUGIN_NAME + '（不需要 pnpm，也没有解析其它依赖）')
} catch (e) {
  fail('校验失败：' + (e && e.message ? e.message : String(e)) + '\n  插件文件已经放好，但组合失败；把上面的输出发给我')
}

console.log('\n完成。现在重启 DSH（不是刷新浏览器），然后在「插件」页确认 ' + PLUGIN_NAME + ' 已加载。')
console.log('卸载：node scripts/install-without-pnpm.mjs --profile ' + profileName + ' --uninstall')
