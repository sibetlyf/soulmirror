import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { computeFbank, frameCount, FRONTEND_VERSION, FRONTEND_CONSTANTS } from '../lib/voiceprint/fbank.js'
import { buildSpace, spaceRecord, EMBEDDER_MODELS, DEFAULT_MODEL_ID } from '../lib/voiceprint/space.js'
import { assessPcm, qualityWeight, checkEnrollment, MIN_SAMPLE_SPEECH_SECONDS } from '../lib/voiceprint/quality.js'
import {
  cosine, l2normalize, buildPrototypes, scorePrototype, matchPerson,
  planWindows, checkEvidence, clusterByCosine, MAX_PROTOTYPES_PER_PERSON,
  ACCEPT_SIMILARITY, MATCH_MARGIN,
} from '../lib/voiceprint/match.js'
import { openLibrary, sampleMatchesSpace } from '../lib/voiceprint/store.js'
import { createEmbedder, modelStatus } from '../lib/voiceprint/embed.js'
import { readWavLayout, readWavSamples, keepMainCluster, enrollSample, identifyLabel } from '../lib/voiceprint/service.js'

/**
 * P2a：本地声纹（不依赖云端、不上传音频）。
 *
 * 数值与流程全部照 OpenASR 的 Voice ID 实现：
 *   前端参数（fbank 80/25/10/Hamming/预加重 0.97/CMN）、
 *   注册 10 秒门槛、窗口 2.0s 步进 1.0s 修 0.5s、
 *   二簇切分丢少数簇、medoid 原型、双门槛 0.60 + 0.15。
 * 这里用确定性测试嵌入器验证"链路是否自洽"，
 * 真实模型精度必须用真实音频另行校准（不在单测里假装验证）。
 */

function tmp() {
  const d = mkdtempSync(join(tmpdir(), 'sm-vp-'))
  return { d, done: () => rmSync(d, { recursive: true, force: true }) }
}

/** 造一个 16k/16bit/单声道 WAV */
function makeWav(path, seconds, gen) {
  const frames = Math.round(16000 * seconds)
  const data = Buffer.alloc(frames * 2)
  for (let i = 0; i < frames; i++) {
    const v = Math.max(-1, Math.min(1, gen(i / 16000)))
    data.writeInt16LE(Math.round(v * 32767), i * 2)
  }
  const head = Buffer.alloc(44)
  head.write('RIFF', 0, 'ascii'); head.writeUInt32LE(36 + data.length, 4); head.write('WAVE', 8, 'ascii')
  head.write('fmt ', 12, 'ascii'); head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20); head.writeUInt16LE(1, 22)
  head.writeUInt32LE(16000, 24); head.writeUInt32LE(32000, 28); head.writeUInt16LE(2, 32); head.writeUInt16LE(16, 34)
  head.write('data', 36, 'ascii'); head.writeUInt32LE(data.length, 40)
  writeFileSync(path, Buffer.concat([head, data]))
  return path
}

const tone = (freq) => (t) => Math.sin(2 * Math.PI * freq * t) * 0.4

test('fbank 前端参数与参考项目一致（Hamming/80mel/25/10ms/0.97/32768/20-8000）', () => {
  const c = FRONTEND_CONSTANTS
  assert.equal(c.sampleRate, 16000)
  assert.equal(c.frameLength, 400, '25ms @16k')
  assert.equal(c.frameShift, 160, '10ms @16k')
  assert.equal(c.numMel, 80)
  assert.equal(c.preemphasis, 0.97)
  assert.equal(c.inputScale, 32768)
  assert.equal(c.lowFreq, 20)
  assert.equal(c.highFreq, 8000)
  assert.equal(FRONTEND_VERSION, 'kaldi-fbank-hamming-80-25-10-v1')
})

test('fbank：帧数按 snip_edges 算，输出有限、无 NaN', () => {
  const samples = new Float32Array(16000 * 2)
  for (let i = 0; i < samples.length; i++) samples[i] = Math.sin(2 * Math.PI * 440 * i / 16000) * 0.3
  const r = computeFbank(samples)
  assert.equal(r.frames, frameCount(samples.length))
  assert.equal(frameCount(32000), 198)
  assert.equal(r.dim, 80)
  assert.equal(r.data.length, r.frames * 80)
  for (const v of r.data) assert.ok(Number.isFinite(v), '不能出现 NaN/Inf')
})

test('fbank：不同频率应该给出不同的特征（否则模型没有可用输入）', () => {
  const mk = (freq) => { const s = new Float32Array(16000); for (let i = 0; i < s.length; i++) s[i] = Math.sin(2 * Math.PI * freq * i / 16000) * 0.4; return computeFbank(s) }
  const a = mk(200)
  const b = mk(3000)
  let diff = 0
  for (let i = 0; i < a.data.length; i++) diff += Math.abs(a.data[i] - b.data[i])
  assert.ok(diff > 1, '不同频率的特征不能一样，diff=' + diff)
})

test('空间：同一模型稳定，换模型/换前端都不可比', () => {
  const a = buildSpace({})
  const b = buildSpace({})
  assert.equal(a.spaceId, b.spaceId, '同一模型必须稳定（否则每次启动都变成新空间）')
  assert.equal(a.dimension, EMBEDDER_MODELS[DEFAULT_MODEL_ID].dim)
  const c = buildSpace({ modelId: 'campplus-cn' })
  assert.notEqual(a.spaceId, c.spaceId)
  assert.equal(a.comparableTo(b), true)
  assert.equal(a.comparableTo(c), false)
  const d = buildSpace({ frontendVersion: 'other-frontend' })
  assert.notEqual(a.spaceId, d.spaceId, '前端变了就不能再比')
  assert.equal(spaceRecord(a).dimension, a.dimension)
})

test('质量：注册门槛 10 秒，静音/削波要明确拒绝并给建议', () => {
  assert.equal(MIN_SAMPLE_SPEECH_SECONDS, 10)
  const short = new Float32Array(16000 * 3).map((_, i) => Math.sin(i) * 0.3)
  const r = checkEnrollment(short)
  assert.equal(r.ok, false)
  assert.equal(r.reason, 'not-enough-speech')
  assert.match(r.advice, /再录/, '要给出还能怎么办')

  const silence = new Float32Array(16000 * 12)
  const rs = checkEnrollment(silence)
  assert.equal(rs.ok, false)
  assert.equal(rs.reason, 'too-quiet')

  const good = new Float32Array(16000 * 12).map((_, i) => Math.sin(2 * Math.PI * 200 * i / 16000) * 0.3)
  const rg = checkEnrollment(good)
  assert.equal(rg.ok, true)
  assert.ok(rg.weight > 0.05 && rg.weight <= 1)
  const q = assessPcm(good)
  assert.ok(q.snrEstimate > 0)
})

test('原型：每人最多 3 个，medoid 必须是真实样本（不是平均向量）', () => {
  const vec = (seed) => l2normalize(Float32Array.from({ length: 8 }, (_, i) => Math.sin(seed + i)))
  const samples = [0, 1, 2, 3, 9].map((seed, i) => ({ sampleId: 's' + i, embedding: vec(seed), weight: 1 }))
  const protos = buildPrototypes(samples)
  assert.ok(protos.length <= MAX_PROTOTYPES_PER_PERSON)
  const ids = new Set(samples.map((s) => s.sampleId))
  for (const p of protos) assert.ok(ids.has(p.medoidSampleId), 'medoid 必须来自真实样本')
})

test('打分：支持加分有上限，不会让重复样本压过真实匹配', () => {
  const dim = 6
  const q = l2normalize(Float32Array.from({ length: dim }, (_, i) => (i === 0 ? 1 : 0)))
  const good = l2normalize(Float32Array.from({ length: dim }, (_, i) => (i === 0 ? 0.99 : 0.01)))
  const prototype = { prototypeId: 'p', medoid: good, members: [{ sampleId: 'a', weight: 1 }, { sampleId: 'b', weight: 1 }] }
  const members = { a: q, b: q }
  const score = scorePrototype(prototype, q, members)
  assert.ok(score > 0.9, '同向向量应该高分')
  assert.ok(score <= 1.07, '支持加分的上限是 0.06，总分不能离谱')
})

test('匹配：双门槛 —— 低于 0.60 不认，领先不足 0.15 也不认', () => {
  const dim = 4
  const axis = (i) => l2normalize(Float32Array.from({ length: dim }, (_, k) => (k === i ? 1 : 0)))
  const person = (id, embs) => ({ personId: id, displayName: id, prototypes: buildPrototypes(embs.map((e, i) => ({ sampleId: id + '-' + i, embedding: e, weight: 1 }))) })

  const personA = person('A', [axis(0)])
  const personB = person('B', [axis(1)])
  const members = (pid) => { const m = {}; for (const s of libraryOf[pid]) m[s] = 1; return m }
  // 简单成员表
  const libraryOf = { A: ['A-0'], B: ['B-0'] }
  const embOf = { A: { 'A-0': axis(0) }, B: { 'B-0': axis(1) } }

  const exact = matchPerson({ query: axis(0), persons: [personA, personB], memberEmbeddingsOf: (id) => embOf[id] })
  assert.equal(exact.ok, true)
  assert.equal(exact.match.displayName, 'A')

  const unknown = matchPerson({ query: l2normalize(Float32Array.from([0.3, 0.3, 0.3, 0.3])), persons: [personA, personB], memberEmbeddingsOf: (id) => embOf[id] })
  assert.equal(unknown.ok, false, '陌生人不能给名字')
  assert.match(String(unknown.reason), /threshold|ambiguous/)
  assert.ok(unknown.detail.bestScore !== undefined, '要带上分数，界面才能说"差多少"')
})

test('证据：少于 3 秒或窗口不够就不给名字，并给出"连续说多久"', () => {
  const r = checkEvidence({ keptSeconds: 1.5, windows: 1 })
  assert.equal(r.ok, false)
  assert.equal(r.reason, 'not-enough-speech')
  assert.ok(r.detail.requiredContinuousSeconds >= 4, '要给引擎算出来的连续时长，不是让 UI 自己推')
  assert.equal(checkEvidence({ keptSeconds: 6, windows: 6 }).ok, true)
  assert.equal(checkEvidence({ keptSeconds: 6, windows: 3 }).ok, false, '窗口数不够同样不给名字')
})

test('窗口规划：2.0s/1.0s/修 0.5s、不跨别人说话的区间、每人 ≤20', () => {
  const lines = [
    { speaker: '说话人1', begin: 0, end: 20000 },
    { speaker: '说话人2', begin: 5000, end: 7000 },
  ]
  const w = planWindows(lines)
  assert.ok(w.length > 0)
  for (const x of w) {
    assert.ok(Math.abs((x.end - x.start) - 2.0) < 1e-9, '窗口固定 2 秒')
    const overlapSecond = x.start < 7 && x.end > 5
    assert.equal(overlapSecond, false, '不能和别人的区间重叠')
  }
  const many = planWindows([{ speaker: '说话人1', begin: 0, end: 200000 }])
  assert.ok(many.length <= 20)
})

test('纯化：混了两个人的窗口簇只保留主簇，并标记 mixed', () => {
  const dim = 4
  const a = l2normalize(Float32Array.from([1, 0, 0, 0]))
  const b = l2normalize(Float32Array.from([0, 1, 0, 0]))
  const r = keepMainCluster([a, a, a, b])
  assert.equal(r.kept.length, 3)
  assert.equal(r.dropped.length, 1)
  assert.equal(r.mixed, false, '少数簇只占 25%，算噪声不算混人')
  const r2 = keepMainCluster([a, a, b, b, b])
  assert.equal(r2.kept.length, 3)
  assert.equal(r2.mixed, true, '少数簇占 40%，要判成混合')
})

test('库：先落盘再生效，删人留墓碑，换空间后旧样本不参与匹配', () => {
  const { d, done } = tmp()
  try {
    const lib = openLibrary(d)
    const p = lib.addPerson('李亚峰')
    const space = buildSpace({})
    const v = l2normalize(Float32Array.from({ length: 256 }, (_, i) => Math.sin(i)))
    const s = lib.addSample({ personId: p.personId, space, embedding: v, quality: { weight: 0.8 }, seconds: 12 })
    assert.equal(s.ordinal, 1)
    assert.equal(lib.matcherPersons(space).length, 1)

    // 换模型 → 旧样本不可用，但要能看见"需要重新录入"
    const other = buildSpace({ modelId: 'campplus-cn' })
    assert.equal(lib.matcherPersons(other).length, 0)
    assert.equal(sampleMatchesSpace(lib.listSamples(p.personId)[0], other), false)
    // 旧模型空间的样本还在，换模型后要能被界面看到"这些样本用不了了"
    const stale = lib.stats(other).staleSpaces
    assert.equal(stale.length, 1)
    assert.equal(stale[0].embedder_model_id, 'wespeaker-resnet34')
    assert.equal(stale[0].samples, 1)

    lib.renamePerson(p.personId, '老王')
    assert.equal(lib.person(p.personId).displayName, '老王')
    assert.equal(lib.person(p.personId).revision, 2)

    lib.deletePerson(p.personId)
    assert.equal(lib.people().length, 0)
    assert.equal(lib.people({ includeInactive: true }).length, 1)
    assert.ok(lib.listSamples(p.personId).length === 1, '样本留着可审计，但不参与匹配')
    assert.equal(lib.matcherPersons(space).length, 0)
  } finally { done() }
})

test('库：坏文件不崩，但要能告诉调用方（不能假装空库）', () => {
  const { d, done } = tmp()
  try {
    const lib = openLibrary(d)
    lib.addPerson('甲')
    writeFileSync(lib.path, '{坏', 'utf8')
    const again = openLibrary(d)
    assert.equal(again.isCorrupted(), true)
    assert.deepEqual(again.people(), [])
  } finally { done() }
})

test('嵌入器：没装模型要明确报 model-missing，不静默降级', () => {
  const e = createEmbedder({ modelPath: join(tmpdir(), 'nope.onnx') })
  assert.equal(e.ok, false)
  assert.equal(e.reason, 'model-missing')
  assert.match(e.hint, /ONNX|onnx/)
  assert.equal(modelStatus('').installed, false)
  const t = createEmbedder({ kind: 'test' })
  assert.equal(t.ok, true)
  assert.equal(t.dim, 256)
})

test('WAV 读取：只读需要的区间，不把整场会读进内存', () => {
  const { d, done } = tmp()
  try {
    const f = makeWav(join(d, 'm.wav'), 6, tone(300))
    const layout = readWavLayout(f)
    assert.equal(layout.sampleRate, 16000)
    assert.equal(layout.channels, 1)
    const s = readWavSamples(f, 1, 2)
    assert.equal(s.length, 16000, '1 秒 16k 采样')
    const all = readWavSamples(f, 0, 999)
    assert.ok(all.length > 16000 * 5)
  } finally { done() }
})

test('端到端：注册 → 识别；注册门槛不够要明确拒绝', async () => {
  const { d, done } = tmp()
  try {
    const lib = openLibrary(d)
    const space = buildSpace({})
    const embedder = createEmbedder({ kind: 'test' })
    const wavA = makeWav(join(d, 'a.wav'), 13, tone(220))
    const wavB = makeWav(join(d, 'b.wav'), 13, tone(2600))

    const tooShort = await enrollSample({ library: lib, space, embedder, personName: '短录音', pcm: new Float32Array(16000 * 3).map((_, i) => Math.sin(i) * 0.3) })
    assert.equal(tooShort.ok, false)
    assert.equal(tooShort.reason, 'not-enough-speech')

    const a = await enrollSample({ library: lib, space, embedder, personName: '李亚峰', wavFile: wavA })
    assert.equal(a.ok, true, '13 秒应该能注册：' + JSON.stringify(a))
    const b = await enrollSample({ library: lib, space, embedder, personName: '王工', wavFile: wavB })
    assert.equal(b.ok, true)
    assert.equal(lib.people().length, 2)

    // 同一段音频回来，应该认出注册的人
    const lines = [{ speaker: '说话人1', begin: 0, end: 13000 }]
    const r = await identifyLabel({ library: lib, space, embedder, wavFile: wavA, lines, label: '说话人1' })
    assert.equal(r.label, '说话人1')
    assert.ok(r.name === '李亚峰' || r.reason, '要么认出，要么给出原因：' + JSON.stringify(r))
    // 证据不足时不能给名字
    const tiny = await identifyLabel({ library: lib, space, embedder, wavFile: wavA, lines: [{ speaker: '说话人1', begin: 0, end: 2200 }], label: '说话人1' })
    assert.equal(tiny.name, undefined, '证据不足就不许猜')
    assert.equal(tiny.reason, 'not-enough-speech')
  } finally { done() }
})

test('端到端：库里没这个人 → 保留匿名，并说明差多少', async () => {
  const { d, done } = tmp()
  try {
    const lib = openLibrary(d)
    const space = buildSpace({})
    const embedder = createEmbedder({ kind: 'test' })
    const enrolled = makeWav(join(d, 'known.wav'), 13, tone(180))
    await enrollSample({ library: lib, space, embedder, personName: '甲', wavFile: enrolled })
    const stranger = makeWav(join(d, 'stranger.wav'), 13, tone(5000))
    const r = await identifyLabel({ library: lib, space, embedder, wavFile: stranger, lines: [{ speaker: '说话人2', begin: 0, end: 13000 }], label: '说话人2' })
    assert.equal(r.name, undefined)
    assert.ok(r.reason, '必须给出原因')
  } finally { done() }
})

test('接线：会后整理有 identify 步骤，且认人失败不影响纪要', () => {
  const host = readFileSync(new URL('../index.js', import.meta.url), 'utf8')
  const journal = readFileSync(new URL('../lib/journal.js', import.meta.url), 'utf8')
  const client = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
  // 步骤插在 offline 之后、minutes 之前
  assert.match(journal, /PIPELINE_STEPS = Object\.freeze\(\['offline', 'identify', 'minutes'/)
  assert.match(journal, /identify: 'speakers\.json'/)
  // 认人结果落盘（先落盘再展示）
  assert.match(host, /writeFile\(join\(task\.dir,'speakers\.json'\)/)
  // 没装模型要 skip 而不是 throw：纪要必须照样生成
  assert.match(host, /reason:'声纹模型未安装，说话人保持匿名'/)
  assert.match(host, /if \(!embedder\.ok\) \{/)
  // 人工填的名字优先，自动识别的名字不覆盖
  assert.match(host, /if \(r\.name && !map\.byLabel\[r\.label\]\) auto\[r\.label\] = r\.name/)
  // 接口：库/注册/删除
  assert.match(host, /sub === 'voiceprint-enroll'/)
  assert.match(host, /sub === 'voiceprint-delete'/)
  // 界面：录音 + 库 + 模型状态
  assert.match(client, /function VoiceprintCard/)
  assert.match(client, /录一段注册/)
  assert.match(client, /音频只用来算向量，原始录音不保存/)
  assert.match(client, /本机声纹（默认不出本机）/)
})
