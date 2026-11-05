import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pathSegments, profileDirFromPluginPath, resolveProfileDir } from '../lib/profile-path.js'

test('切段：Windows 路径与 file URL 都能切', () => {
  assert.deepEqual(pathSegments('C:\\a\\b\\c'), ['C:', 'a', 'b', 'c'])
  assert.deepEqual(pathSegments('file:///C:/a/b/c'), ['C:', 'a', 'b', 'c'])
  assert.deepEqual(pathSegments('/home/u/x'), ['home', 'u', 'x'])
  assert.deepEqual(pathSegments(''), [])
})

test('从插件路径反推 profile（这是实测里唯一可靠的线索）', () => {
  const dir = profileDirFromPluginPath({
    selfUrl: 'file:///C:/Users/liyafeng/.dsh/profiles/web/plugins/soulmirror/index.js',
  })
  assert.match(dir, /profiles[\\/]web$/)
})

test('非 file URL（纯路径）也能反推', () => {
  const dir = profileDirFromPluginPath({ selfUrl: 'C:\\u\\.dsh\\profiles\\headless\\plugins\\soulmirror\\index.js' })
  assert.match(dir, /profiles[\\/]headless$/)
})

test('路径里没有 profiles 时返回空串，绝不瞎猜', () => {
  assert.equal(profileDirFromPluginPath({ selfUrl: '/opt/x/plugins/soulmirror/index.js' }), '')
  assert.equal(profileDirFromPluginPath({ selfUrl: '' }), '')
})

test('目录不存在时返回空串（避免给出假路径）', () => {
  const dir = profileDirFromPluginPath({
    selfUrl: 'file:///C:/x/profiles/web/plugins/soulmirror/index.js',
    exists: () => false,
  })
  assert.equal(dir, '')
})

test('优先级：环境变量全路径 > 自身路径 > home+名字', () => {
  const env = { DSH_PROFILE_DIR: 'C:\\real\\web', DSH_PROFILE: 'web' }
  const got = resolveProfileDir({
    selfUrl: 'file:///C:/u/.dsh/profiles/web/plugins/soulmirror/index.js',
    env,
    homeDir: 'C:\\u',
    exists: () => true,
  })
  assert.equal(got, 'C:\\real\\web')
})

test('环境变量为空时回退到自身路径（事故现场就是这样）', () => {
  const got = resolveProfileDir({
    selfUrl: 'file:///C:/Users/liyafeng/.dsh/profiles/web/plugins/soulmirror/index.js',
    env: {}, // 宿主进程里就是空
    homeDir: 'C:\\Users\\liyafeng',
    exists: () => true,
  })
  assert.match(got, /profiles[\\/]web$/)
})

test('全都推不出来就返回空串，由调用方判空', () => {
  assert.equal(resolveProfileDir({ selfUrl: '', env: {}, homeDir: '' }), '')
})
