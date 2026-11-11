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
import { computeFbank, FRONTEND_VERSION } from './fbank.js'
import { getModel, buildSpace, DEFAULT_MODEL_ID } from './space.js'
import { l2normalize } from './match.js'

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
      hint: '还没安装声纹模型。把 ' + model.id + ' 的 ONNX 放到 ' + (modelPath || '<数据目录>/voiceprint/models/') + '，或在设置里指定路径。',
    }
  }
  if (!modelPath.toLowerCase().endsWith('.onnx')) {
    return { ok: false, kind: 'onnx', modelId, dim: model.dim, spaceId: space.spaceId, reason: 'model-invalid', hint: '只支持 .onnx 模型文件' }
  }

  let sessionPromise = null
  async function ensureSession() {
    if (sessionPromise) return sessionPromise
    sessionPromise = (async () => {
      let ort = null
      try {
        ort = await import('onnxruntime-node')
      } catch {
        throw new EmbedError('onnx-runtime-missing', '需要 onnxruntime-node 才能跑本地声纹；它没有随插件安装')
      }
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
      const inputName = session.inputNames && session.inputNames[0]
      if (!inputName) throw new EmbedError('model-invalid', '模型没有输入节点')
      const input = new ort.Tensor('float32', fbank.data, [1, fbank.frames, fbank.dim])
      const out = await session.run({ [inputName]: input })
      const outputName = session.outputNames && session.outputNames[0]
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
