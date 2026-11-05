import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolveDshHome, resolveProfilesRoot } from '../lib/profile-path.js'

/**
 * 事故：代码把 profiles 写死成 homedir()/.dsh/profiles，
 * 而用户把 DSH 装在 C:\dsh\instanceA\profiles，
 * 于是"知识库明明装了"被判成没装 → 纪要生成后直接跳过写库。
 *
 * 这里钉住：根目录必须**运行时推导**，且当前 profile 目录优先于任何别的环境变量。
 */

const SELF = 'file:///C:/dsh/instanceA/profiles/web/plugins/soulmirror/index.js'

test('插件自身路径就能推出非主目录的安装位置', () => {
  const opts = { selfUrl: SELF, env: {}, homeDir: 'C:/Users/CMCC', exists: () => true }
  assert.equal(resolveDshHome(opts), 'C:\\dsh\\instanceA')
  assert.equal(resolveProfilesRoot(opts), 'C:\\dsh\\instanceA\\profiles')
})

test('当前 profile 目录优先于 DSH_HOME（哪怕后者指向别处）', () => {
  const opts = {
    selfUrl: SELF,
    env: { DSH_HOME: 'C:\\Users\\other\\.dsh', DSH_PROFILE_DIR: 'C:\\dsh\\instanceA\\profiles\\web' },
    homeDir: 'C:/Users/CMCC',
    exists: () => true,
  }
  assert.equal(resolveProfilesRoot(opts), 'C:\\dsh\\instanceA\\profiles')
})

test('没有环境变量也能靠自身路径工作（宿主进程里就是这种）', () => {
  const opts = { selfUrl: SELF, env: {}, homeDir: 'C:/Users/CMCC', exists: () => true }
  assert.match(resolveProfilesRoot(opts), /instanceA[\\/]profiles$/)
})

test('全都推不出来时回落到 homedir/.dsh（不返回空）', () => {
  const opts = { selfUrl: '', env: {}, homeDir: 'C:/Users/CMCC', exists: () => true }
  const got = resolveDshHome(opts)
  assert.ok(/Users[\\/]CMCC[\\/]\.dsh$/.test(got), '应回落到 homedir/.dsh，实际 ' + got)
})

test('不再把 homedir/.dsh/profiles 当唯一来源（兜底允许，常量不允许）', () => {
  for (const f of ['../lib/knowledge.js', '../index.js', '../lib/session.js', '../lib/dsh-session.js']) {
    const src = readFileSync(new URL(f, import.meta.url), 'utf8')
    // 不允许"常量式"写死（const PROFILES = ...），那会让整个文件只有一个来源
    assert.equal(
      /const\s+PROFILES\s*=/.test(src),
      false,
      f + ' 里还有写死的 PROFILES 常量',
    )
    // 若出现 homedir()/.dsh/profiles，必须是 || 兜底
    const m = src.match(/.{0,40}homedir\(\)\s*,\s*'\.dsh'\s*,\s*'profiles'.{0,10}/)
    if (m) assert.match(m[0], /\|\||\?\?|catch/, f + ' 里 homedir/.dsh/profiles 不是兜底用法: ' + m[0])
  }
})

test('knowledge.js 走 resolveProfilesRoot 而不是常量', () => {
  const src = readFileSync(new URL('../lib/knowledge.js', import.meta.url), 'utf8')
  assert.match(src, /function profilesRoot\(\)/, '应有一个运行时解析函数')
  assert.match(src, /resolveProfilesRoot\(/, '应调用统一解析器')
  assert.equal(/const PROFILES\s*=/.test(src), false, '不该再有 PROFILES 常量')
})
