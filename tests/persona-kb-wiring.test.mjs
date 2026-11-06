import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/**
 * 画像写库的接线（会后流程）。
 *
 * 用户要求：人格管线同时落盘在知识库，作为单独的一个库存在。
 * 已经真机验证过：专属库能建、文档能写、二次同步是**更新**（v2）而不是新增。
 */

const src = readFileSync(new URL('../index.js', import.meta.url), 'utf8')

test('会后会把人像渲染并同步到知识库', () => {
  const at = src.indexOf('人格画像 → 独立知识库')
  assert.ok(at > 0, '找不到画像写库的接入点')
  const seg = src.slice(at, at + 2200)
  assert.match(seg, /renderPersonaDoc\(/, '应渲染画像文档')
  assert.match(seg, /syncPersonaDoc\(/, '应同步到知识库')
  assert.match(seg, /resolveHostPort\(\)/, '应先用宿主端口')
})

test('写库结果如实报告（成功/失败都写进 results）', () => {
  const at = src.indexOf('人格画像 → 独立知识库')
  const seg = src.slice(at, at + 2200)
  assert.match(seg, /results\.personaKb/, '应把结果记进 results')
  assert.match(seg, /kb\.action === 'created'/, '应区分建库与更新')
  assert.match(seg, /kb\.stage/, '失败时应带阶段')
  assert.match(seg, /logger\?\.warn\?/, '失败应记日志')
})

test('画像写库是可选功能：默认关，需显式打开', () => {
  // 用户要求：这个做成可选功能，用户可以自己编辑知识库
  assert.match(src, /cfg\.knowledge\.personaSync === true/, '默认必须是关闭的（只有显式 true 才自动写）')
  assert.match(src, /未开启自动同步/, '关掉时要明确告诉用户"未开启"，而不是静默')
  assert.match(src, /cfg\.knowledge\.personaBaseName/, '库名应可自定义')
})

test('拿不到端口时明确跳过，不假装写过', () => {
  const at = src.indexOf('人格画像 → 独立知识库')
  const seg = src.slice(at, at + 900)
  assert.match(seg, /跳过（拿不到宿主端口）/, '应明确说跳过')
})
