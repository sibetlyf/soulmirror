import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, statSync, readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'

/**
 * mbridge.exe 的分发保障。
 *
 * 历史事故：它被 .gitignore 的 `*.exe` 挡住，从仓库安装的人拿不到它，
 * 采集 spawn 报 ENOENT，而那个 child 没挂 error 监听 → 整个 DSH 闪退。
 *
 * 现在决定"装完立刻能用、不依赖 csc"，所以：
 *   1) exe 必须随包分发（存在、非空、是 PE 文件）
 *   2) .gitignore 必须保留 !tools/mbridge.exe 例外，否则下次提交又漏掉
 *   3) exe 不该比 meeting-bridge.cs 旧（改了源码忘了重编 → 行为与源码不符）
 */

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const exe = join(root, 'tools', 'mbridge.exe')
const cs = join(root, 'tools', 'meeting-bridge.cs')

test('mbridge.exe 随包分发（存在且非空）', () => {
  assert.ok(existsSync(exe), '缺少 tools/mbridge.exe —— 别人装完就没有它了')
  const size = statSync(exe).size
  assert.ok(size > 10 * 1024, 'exe 太小，可能编译失败：' + size + ' 字节')
})

test('它是真正的 Windows PE 文件（不是占位）', () => {
  const head = readFileSync(exe).subarray(0, 2).toString('latin1')
  assert.equal(head, 'MZ', 'exe 开头应为 MZ')
})

test('.gitignore 保留了 mbridge.exe 的例外', () => {
  const ignore = readFileSync(join(root, '.gitignore'), 'utf8')
  assert.match(ignore, /!tools\/mbridge\.exe/, '.gitignore 里的例外被删了，exe 会再次被忽略')
})

test('exe 不比源码旧（改了 .cs 要重编）', () => {
  assert.ok(existsSync(cs), '缺少 tools/meeting-bridge.cs')
  const exeAt = statSync(exe).mtimeMs
  const csAt = statSync(cs).mtimeMs
  assert.ok(exeAt >= csAt, 'mbridge.exe 比 meeting-bridge.cs 旧，请用 buildBridge({force:true}) 重编后一起提交')
})

test('存在 .git 时，exe 必须被 git 跟踪（防止再次漏提交）', (t) => {
  const gitDir = join(root, '.git')
  if (!existsSync(gitDir)) {
    t.skip('不是 git 工作区（安装后的副本），跳过')
    return
  }
  let out = ''
  try {
    out = execFileSync('git', ['ls-files', 'tools/mbridge.exe'], { cwd: root, encoding: 'utf8' })
  } catch {
    t.skip('拿不到 git 信息，跳过')
    return
  }
  assert.match(out, /tools\/mbridge\.exe/, 'exe 没有被 git 跟踪，发布出去就没人有它')
})
