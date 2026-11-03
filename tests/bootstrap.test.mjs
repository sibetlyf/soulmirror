import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  mergeDefaults, stripSecrets, ensureConfigFile, installChecklist, formatChecklist,
} from '../lib/bootstrap.js'

const dir = mkdtempSync(join(tmpdir(), 'sm-bootstrap-'))
const file = join(dir, 'config.json')

test('mergeDefaults：已有值优先，缺的补默认', () => {
  const d = { a: 1, b: { c: 2, d: 3 }, arr: [1] }
  const e = { b: { c: 99 }, extra: 'x' }
  const m = mergeDefaults(d, e)
  assert.equal(m.a, 1, '缺失补默认')
  assert.equal(m.b.c, 99, '已有值不覆盖')
  assert.equal(m.b.d, 3, '深层缺失也补')
  assert.equal(m.extra, 'x', '用户额外字段保留')
})

test('stripSecrets：密钥字段不落盘', () => {
  const clean = stripSecrets({ asr: { apiKey: 'sk-secret', model: 'x' }, tts: { token: 't', voice: 'v' }, n: 1 })
  assert.equal(clean.asr.apiKey, undefined)
  assert.equal(clean.tts.token, undefined)
  assert.equal(clean.asr.model, 'x')
  assert.equal(clean.n, 1)
})

test('ensureConfigFile：首次创建带默认值', () => {
  const f = join(dir, 'new.json')
  const r = ensureConfigFile(f, { enabled: false, asr: { sentenceSilenceMs: 400 } })
  assert.equal(r.created, true)
  const j = JSON.parse(readFileSync(f, 'utf8'))
  assert.equal(j.enabled, false)
  assert.equal(j.asr.sentenceSilenceMs, 400)
})

test('ensureConfigFile：已存在时不覆盖用户值，只补新键', () => {
  const f = join(dir, 'exist.json')
  writeFileSync(f, JSON.stringify({ enabled: true, custom: 'keep' }), 'utf8')
  const r = ensureConfigFile(f, { enabled: false, added: 1 })
  assert.equal(r.created, false)
  const j = JSON.parse(readFileSync(f, 'utf8'))
  assert.equal(j.enabled, true, '用户值必须保留')
  assert.equal(j.custom, 'keep')
  assert.equal(j.added, 1, '新键补齐')
})

test('ensureConfigFile：损坏的配置文件不会崩，按默认重建', () => {
  const f = join(dir, 'broken.json')
  writeFileSync(f, '{ not json', 'utf8')
  const r = ensureConfigFile(f, { enabled: false })
  assert.equal(r.created, false)
  assert.ok(existsSync(f))
  const j = JSON.parse(readFileSync(f, 'utf8'))
  assert.equal(j.enabled, false)
})

test('installChecklist：全就绪时为全绿', () => {
  const rows = installChecklist({ configFile: true, bridge: true, key: true, captureDevice: '扬声器', virtualMic: true })
  assert.ok(rows.every((r) => r.ok))
  assert.match(formatChecklist(rows), /全部就绪/)
})

test('installChecklist：缺项给出可执行指引', () => {
  const rows = installChecklist({ configFile: true, bridge: true, key: false, captureDevice: '', virtualMic: false })
  const text = formatChecklist(rows)
  assert.match(text, /还差 3 项/)
  assert.match(text, /DASHSCOPE_API_KEY/)
  assert.match(text, /VB-CABLE/)
  assert.match(text, /meeting_probe_audio/)
})

test('installChecklist：密钥那项明确说"只能你本人做"', () => {
  const rows = installChecklist({ key: false })
  const row = rows.find((r) => r.what.includes('密钥'))
  assert.match(row.fix, /只能你本人做/)
})

test.after(() => {
  try { rmSync(dir, { recursive: true, force: true }) } catch { /* ignore */ }
})
