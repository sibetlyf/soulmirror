/**
 * 嵌入器：把一段 16k 单声道 PCM 变成声纹向量。
 *
 * 参考项目用的是 ReDimNet2-B6 的 `.oasr`（GGUF/ggml）包 —— 那是给它自己
 * Rust 引擎的格式，Node 加载不了。所以这里：
 *   · **前端逐参数照抄它**（lib/voiceprint/fbank.js 的 KaldiFbankFrontend）
 *   · 模型换成同类 ONNX（WeSpeaker ResNet34 / 3D-Speaker CAM++），
 *     由用户显式安装，绝不随包塞几十 MB 权重
 *
 * 铁律：**拿不到模型就明确说"没装"，不静默降级**。
 * 调用方（会后整理）看到没装，就保留匿名标签并在界面说明原因，
 * 而不是假装认过了。
 */
import { existsSync, statSync } from 'node:fs'
import { join as joinPath } from 'node:path'
import { pathToFileURL } from 'node:url'
import { computeFbank, FRONTEND_VERSION } from './fbank.js'
import { getModel, buildSpace, DEFAULT_MODEL_ID } from './space.js'
import { l2normalize } from './match.js'
import { readRuntimeMarker, runtimeFilesOk } from './installer.js'

export const EMBEDDER_KINDS = ['onnx', 'test']

/**
 * 建一个嵌入器。
 *
 * @param {{kind?: 'onnx'|'test', modelId?: string, modelPath?: string, logger?: any}} opts
 * @returns {{ok: boolean, kind: string, modelId: string, dim: number, spaceId: string,
 *            reason?: string, hint?: string, embed?: (samples: Float32Array) => Promise<Float32Array>}}
 */
export function createEmbedder(opts = {}) {
  const modelId = String(opts.modelId || DEFAULT_MODEL_ID)
  const model = getModel(modelId)
  if (!model) {
    return { ok: false, kind: 'unknown', modelId, dim: 0, spaceId: '', reason: 'unknown-model', hint: '模型 id 不认识：' + modelId }
  }
  const space = buildSpace({ modelId, frontendVersion: FRONTEND_VERSION })

  if (opts.kind === 'test') return testEmbedder(space, model, modelId)

  const modelPath = String(opts.modelPath || '')
  if (!modelPath || !existsSync(modelPath)) {
    return {
      ok: false, kind: 'onnx', modelId, dim: model.dim, spaceId: space.spaceId,
      reason: 'model-missing',
      hint: '还没安装声纹模型。打开面板「纪要与产物 → 我认识的人 · 本机声纹」，点「一键安装」会自动下载并校验 ONNX 模型；'
        + '装好后自动生效，不用再手动找路径。',
    }
  }
  if (!modelPath.toLowerCase().endsWith('.onnx')) {
    return { ok: false, kind: 'onnx', modelId, dim: model.dim, spaceId: space.spaceId, reason: 'model-invalid', hint: '只支持 .onnx 模型文件' }
  }

  let sessionPromise = null
  async function ensureSession() {
    if (sessionPromise) return sessionPromise
    sessionPromise = (async () => {
      const ort = await loadOrtRuntime(opts.runtimeDir)
      const session = await ort.InferenceSession.create(modelPath, { executionProviders: ['cpu'] })
      return { ort, session }
    })()
    return sessionPromise
  }

  return {
    ok: true, kind: 'onnx', modelId, dim: model.dim, spaceId: space.spaceId,
    frontendVersion: FRONTEND_VERSION,
    async embed(samples) {
      const { ort, session } = await ensureSession()
      const fbank = computeFbank(samples)
      if (!fbank.frames || fbank.dim !== 80) throw new EmbedError('not-enough-audio', '音频太短，算不出足够的帧')
      // 清单里的名字是实测确认过的；会话里只有一个输入时直接用它
      const inputName = opts.inputName && session.inputNames.includes(opts.inputName)
        ? opts.inputName
        : (session.inputNames && session.inputNames[0])
      if (!inputName) throw new EmbedError('model-invalid', '模型没有输入节点')
      const input = new ort.Tensor('float32', fbank.data, [1, fbank.frames, fbank.dim])
      const out = await session.run({ [inputName]: input })
      const outputName = opts.outputName && session.outputNames.includes(opts.outputName)
        ? opts.outputName
        : (session.outputNames && session.outputNames[0])
      const tensor = out[outputName] || out[Object.keys(out)[0]]
      if (!tensor || !tensor.data || !tensor.data.length) throw new EmbedError('model-invalid', '模型没有输出向量')
      const flat = Float32Array.from(tensor.data)
      if (flat.length !== model.dim) {
        throw new EmbedError('dim-mismatch', '模型输出 ' + flat.length + ' 维，与登记的 ' + model.dim + ' 维不一致')
      }
      return l2normalize(flat)
    },
  }
}

/**
 * 加载 onnxruntime：
 *   1. 先找数据目录里自装的运行库（插件的一键安装就解在这里，不写宿主 node_modules）
 *   2. 再退回宿主依赖里的 onnxruntime-node
 * 都没有就明确报错，绝不假装能跑。
 */
export async function loadOrtRuntime(runtimeDir) {
  const candidates = []
  if (runtimeDir) {
    const dist = joinPath(String(runtimeDir), 'package', 'dist', 'index.js')
    if (existsSync(dist)) candidates.push(dist)
  }
  for (const path of candidates) {
    try {
      const mod = await import(pathToFileURL(path).href)
      return mod.default && mod.default.InferenceSession ? mod.default : mod
    } catch (e) {
      throw new EmbedError('onnx-runtime-load-failed',
        '自装运行库加载失败（' + String(runtimeDir) + '）：' + (e && e.message ? e.message : String(e))
        + '｜运行库可能解压不完整（缺 onnxruntime-common 或 native binding），重装一次运行库')
    }
  }
  try {
    const mod = await import('onnxruntime-node')
    return mod.default && mod.default.InferenceSession ? mod.default : mod
  } catch {
    throw new EmbedError('onnx-runtime-missing', '需要 onnxruntime-node；可以用面板上的「一键安装」装到插件数据目录')
  }
}

export class EmbedError extends Error {
  constructor(code, message) { super(message); this.name = 'EmbedError'; this.code = code }
}

/**
 * 测试用确定性嵌入器：把 fbank 的统计量压成向量。
 * **只在测试里用**（SOULMIRROR_TEST 或显式 kind:'test'）；
 * 它不具备任何说话人区分能力，绝不能拿去认人。
 */
function testEmbedder(space, model, modelId) {
  return {
    ok: true, kind: 'test', modelId, dim: model.dim, spaceId: space.spaceId,
    frontendVersion: FRONTEND_VERSION,
    async embed(samples) {
      // 用**绝对**（不做 CMN）的逐频带能量当指纹：
      // 不同音高/音色的音频在频带上分布不同，同一个音频每次都一样。
      // 它没有任何生物特征能力，只保证链路自洽（认人精度必须用真实模型校准）。
      const fbank = computeFbank(samples, { cmn: false })
      const dim = model.dim
      const out = new Float32Array(dim)
      if (!fbank.frames) return l2normalize(out)
      // 关键：log 能量的绝对值会让所有人长得一样（空频带都是同一个极小值）。
      // 这里对每帧做 band softmax（相当于"这一帧的能量分布"），再对时间取平均，
      // 得到一条谱直方图：不同音高/音色分布明显不同，同一段音频每次都一样。
      // 它没有任何生物特征能力，只用来验证链路自洽；真实精度必须用真实模型校准。
      const hist = new Float64Array(fbank.dim)
      for (let f = 0; f < fbank.frames; f++) {
        let maxLog = -Infinity
        for (let m = 0; m < fbank.dim; m++) {
          const v = fbank.data[f * fbank.dim + m]
          if (v > maxLog) maxLog = v
        }
        let sum = 0
        const row = new Float64Array(fbank.dim)
        for (let m = 0; m < fbank.dim; m++) {
          const e = Math.exp(fbank.data[f * fbank.dim + m] - maxLog)
          row[m] = e
          sum += e
        }
        if (sum > 0) for (let m = 0; m < fbank.dim; m++) hist[m] += row[m] / sum
      }
      for (let m = 0; m < fbank.dim; m++) {
        const mean = hist[m] / fbank.frames
        // 80 个频带铺到 dim 槽位，加一点二阶量避免只靠单一维度
        out[m % dim] += mean
        out[(m + 80) % dim] += mean * 0.5
        out[(m + 160) % dim] += Math.sqrt(Math.max(0, mean)) * 0.5
      }
      return l2normalize(out)
    },
  }
}

/** 运行库的现状（数据目录自装的、还是宿主依赖里的） */
export function runtimeStatus(runtimeDir) {
  const dir = runtimeDir ? String(runtimeDir) : ''
  const marker = dir ? readRuntimeMarker(dir) : null
  const installed = !!marker
  // 只看标记不够：上次可能解压到一半被打断，标记在但文件缺了。
  // usable 才是"真的能加载"的判断（界面与路由都用它）。
  const filesOk = installed ? runtimeFilesOk(dir, marker) : false
  return {
    installed,
    version: installed ? String(marker.version || '') : '',
    backend: installed ? String(marker.backend || '') : '',
    dir,
    filesOk,
    usable: installed && filesOk,
  }
}

/** 模型文件的现状（界面要能显示"装没装、多大、在哪"） */
export function modelStatus(modelPath) {
  const path = String(modelPath || '')
  if (!path) return { installed: false, path: '', bytes: 0 }
  try {
    const st = statSync(path)
    return { installed: true, path, bytes: st.size, modifiedAt: st.mtime.toISOString() }
  } catch {
    return { installed: false, path, bytes: 0 }
  }
}
