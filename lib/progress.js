/**
 * 会后整理的分阶段进度。
 *
 * 为什么需要：
 *   会后整理是一条长链路（体检 → 上传 → 云端识别 → 写文件 → 后台任务写纪要 → 落库）。
 *   之前只有一个大阶段标签（"会后转写中"/"生成纪要中"），
 *   用户无从判断是卡住了、在排队、还是快好了——尤其离线识别要几十秒到几分钟。
 *
 * 设计：
 *   · 阶段显式声明权重（云端识别最重，占大头），百分比按权重累计
 *   · 阶段可带 details（已上传 MB、识别出多少句、已等待秒数），给用户实感
 *   · 纯函数 + 可注入时钟，便于单测
 */

/** 离线重转写：体检 → 上传 → 云端识别 → 落盘 */
export const OFFLINE_STAGES = [
  { id: 'prepare', label: '检查录音', weight: 5 },
  { id: 'upload', label: '上传录音', weight: 20 },
  { id: 'recognize', label: '云端识别中', weight: 60 },
  { id: 'write', label: '写入转写文件', weight: 10 },
  { id: 'done', label: '转写完成', weight: 5 },
]

/** 纪要生成：准备 → 起后台任务 → 等模型写 → 读回 */
export const MINUTES_STAGES = [
  { id: 'prepare', label: '准备转写文本', weight: 5 },
  { id: 'spawn', label: '启动后台任务', weight: 10 },
  { id: 'generate', label: '模型写纪要中', weight: 75 },
  { id: 'read', label: '读回纪要', weight: 10 },
]

/** 取某个流水线的阶段表 */
export function stagesOf(pipeline) {
  return pipeline === 'minutes' ? MINUTES_STAGES : OFFLINE_STAGES
}

/**
 * 按"当前阶段"算百分比：前面阶段全算完成，当前阶段算一半（保守，不假装快好了）。
 *
 * @param {{pipeline?: string, stageId?: string, fraction?: number}} o
 * @returns {number} 0~100
 */
export function percentOf({ pipeline = 'offline', stageId = '', fraction = 0.5 } = {}) {
  const list = stagesOf(pipeline)
  const total = list.reduce((a, x) => a + x.weight, 0) || 1
  // 没给阶段：还没开始
  if (!stageId) return 0
  // 明确的收尾阶段：100%
  if (stageId === 'done') return 100

  let acc = 0
  for (const st of list) {
    if (st.id === stageId) {
      const f = Math.max(0, Math.min(1, Number(fraction)))
      return Math.round(((acc + st.weight * f) / total) * 100)
    }
    acc += st.weight
  }
  // 未知阶段：不能返回 100%（那等于告诉用户"完成了"，实际可能刚开始）
  // 保守地给"已走完的部分"，但封顶 99% 并至少 1%（表示在进行）
  const partial = Math.round((acc / total) * 100)
  return Math.max(1, Math.min(99, partial || 1))
}

/**
 * 创建一个进度对象。
 * @param {{pipeline?: string, now?: () => number}} o
 */
export function createProgress({ pipeline = 'offline', now = Date.now } = {}) {
  const startedAt = now()
  let current = { pipeline, stageId: '', label: '', detail: '', fraction: 0.5, at: startedAt }

  const snapshot = () => ({
    pipeline: current.pipeline,
    stage: current.stageId,
    stageLabel: current.label,
    detail: current.detail,
    percent: percentOf({ pipeline: current.pipeline, stageId: current.stageId, fraction: current.fraction }),
    elapsedSec: Math.max(0, Math.round((now() - startedAt) / 1000)),
    startedAt,
  })

  return {
    /** 切到某阶段（fraction=0 表示刚开始，1 表示这一阶段做完） */
    stage(stageId, { label = '', detail = '', fraction = 0.2 } = {}) {
      const def = stagesOf(current.pipeline).find((x) => x.id === stageId)
      current = {
        pipeline: current.pipeline,
        stageId,
        label: label || (def ? def.label : stageId),
        detail,
        fraction,
        at: now(),
      }
      return snapshot()
    },
    /** 只更新细节（"已上传 12MB / 41MB"、"已等 23 秒"），不换阶段 */
    detail(detail, fraction) {
      current.detail = String(detail || '')
      if (typeof fraction === 'number') current.fraction = Math.max(0, Math.min(1, fraction))
      return snapshot()
    },
    snapshot,
  }
}

/** 把进度快照渲染成一句人话（日志/接口都能用） */
export function describeProgress(s) {
  if (!s) return ''
  const label = String(s.stageLabel || '')
  const detail = String(s.detail || '')
  const parts = []

  if (detail && label && detail.startsWith(label)) {
    // 明细本来就是"阶段名 + 补充"（云端识别中（已等 3 秒））：只显示明细，别拼两遍
    parts.push(detail)
  } else {
    if (label) parts.push(label)
    if (detail) parts.push(detail)
  }

  if (typeof s.percent === 'number') parts.push(s.percent + '%')
  if (typeof s.elapsedSec === 'number' && s.elapsedSec > 0) parts.push(s.elapsedSec + 's')
  return parts.filter(Boolean).join(' · ')
}
