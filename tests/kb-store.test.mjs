/**
 * 知识库索引持久化（kb-store）单测：坏文件兜底、增量、去重、上限、往返。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  emptyStore, loadStore, saveStore, buildFromDocs, docFingerprint, KB_STORE_MAX_DOCS,
} from '../lib/kb-store.js'

function tmp() {
  const dir = mkdtempSync(join(tmpdir(), 'sm-kb-'))
  return { file: join(dir, 'kb-index.json'), clean: () => rmSync(dir, { recursive: true, force: true }) }
}

test('坏文件/缺字段都退回空库，不让索引坏掉拖垮插件', () => {
  const t = tmp()
  try {
    assert.deepEqual(loadStore(t.file), emptyStore(), '文件不存在')
    writeFileSync(t.file, '{ 不是 JSON')
    assert.deepEqual(loadStore(t.file), emptyStore())
    writeFileSync(t.file, '{"version":1,"docs":{}}')
    assert.deepEqual(loadStore(t.file), emptyStore(), 'docs 不是数组也要退回')
  } finally { t.clean() }
})

test('增量：内容没变不重建、变了才更新、新增计 added', () => {
  const t = tmp()
  try {
    const docs = [
      { id: 'm1', title: '站会纪要', text: '决定用 SoulMirror 采集腾讯会议音频。' },
      { id: 'm2', title: '周报', text: '本周完成 PPT 提速调研。' },
    ]
    const r1 = buildFromDocs(emptyStore(), docs)
    assert.equal(r1.added, 2)
    assert.equal(r1.updated, 0)
    assert.equal(r1.store.docs.length, 2)

    // 同一批再来一次：应全部 unchanged（不重复写）
    const r2 = buildFromDocs(r1.store, docs)
    assert.equal(r2.unchanged, 2)
    assert.equal(r2.added, 0)

    // 改一篇 → 只有它是 updated
    const changed = [docs[0], { ...docs[1], text: '本周完成 PPT 提速调研，并补了录制链路。' }]
    const r3 = buildFromDocs(r2.store, changed)
    assert.equal(r3.updated, 1)
    assert.equal(r3.unchanged, 1)
    const m2 = r3.store.docs.find((d) => d.id === 'm2')
    assert.match(m2.sentences.join('；'), /录制链路/, '内容变了索引要跟着变')
  } finally { t.clean() }
})

test('指纹稳定且对内容敏感', () => {
  const a = docFingerprint({ title: 'T', text: 'A'.repeat(50) })
  const b = docFingerprint({ title: 'T', text: 'A'.repeat(50) })
  const c = docFingerprint({ title: 'T', text: 'A'.repeat(49) + 'B' })
  assert.equal(a, b)
  assert.notEqual(a, c)
})

test('上限：超过 maxDocs 只保留最近更新的', () => {
  const docs = []
  for (let i = 0; i < 5; i++) docs.push({ id: 'd' + i, title: '文档' + i, text: '内容' + i + '。这是一段测试文本。' })
  let store = emptyStore()
  for (const d of docs) {
    const r = buildFromDocs(store, [d], { maxDocs: 2 })
    store = r.store
  }
  assert.equal(store.docs.length, 2, '只保留 2 篇')
  assert.equal(store.docs[0].id, 'd4', '最新的在最前')
  assert.ok(KB_STORE_MAX_DOCS >= 50)
})

test('写读往返：带 version/updatedAt，且是缩进 JSON', () => {
  const t = tmp()
  try {
    const r = buildFromDocs(emptyStore(), [{ id: 'x', title: '标题', text: '正文一段。' }])
    saveStore(t.file, r.store)
    const raw = readFileSync(t.file, 'utf8')
    assert.match(raw, /\n  "docs"/, '缩进 JSON 便于人看')
    const back = loadStore(t.file)
    assert.equal(back.docs.length, 1)
    assert.equal(back.docs[0].id, 'x')
    assert.ok(back.updatedAt, '要记录更新时间')
  } finally { t.clean() }
})

test('wiring：启动即增量重建、润色注入知识片段、/auto 有 kb 子动作', () => {
  const idx = readFileSync(new URL('../index.js', import.meta.url), 'utf8')
  // 启动重建（幂等；失败只 warn，不能拖垮启动）
  assert.match(idx, /rebuildKbIndex\(\{ force: true \}\)/, '启动要重建索引')
  assert.match(idx, /启动构建知识库索引失败/, '失败要可见')
  // 落盘 + 只推索引纪要
  assert.match(idx, /KB_INDEX_FILE = join\(CONFIG_DIR, 'kb-index\.json'\)/, '索引要落盘在数据目录')
  assert.match(idx, /minutes\.md/, '数据源是会议纪要')
  assert.match(idx, /listRecordsMerged\(200\)/, '要覆盖所有会议根（换保存位置也不能漏）')
  // 润色时按文本检索知识
  assert.match(idx, /knowledgeBlockFor\(text\)/, '润色必须按当前文本检索知识')
  // 接口
  assert.match(idx, /action === 'kb'/, '/auto 要有 kb 子动作')
  assert.match(idx, /kbExtractTerms\(/, '要能给出词典候选')
  assert.match(idx, /kbSearch\(/, '要能检索')
})
