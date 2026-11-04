import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pickWorkspaceCwd, looksLikePluginData } from '../lib/workspace.js'

test('显式配置优先', () => {
  const r = pickWorkspaceCwd({ configured: 'G:/work/proj', active: 'G:/other', fallback: 'C:/tmp' })
  assert.equal(r.cwd, 'G:/work/proj')
  assert.equal(r.source, 'configured')
})

test('没配置时继承当前活动会话目录', () => {
  const r = pickWorkspaceCwd({ active: 'G:/dsh-test', fallback: 'C:/tmp' })
  assert.equal(r.cwd, 'G:/dsh-test')
  assert.equal(r.source, 'active-session')
})

test('插件自己的数据目录不会被当成用户工作区', () => {
  assert.equal(looksLikePluginData('C:/Users/x/.dsh/soulmirror/workspace/a'), true)
  assert.equal(looksLikePluginData('C:\\Users\\x\\.dsh\\soulmirror'), true)
  assert.equal(looksLikePluginData('G:/dsh-test'), false)
  const r = pickWorkspaceCwd({ active: 'C:/Users/x/.dsh/soulmirror/workspace/k', fallback: 'G:/dsh-test' })
  assert.equal(r.source, 'fallback', '私有目录应被跳过')
  assert.equal(r.cwd, 'G:/dsh-test')
})

test('都没有时返回空 + none', () => {
  const r = pickWorkspaceCwd({})
  assert.equal(r.cwd, '')
  assert.equal(r.source, 'none')
})

test('空白字符串按未设置处理', () => {
  const r = pickWorkspaceCwd({ configured: '   ', active: '  ', fallback: 'G:/x' })
  assert.equal(r.cwd, 'G:/x')
  assert.equal(r.source, 'fallback')
})

test('detectKnowledgeCwd：优先选最近有写入的知识库目录', async () => {
  const { detectKnowledgeCwd } = await import('../lib/workspace.js')
  const join = (a, b) => a + '/' + b
  const existsSync = (p) => ['A', 'A/documents', 'B', 'B/artifacts'].includes(p)
  const statSync = (p) => ({ mtimeMs: p === 'A/documents' ? 1000 : p === 'B/artifacts' ? 5000 : 0 })
  assert.equal(detectKnowledgeCwd(['A', 'B'], { existsSync, statSync, join }), 'B')
})

test('detectKnowledgeCwd：没有 documents/artifacts 的目录不算知识库', async () => {
  const { detectKnowledgeCwd } = await import('../lib/workspace.js')
  const join = (a, b) => a + '/' + b
  const none = detectKnowledgeCwd(['D'], { existsSync: (p) => p === 'D', statSync: () => ({ mtimeMs: 1 }), join })
  assert.equal(none, '', '只有目录本身、没有子目录时不该认作知识库')
})

test('detectKnowledgeCwd：空候选或缺少依赖时返回空串', async () => {
  const { detectKnowledgeCwd } = await import('../lib/workspace.js')
  assert.equal(detectKnowledgeCwd([], {}), '')
  assert.equal(detectKnowledgeCwd(['A'], {}), '')
})
