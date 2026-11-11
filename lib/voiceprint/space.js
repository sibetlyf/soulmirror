/**
 * 声纹「空间」（EmbeddingSpace）——照 OpenASR 的做法，先定义可比性再存向量。
 *
 * 为什么必须有这个东西（参考项目 `diarize/voice_id/space.rs`）：
 *   两个向量只有在**同一个空间**里才可比。维度相同也不算：
 *   模型、前后端版本、前端（fbank）版本、匹配策略任何一项变了，
 *   余弦相似度的分布就整体变了，旧阈值也就失去意义。
 *
 * 我们的差距：参考项目用 ggml/GGUF 的 ReDimNet2-B6，Node 加载不了，
 * 所以这里用同类 ONNX 模型（WeSpeaker ResNet34 / 3D-Speaker CAM++），
 * **前端参数与它完全一致**（见 lib/voiceprint/fbank.js），
 * 并把模型/前端/策略一起写进 space_id。
 */
import { createHash } from 'node:crypto'
import { FRONTEND_VERSION } from './fbank.js'

/** 匹配策略版本：改了打分/聚类/原型上限就要升，否则旧原型不认 */
export const MATCHER_POLICY_VERSION = 'person-medoid-v1'

/**
 * 可用嵌入模型。
 * dim 必须与模型输出一致；modelId 必须能区分导出源（同一个家族不同导出会差）。
 */
export const EMBEDDER_MODELS = Object.freeze({
  'wespeaker-resnet34': {
    id: 'wespeaker-resnet34',
    family: 'wespeaker-resnet',
    version: 'voxceleb-lm-v1',
    dim: 256,
    languages: ['en', 'zh'],
    license: 'Apache-2.0（模型权重许可以导出页为准）',
    note: '参考项目同款家族的 ONNX 导出；前端与 KaldiFbankFrontend 一致',
  },
  'campplus-cn': {
    id: 'campplus-cn',
    family: 'campplus',
    version: '3d-speaker-v1',
    dim: 192,
    languages: ['zh', 'en'],
    license: 'Apache-2.0（模型权重许可以导出页为准）',
    note: '中文场景常用；比 resnet34 小，CPU 更快',
  },
})

export const DEFAULT_MODEL_ID = 'wespeaker-resnet34'

export function getModel(modelId) {
  const id = String(modelId || DEFAULT_MODEL_ID)
  return EMBEDDER_MODELS[id] || null
}

/**
 * 计算 space_id：把"能不能比"的条件压成一个稳定字符串。
 * 顺序与字段都固定，才能跨进程稳定（否则每次启动都算出一个新空间）。
 */
export function buildSpace({ modelId = DEFAULT_MODEL_ID, frontendVersion = FRONTEND_VERSION, matcherPolicy = MATCHER_POLICY_VERSION } = {}) {
  const model = getModel(modelId)
  if (!model) throw new Error('不认识的声纹模型：' + modelId)
  const canonical = {
    dimension: model.dim,
    embedder_family: model.family,
    embedder_model_id: model.id,
    embedder_model_version: model.version,
    frontend_version: String(frontendVersion),
    matcher_policy_version: String(matcherPolicy),
  }
  const spaceId = createHash('sha256').update(JSON.stringify(canonical)).digest('hex').slice(0, 32)
  return {
    spaceId, ...canonical,
    legacy_unverifiable: false,
    /** 两个空间能不能比 */
    comparableTo(other) {
      return !!other && String(other.spaceId) === spaceId
    },
  }
}

/** 只留稳定字段（存盘用；函数不能进 JSON） */
export function spaceRecord(space) {
  return {
    spaceId: space.spaceId,
    dimension: space.dimension,
    embedder_family: space.embedder_family,
    embedder_model_id: space.embedder_model_id,
    embedder_model_version: space.embedder_model_version,
    frontend_version: space.frontend_version,
    matcher_policy_version: space.matcher_policy_version,
  }
}

/** 存量空间是否还能用于匹配（换过模型/前端的旧空间不能） */
export function spaceIsMatchable(record, current) {
  if (!record || record.legacy_unverifiable) return false
  return String(record.spaceId) === String(current.spaceId)
}
