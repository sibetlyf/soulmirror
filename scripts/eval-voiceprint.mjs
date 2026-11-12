/**
 * 用一场真实会议录音评估声纹：不是"能不能跑"，而是"分不分得开、会不会误认"。
 *
 * 步骤：读离线转写里的说话人标签与区间 → 每个说话人用产品自己的窗口规则切窗
 *      （planWindows）→ 真实 ONNX 模型算向量 → keepMainCluster 纯化 →
 *      报同人内部 / 不同人之间 / 交叉误认三类数。
 * 只读，不写用户数据。
 */
import { readFileSync, existsSync } from 'node:fs'
import { createEmbedder, runtimeStatus, modelStatus } from '../lib/voiceprint/embed.js'
import { planWindows, cosine, ACCEPT_SIMILARITY, MATCH_MARGIN } from '../lib/voiceprint/match.js'
import { readWavSamples, keepMainCluster, l2normalize } from '../lib/voiceprint/service.js'
import { installedModelPath, loadManifest, runtimeDir } from '../lib/voiceprint/installer.js'

const DATA_ROOT = process.argv[2] || 'C:/Users/liyafeng/.dsh/soulmirror'
const DIR = process.argv[3] || (DATA_ROOT + '/2026-11-12T02-42-16-334Z-auto')
const MODEL_ID = 'wespeaker-resnet34-zh'

const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0)
const centroid = (embs) => {
  const out = new Float32Array(embs[0].length)
  for (const e of embs) for (let i = 0; i < e.length; i++) out[i] += e[i]
  for (let i = 0; i < out.length; i++) out[i] /= embs.length
  return l2normalize(out)
}

const manifest = loadManifest()
const entry = manifest.models.find((m) => m.id === MODEL_ID)
const modelPath = installedModelPath(DATA_ROOT, { file: entry.file })
console.log('=== 准备 ===')
console.log('模型:', MODEL_ID, '| 存在=' + existsSync(modelPath), '| sha256 ' + entry.sha256.slice(0, 12))
console.log('运行库:', JSON.stringify(runtimeStatus(runtimeDir(DATA_ROOT))).slice(0, 120))
console.log('模型状态:', JSON.stringify(modelStatus(modelPath)).slice(0, 120))

const embedder = await createEmbedder({
  kind: 'onnx',
  modelId: MODEL_ID,
  modelPath,
  runtimeDir: runtimeDir(DATA_ROOT),
  inputName: entry.inputName,
  outputName: entry.outputName,
})
if (!embedder || embedder.ok === false) {
  console.error('嵌入器不可用:', JSON.stringify(embedder))
  process.exit(1)
}
console.log('嵌入器: kind=' + embedder.kind + ' dim=' + embedder.dim + ' space=' + String(embedder.spaceId).slice(0, 40))

const lines = readFileSync(DIR + '/transcript-offline.jsonl', 'utf8')
  .trim().split('\n').map((x) => { try { return JSON.parse(x) } catch { return null } })
  .filter((l) => l && l.text && l.begin != null && l.end != null)

const byLabel = new Map()
for (const l of lines) {
  if (!byLabel.has(l.speaker)) byLabel.set(l.speaker, [])
  byLabel.get(l.speaker).push(l)
}
console.log('\n=== 说话人（云端离线转写给的标签）===')
for (const [label, ls] of byLabel) {
  console.log(label, '句=' + ls.length, '时长=' + (ls.reduce((s, l) => s + (l.end - l.begin) / 1000, 0)).toFixed(1) + 's')
}

const t0 = Date.now()
const people = {}
for (const [label, ls] of byLabel) {
  const others = [...byLabel].filter(([k]) => k !== label).flatMap(([, v]) => v)
  // planWindows 以"第一条线的说话人"目标：把目标说话人的线放前面，其他人放后面
  const plan = planWindows([...ls, ...others], { window: 2.0, step: 1.0, trim: 0.5, maxWindows: 20 })
  const wins = plan.slice(0, 20)
  const embs = []
  const t1 = Date.now()
  for (const w of wins) {
    const pcm = readWavSamples(DIR + '/audio.wav', w.start, w.end)
    embs.push(await embedder.embed(pcm))
  }
  const ms = Date.now() - t1
  const keep = keepMainCluster(embs)
  const keptEmbs = keep.kept.map((i) => embs[i])
  people[label] = { wins, embs: keptEmbs, dropped: keep.dropped.length, mixed: keep.mixed, ms }
  console.log('\n' + label + ': 计划 ' + plan.length + ' 窗 · 实算 ' + wins.length + ' 窗 · 保留 ' + keptEmbs.length
    + ' · 丢 ' + keep.dropped.length + (keep.mixed ? '（判为混人）' : '')
    + ' · ' + ms + 'ms · ' + Math.round(ms / Math.max(1, wins.length)) + 'ms/窗')
  if (wins.length) console.log('   窗口区间: ' + wins.slice(0, 6).map((w) => w.start.toFixed(1) + '-' + w.end.toFixed(1)).join(' , ') + (wins.length > 6 ? ' …' : ''))
}

const labels = Object.keys(people).filter((l) => people[l].embs.length > 0)

console.log('\n=== 不同说话人之间（应低）===')
for (let i = 0; i < labels.length; i++) {
  for (let j = i + 1; j < labels.length; j++) {
    const A = people[labels[i]].embs, B = people[labels[j]].embs
    const vals = []
    for (const a of A) for (const b of B) vals.push(cosine(a, b))
    console.log(labels[i] + ' ↔ ' + labels[j] + ' : 均值 ' + mean(vals).toFixed(3) + ' · 最大 ' + Math.max(...vals).toFixed(3) + ' · ' + vals.length + ' 对')
  }
}

console.log('\n=== 同一说话人内部（应高）===')
for (const l of labels) {
  const A = people[l].embs
  const vals = []
  for (let i = 0; i < A.length; i++) for (let j = i + 1; j < A.length; j++) vals.push(cosine(A[i], A[j]))
  console.log(l + ' : ' + (vals.length
    ? '均值 ' + mean(vals).toFixed(3) + ' · 最小 ' + Math.min(...vals).toFixed(3) + ' · ' + vals.length + ' 对'
    : '只有 1 个窗口，无法算'))
}

console.log('\n=== 交叉误认测试（阈值 ' + ACCEPT_SIMILARITY + ' · margin ' + MATCH_MARGIN + '）===')
for (const target of labels) {
  const ref = centroid(people[target].embs)
  const selfScores = people[target].embs.map((e) => cosine(ref, e))
  const parts = []
  for (const other of labels) {
    if (other === target) continue
    const scores = people[other].embs.map((e) => cosine(ref, e))
    const mx = Math.max(...scores)
    parts.push(other + ' 最高 ' + mx.toFixed(3) + (mx >= ACCEPT_SIMILARITY ? ' ⚠会误认' : ' ✓不误认'))
  }
  console.log('基准「' + target + '」本人均值 ' + mean(selfScores).toFixed(3) + ' | ' + parts.join(' | '))
}

console.log('\n总耗时 ' + (Date.now() - t0) + 'ms')
