#!/usr/bin/env node
/**
 * 命令行安装声纹模型 + 运行库（与面板上的「一键安装」同一套逻辑）。
 *
 * 用法：
 *   node scripts/fetch-voiceprint-model.mjs                 # 默认模型 + 运行库
 *   node scripts/fetch-voiceprint-model.mjs --model campplus-zh
 *   node scripts/fetch-voiceprint-model.mjs --model-only    # 只装模型（不装运行库、不做自检）
 *   node scripts/fetch-voiceprint-model.mjs --dir D:\data   # 指定数据目录
 *   node scripts/fetch-voiceprint-model.mjs --list          # 看清单和已装状态
 *
 * 与参考项目一致的做法：清单里有 sha256/sha512 与大小，先校验再落盘，
 * 安装是原子的（.part → rename）；任何一步失败都返回非零退出码并说明原因。
 * Ctrl+C 会中止下载并清理临时文件。
 */
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { homedir } from 'node:os'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
// Windows 上绝对路径必须转成 file:// URL 才能被 ESM 加载器接受
const mod = (rel) => pathToFileURL(join(root, rel)).href
const {
  loadManifest, findModel, defaultModelId, installModel, installRuntime,
  installedModels, modelDir, runtimeDir,
} = await import(mod('lib/voiceprint/installer.js'))

const args = process.argv.slice(2)
const flag = (name) => args.includes('--' + name)
const value = (name, fallback = '') => {
  const i = args.indexOf('--' + name)
  return i > -1 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback
}

/** 数据目录：--dir > SOULMIRROR_DATA_DIR > 默认 DSH profile 目录 */
function dataDir() {
  const explicit = value('dir')
  if (explicit) return explicit
  if (process.env.SOULMIRROR_DATA_DIR) return process.env.SOULMIRROR_DATA_DIR
  return join(homedir(), '.dsh', 'profiles', 'web', 'plugins', 'soulmirror-data')
}

const manifest = loadManifest()

if (flag('list')) {
  console.log('清单模型：')
  for (const m of manifest.models) {
    console.log('  - ' + m.id + '  ' + m.displayName + '  ' + m.dim + ' 维 · ' + Math.round(m.bytes / 1048576) + ' MB · ' + m.license)
    console.log('    sha256 ' + m.sha256)
  }
  const installed = await installedModels(modelDir(dataDir()), manifest)
  console.log('\n已装状态（' + modelDir(dataDir()) + '）：')
  for (const m of installed) console.log('  - ' + m.id + '：' + (m.exists ? (m.verified ? '已装且校验通过' : '文件在但校验不通过（请删掉重装）') : '未安装'))
  const rt = manifest.runtime || {}
  const rtDir = runtimeDir(dataDir())
  const { runtimeStatus } = await import(mod('lib/voiceprint/embed.js'))
  const st = runtimeStatus(rtDir)
  console.log('\n运行库（' + rt.backend + ' ' + rt.version + '）：' + st.dir)
  console.log('  - ' + (st.usable ? '已装且文件齐全' : (st.installed ? '标记在但文件不全（重装一次）' : '未安装'))
    + (rt.usable ? '' : ''))
  process.exit(0)
}

const modelId = value('model', defaultModelId(manifest))
const model = findModel(manifest, modelId)
if (!model) {
  console.error('清单里没有这个模型：' + modelId + '（用 --list 看可选项）')
  process.exit(2)
}

// Ctrl+C：中止下载 → downloadFile 删掉 .part → 这里如实退出（不假装成功）
const ac = new AbortController()
let interrupted = 0
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    interrupted++
    if (interrupted > 1) process.exit(130)
    console.error('\n收到 ' + sig + '：正在中止并清理临时文件…（再按一次强制退出）')
    ac.abort()
  })
}

console.log('数据目录：' + dataDir())
console.log('模型：' + model.displayName + '（' + model.dim + ' 维，' + Math.round(model.bytes / 1048576) + ' MB）')
console.log('来源：' + model.urls[0])
console.log('校验：sha256 ' + model.sha256)

const mb = (n) => Math.round((Number(n) || 0) / 1048576 * 10) / 10
let lastLine = ''
const onProgress = (p) => {
  if (p.phase === 'download-model' || p.phase === 'download-runtime') {
    const pct = p.total ? Math.floor((p.received / p.total) * 100) : 0
    const line = '  ' + p.phase + ' ' + pct + '% (' + mb(p.received) + '/' + mb(p.total) + ' MB)'
    if (line !== lastLine) { lastLine = line; process.stdout.write('\r' + line + '   ') }
  } else {
    const line = '  ' + p.phase + (p.package ? ' ' + p.package : '') + (p.failed ? ' 失败：' + p.message : '')
    process.stdout.write('\r' + line + '                    \n')
    lastLine = ''
  }
}

const modelRes = await installModel({ manifest, modelId, modelsDir: modelDir(dataDir()), onProgress, signal: ac.signal })
process.stdout.write('\n')
if (!modelRes.ok) {
  console.error('模型安装失败：' + (modelRes.message || modelRes.reason))
  console.error('（' + (modelRes.reason === 'canceled' ? '已按你的要求中止，临时文件已清理' : '可以重试；反复失败就检查网络/代理') + '）')
  process.exit(modelRes.reason === 'canceled' ? 130 : 1)
}
console.log('模型已装：' + modelRes.path + (modelRes.alreadyInstalled ? '（已存在且校验通过，跳过下载）' : '（sha256 校验通过）'))

if (!flag('model-only')) {
  lastLine = ''
  const runtimeRes = await installRuntime({ manifest, runtimeDir: runtimeDir(dataDir()), onProgress, signal: ac.signal })
  process.stdout.write('\n')
  if (!runtimeRes.ok) {
    console.error('运行库安装失败：' + (runtimeRes.message || runtimeRes.reason))
    console.error('（模型已装好；可以重跑本脚本，或按 docs/development.md 手动安装 onnxruntime-node）')
    process.exit(runtimeRes.reason === 'canceled' ? 130 : 1)
  }
  console.log('运行库已装：' + runtimeRes.dir + (runtimeRes.alreadyInstalled ? '（已存在且文件齐全）' : '（sha512 校验通过，解压完成）'))
}

// 自检：真的加载运行库 + 建 session + 算一条向量（不是"文件在就算好"）
const { createEmbedder, runtimeStatus } = await import(mod('lib/voiceprint/embed.js'))
const rtState = runtimeStatus(runtimeDir(dataDir()))
if (flag('model-only') && !rtState.usable) {
  console.log('跳过自检：--model-only 且运行库未装（装运行库后再跑一次本脚本即可自检）')
  process.exit(0)
}
try {
  const e = createEmbedder({
    modelPath: join(modelDir(dataDir()), model.file),
    runtimeDir: runtimeDir(dataDir()),
    modelId,
    inputName: model.inputName,
    outputName: model.outputName,
  })
  if (!e.ok) {
    console.error('自检失败：' + (e.reason || '') + (e.hint ? '｜' + e.hint : ''))
    process.exit(1)
  }
  const pcm = new Float32Array(16000 * 2)
  for (let i = 0; i < pcm.length; i++) pcm[i] = Math.sin(2 * Math.PI * 180 * i / 16000) * 0.3
  const t0 = Date.now()
  const v = await e.embed(pcm)
  console.log('自检通过：' + v.length + ' 维，' + (Date.now() - t0) + ' ms / 2 秒音频（模型 ' + modelId + '，运行库 ' + rtState.backend + ' ' + rtState.version + '）')
} catch (err) {
  console.error('自检失败：' + (err && err.message ? err.message : err))
  process.exit(1)
}
