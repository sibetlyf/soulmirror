import { test } from 'node:test'
import assert from 'node:assert/strict'
import { collectIssues, topIssue } from '../lib/issues.js'

/**
 * "宿主在跑旧代码"必须被主动报出来。
 *
 * 反复踩的坑：改了 index.js、也部署了，但 DSH 宿主没重启，
 * 界面上一直是旧行为（体检报"mbridge.exe 不存在"，实际是旧代码里的
 * toolsDir is not a function 被当成文件不存在）。
 * 用户不可能知道要重启宿主，所以由插件自己说。
 */

test('宿主过期时排在最前，并明确给出"重启 DSH"的动作', () => {
  const list = collectIssues({
    host: { stale: true, bootedAt: 1000, codeMtime: 2000 },
    capturing: true,
    transcriptLines: 0,
    lastLineAgeSec: 120,
    asr: { online: false },
  })
  const top = topIssue(list)
  assert.equal(top.id, 'host-stale', '应压过其它问题排第一')
  assert.match(top.title, /旧代码/)
  assert.match(top.fix, /重启 DSH/)
  assert.match(top.fix, /不是刷新页面/, '要说清楚是重启宿主，不是刷页面')
})

test('宿主是最新的就不报', () => {
  const list = collectIssues({ host: { stale: false } })
  assert.equal(list.some((x) => x.id === 'host-stale'), false)
})

test('没有 host 信息时也不误报', () => {
  const list = collectIssues({ capturing: true, transcriptLines: 5, lastLineAgeSec: 2 })
  assert.equal(list.some((x) => x.id === 'host-stale'), false)
})
