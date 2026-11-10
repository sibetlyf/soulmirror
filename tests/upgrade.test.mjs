import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  isRuntimePath, parseManifest, planUpgrade, applyUpgrade, describeUpgrade, sha256Hex,
} from '../lib/upgrade.js'

/**
 * 增量升级：升级不该"卸载重装"。
 *
 * 插件以 link: 方式装在 <profile>/plugins/soulmirror，
 * 所以升级 = 只替换变了的文件；配置与会议记录在 ~/.dsh/soulmirror，永不触碰。
 */

const manifest = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'))

test('manifest.json 存在且覆盖运行时文件', () => {
  assert.ok(manifest.files.length > 50, '文件数应足够，实际 ' + manifest.files.length)
  const paths = manifest.files.map((f) => f.path)
  for (const must of ['index.js', 'lib/client.js', 'lib/upgrade.js', 'manifest.json']) {
    assert.ok(paths.includes(must), 'manifest 缺少 ' + must)
  }
  // 不该把工具脚本、测试、临时文件带进去
  assert.equal(paths.some((p) => p.startsWith('tests/')), false, '不该同步 tests/')
  assert.equal(paths.some((p) => /\.(cjs|mjs)$/.test(p) && p.startsWith('.')), false, '不该同步临时脚本')
})

test('只同步运行时路径', () => {
  for (const ok of ['index.js', 'lib/advice.js', 'tools/mbridge.exe', 'tools/ui.ps1', 'package.json']) {
    assert.equal(isRuntimePath(ok), true, ok + ' 应同步')
  }
  for (const no of ['tests/a.test.mjs', 'scripts/gen-manifest.mjs', 'tools/test-asr-loopback.mjs', '../evil.js', '/abs.js', 'docs/x.md']) {
    assert.equal(isRuntimePath(no), false, no + ' 不该同步')
  }
})

test('parseManifest 会过滤非运行时路径', () => {
  const m = parseManifest({
    version: '1.0.1',
    files: [
      { path: 'index.js', sha256: 'a' },
      { path: 'tests/x.test.mjs', sha256: 'b' },
      { path: 'lib/x.js', sha256: 'c' },
    ],
  })
  assert.equal(m.size, 2)
  assert.equal(m.has('tests/x.test.mjs'), false)
})

test('比对：新增 / 变更 / 相同 / 远端已移除', () => {
  const local = new Map([['index.js', 'old'], ['lib/a.js', 'same'], ['lib/legacy.js', 'x']])
  const remote = new Map([['index.js', 'new'], ['lib/a.js', 'same'], ['lib/b.js', 'brand']])
  const p = planUpgrade(local, remote)
  assert.deepEqual(p.changed, ['index.js'])
  assert.deepEqual(p.added, ['lib/b.js'])
  assert.deepEqual(p.same, ['lib/a.js'])
  assert.deepEqual(p.removed, ['lib/legacy.js'], '远端删掉的文件只列出，不自动删除')
  assert.equal(p.total, 2, '需要下载 1 改 + 1 新增')
})

test('全部一致时不下载任何文件', () => {
  const m = new Map([['index.js', 'x']])
  const p = planUpgrade(m, new Map(m))
  assert.equal(p.total, 0)
})

test('applyUpgrade 只写需要更新的文件，并校验写回内容', async () => {
  const written = []
  const fetchCalls = []
  const files = new Map()
  const remote = new Map([['index.js', sha256Hex(Buffer.from('NEW'))], ['lib/new.js', sha256Hex(Buffer.from('N2'))]])

  const out = await applyUpgrade({
    dir: 'C:/fake/plugin',
    plan: planUpgrade(new Map([['index.js', sha256Hex(Buffer.from('OLD'))]]), remote),
    joinPath: (d, rel) => d + '/' + rel,
    expect: remote,
    readFileBuf: (abs) => files.get(abs) || Buffer.from(''),
    writeFileBuf: (abs, buf) => { files.set(abs, buf); written.push(abs) },
    fetchBuf: async (rel) => { fetchCalls.push(rel); return Buffer.from(rel === 'index.js' ? 'NEW' : 'N2') },
  })

  assert.deepEqual(fetchCalls.sort(), ['index.js', 'lib/new.js'], '只拉变化与新增')
  assert.equal(written.length, 2)
  assert.deepEqual(out.mismatched, [], '写回后 sha 应与远端一致')
  assert.deepEqual(out.failed, [])
})

test('单个文件失败不影响其它文件，并如实报告', async () => {
  const files = new Map()
  const remote = new Map([['a.js', sha256Hex(Buffer.from('A'))], ['b.js', sha256Hex(Buffer.from('B'))]])
  const out = await applyUpgrade({
    dir: 'D:/p',
    plan: planUpgrade(new Map(), remote),
    joinPath: (d, rel) => d + '/' + rel,
    expect: remote,
    readFileBuf: (abs) => files.get(abs) || Buffer.from(''),
    writeFileBuf: (abs, buf) => files.set(abs, buf),
    fetchBuf: async (rel) => { if (rel === 'a.js') throw new Error('HTTP 404'); return Buffer.from('B') },
  })
  assert.deepEqual(out.failed.map((f) => f.split('：')[0]), ['a.js'])
  assert.deepEqual(out.written, ['b.js'])
})

test('describeUpgrade 明说：不用重装、配置没动、需重启', () => {
  const text = describeUpgrade({ written: ['index.js', 'lib/a.js'], failed: [] }, { version: '1.0.1' })
  assert.match(text, /增量更新 2 个文件/)
  assert.match(text, /配置与会议记录未改动/)
  assert.match(text, /重启 DSH/)
  const none = describeUpgrade({ written: [], failed: [] }, { version: '1.0.1' })
  assert.match(none, /已是最新/)
})
