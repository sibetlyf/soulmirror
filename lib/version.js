/**
 * 版本号体系。
 *
 * 为什么需要两个版本号：
 *   插件版本（package version）说"能力变了什么"
 *   存储版本（STORAGE_VERSION）说"磁盘上的文件格式变没变"
 *
 * 二者必须分开，因为它们的**兼容性含义完全不同**：
 *   · 插件从 1.0.0 → 1.1.0：加功能，旧数据照样能读
 *   · 存储从 1 → 2：文件结构变了，旧数据必须迁移，否则读懂一半
 *
 * 只用一个版本号时，这两种变化会混在一起，用户升级后
 * 既不知道"要不要迁移数据"，也不知道"能不能回退"。
 */

/** 插件版本：与 package.json 保持一致（改了这里要同步 package.json） */
export const VERSION = '1.2.2'

/**
 * 存储格式版本。
 * 凡改动以下任一项的结构，就必须 +1 并写迁移：
 *   PROFILE.json / USER-CARD.md / memory/{warm,cold}.md
 *   memory/{episodic,journal}/*.md / ontology/{knowledge,rules}.md / config.json
 */
export const STORAGE_VERSION = 1

/** 最低 DSH 版本（我们用到的服务：sessionController / llm / schedule / webServer / tools） */
export const MIN_DSH = '0.9.0'

/** 最低 Node 版本（ESM + fs/promises + node:test） */
export const MIN_NODE = '20.18.0'

/**
 * 解析版本：容忍 v 前缀与预发布后缀。
 * @returns {{major: number, minor: number, patch: number, pre: string} | null}
 */
export function parseVersion(text) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(String(text || '').trim())
  if (!m) return null
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]), pre: m[4] || '' }
}

/**
 * 比较两个版本。
 * @returns {number} a>b 返回 1，a<b 返回 -1，相等 0；无法解析返回 NaN
 */
export function compareVersions(a, b) {
  const x = parseVersion(a)
  const y = parseVersion(b)
  if (!x || !y) return NaN
  for (const k of ['major', 'minor', 'patch']) {
    if (x[k] !== y[k]) return x[k] > y[k] ? 1 : -1
  }
  // 预发布版低于正式版：1.0.0-beta < 1.0.0
  if (x.pre === y.pre) return 0
  if (!x.pre) return 1
  if (!y.pre) return -1
  return x.pre > y.pre ? 1 : -1
}

/** 当前是否满足最低要求 */
export function checkCompatibility({ dshVersion = '', nodeVersion = process.versions.node } = {}) {
  const out = { ok: true, problems: [] }

  if (compareVersions(nodeVersion, MIN_NODE) === -1) {
    out.ok = false
    out.problems.push('Node ' + nodeVersion + ' 低于要求的 ' + MIN_NODE)
  }
  if (dshVersion) {
    const cmp = compareVersions(dshVersion, MIN_DSH)
    if (cmp === -1) {
      out.ok = false
      out.problems.push('DSH ' + dshVersion + ' 低于要求的 ' + MIN_DSH)
    }
  }
  return out
}

/**
 * 判断存储版本该怎么处理。
 * @param {number|string} found 磁盘上读到的版本
 * @returns {{action: 'ok'|'migrate'|'too-new'|'unknown', from: number, to: number, note: string}}
 */
export function planStorageMigration(found) {
  const n = Number(found)
  if (!Number.isFinite(n) || n <= 0) {
    return { action: 'unknown', from: 0, to: STORAGE_VERSION, note: '没有存储版本标记，按最新格式处理（可能是首次运行）' }
  }
  if (n === STORAGE_VERSION) return { action: 'ok', from: n, to: STORAGE_VERSION, note: '格式一致' }
  if (n < STORAGE_VERSION) return { action: 'migrate', from: n, to: STORAGE_VERSION, note: '需要迁移：从 ' + n + ' 到 ' + STORAGE_VERSION }
  return { action: 'too-new', from: n, to: STORAGE_VERSION, note: '数据比插件新（来自更高版本），请升级插件而不是降级数据' }
}

/** 给面板/日志用的汇总 */
export function versionInfo({ dshVersion = '' } = {}) {
  const compat = checkCompatibility({ dshVersion })
  return {
    version: VERSION,
    storage: STORAGE_VERSION,
    minDsh: MIN_DSH,
    minNode: MIN_NODE,
    node: process.versions.node,
    dsh: dshVersion || '',
    compatible: compat.ok,
    problems: compat.problems,
  }
}
