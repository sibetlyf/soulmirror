/**
 * 声纹库：JSON + 原子写（先落盘再生效）。
 *
 * 为什么不用 SQLite：参考项目用 SQLite 是因为它要处理并发写和多进程；
 * 我们是单个 DSH 宿主机进程、几十个人几百个样本，JSON 足够，
 * 而且**不需要任何原生/实验依赖**（node:sqlite 在不同 Node 版本上开关不一致）。
 * 需要时再升级：库文件是纯数据，迁移成本很低。
 *
 * 硬约束（照参考项目）：
 *   · **原始音频永不保存**，只存向量
 *   · 每个样本记 consent / quality（可审计，可删除）
 *   · 删除写墓碑 + 状态，不能靠"从数组里删掉"来装作没发生过
 *   · 换模型 = 换 space，旧空间向量留着但不参与匹配
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { spaceIsMatchable, buildSpace } from './space.js'
import { buildPrototypes } from './match.js'

export const LIBRARY_FILE = 'library.json'

const nowIso = () => new Date().toISOString()

function encodeVec(vec) {
  return Buffer.from(Float32Array.from(vec).buffer).toString('base64')
}

function decodeVec(b64) {
  const buf = Buffer.from(String(b64 || ''), 'base64')
  if (buf.length % 4) return new Float32Array(0)
  const arr = new Float32Array(buf.length / 4)
  for (let i = 0; i < arr.length; i++) arr[i] = buf.readFloatLE(i * 4)
  return arr
}

function emptyLibrary() {
  return { version: 1, updatedAt: '', globalRevision: 0, spaces: {}, persons: {}, samples: {}, tombstones: {} }
}

function readLibrary(file) {
  try {
    if (!existsSync(file)) return emptyLibrary()
    const parsed = JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, ''))
    if (!parsed || typeof parsed !== 'object') return emptyLibrary()
    return {
      ...emptyLibrary(), ...parsed,
      spaces: parsed.spaces || {}, persons: parsed.persons || {},
      samples: parsed.samples || {}, tombstones: parsed.tombstones || {},
    }
  } catch {
    // 文件坏了不能假装"库里一个人都没有"，交给调用方提示重建
    return { ...emptyLibrary(), corrupted: true }
  }
}

/**
 * 打开（或创建）声纹库。
 * @param {string} dataDir 插件数据目录
 */
export function openLibrary(dataDir) {
  if (!dataDir) throw new Error('没有数据目录，声纹库无处保存')
  const dir = join(String(dataDir), 'voiceprint')
  const file = join(dir, LIBRARY_FILE)
  let state = readLibrary(file)

  function persist() {
    mkdirSync(dir, { recursive: true })
    state.updatedAt = nowIso()
    state.globalRevision = (state.globalRevision || 0) + 1
    const tmp = file + '.tmp'
    writeFileSync(tmp, JSON.stringify(state, null, 1), 'utf8')
    renameSync(tmp, file)
    return state.globalRevision
  }

  const api = {
    path: file,
    isCorrupted() { return !!state.corrupted },

    people({ includeInactive = false } = {}) {
      return Object.values(state.persons)
        .filter((p) => includeInactive || p.status === 'active')
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        .map((p) => ({ ...p }))
    },

    person(personId) { return state.persons[personId] ? { ...state.persons[personId] } : null },

    registerSpace(space) {
      const existing = state.spaces[space.spaceId]
      state.spaces[space.spaceId] = {
        spaceId: space.spaceId,
        dimension: space.dimension,
        embedder_family: space.embedder_family,
        embedder_model_id: space.embedder_model_id,
        embedder_model_version: space.embedder_model_version,
        frontend_version: space.frontend_version,
        matcher_policy_version: space.matcher_policy_version,
        firstSeenAt: (existing && existing.firstSeenAt) || nowIso(),
      }
      return state.spaces[space.spaceId]
    },

    /** 新建一个人（同名不合并：显示名不是身份键） */
    addPerson(displayName) {
      const name = String(displayName || '').trim().slice(0, 40)
      if (!name) throw new Error('人名不能为空')
      const personId = 'person-' + randomUUID().slice(0, 8)
      state.persons[personId] = { personId, displayName: name, status: 'active', createdAt: nowIso(), updatedAt: nowIso(), revision: 1 }
      persist()
      return { ...state.persons[personId] }
    },

    renamePerson(personId, displayName) {
      const p = state.persons[personId]
      if (!p) throw new Error('这个人不存在：' + personId)
      const name = String(displayName || '').trim().slice(0, 40)
      if (!name) throw new Error('人名不能为空')
      p.displayName = name
      p.updatedAt = nowIso()
      p.revision = (p.revision || 0) + 1
      persist()
      return { ...p }
    },

    /** 删除一个人：状态改掉 + 墓碑；样本留着可审计，但不再参与匹配 */
    deletePerson(personId, reason = 'user-deleted') {
      const p = state.persons[personId]
      if (!p) throw new Error('这个人不存在：' + personId)
      p.status = 'deleted'
      p.updatedAt = nowIso()
      p.revision = (p.revision || 0) + 1
      state.tombstones[personId] = { revokedOrDeletedAt: nowIso(), reason }
      persist()
      return { ...p }
    },

    addSample({ personId, space, embedding, quality, consent, seconds }) {
      const p = state.persons[personId]
      if (!p || p.status !== 'active') throw new Error('这个人不能加样本（不存在或已删除）')
      if (!embedding || !embedding.length) throw new Error('空向量不能入库')
      if (embedding.length !== space.dimension) throw new Error('向量维度与空间不一致（' + embedding.length + ' vs ' + space.dimension + '）')
      api.registerSpace(space)
      const sampleId = 'sample-' + randomUUID().slice(0, 8)
      const ordinal = Object.values(state.samples).filter((s) => s.personId === personId).length + 1
      state.samples[sampleId] = {
        sampleId, personId, spaceId: space.spaceId, ordinal, dim: embedding.length,
        embedding: encodeVec(embedding), seconds: Number(seconds) || 0,
        quality: quality || {},
        consent: consent || { grantedAt: nowIso(), noticeVersion: 'v1', captureMethod: 'unspecified' },
        createdAt: nowIso(),
      }
      persist()
      return { ...state.samples[sampleId], vector: embedding }
    },

    listSamples(personId, { space = null } = {}) {
      return Object.values(state.samples)
        .filter((s) => (!personId || s.personId === personId) && (!space || s.spaceId === space.spaceId))
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        .map((s) => ({ ...s, vector: decodeVec(s.embedding) }))
    },

    deleteSample(sampleId) {
      if (!state.samples[sampleId]) throw new Error('样本不存在：' + sampleId)
      delete state.samples[sampleId]
      persist()
    },

    /** 给匹配用的人员列表：每个人在当前空间下重建原型（原型是可重建索引） */
    matcherPersons(space) {
      const out = []
      for (const p of Object.values(state.persons)) {
        if (p.status !== 'active') continue
        const samples = api.listSamples(p.personId, { space })
        if (!samples.length) continue
        const prototypes = buildPrototypes(samples.map((s) => ({
          sampleId: s.sampleId, embedding: s.vector,
          weight: Number(s.quality && s.quality.weight) || 1,
        })))
        if (!prototypes.length) continue
        out.push({ personId: p.personId, displayName: p.displayName, prototypes, sampleCount: samples.length })
      }
      return out
    },

    memberVectors(personId, space) {
      const map = {}
      for (const s of api.listSamples(personId, { space })) map[s.sampleId] = s.vector
      return map
    },

    stats(currentSpace = null) {
      const people = Object.values(state.persons)
      const active = people.filter((p) => p.status === 'active')
      const samples = Object.values(state.samples)
      const usable = currentSpace ? samples.filter((s) => s.spaceId === currentSpace.spaceId) : samples
      const spaces = Object.values(state.spaces).map((s) => ({
        ...s,
        matchable: currentSpace ? spaceIsMatchable(s, currentSpace) : false,
        samples: samples.filter((x) => x.spaceId === s.spaceId).length,
      }))
      return {
        people: active.length, deleted: people.length - active.length,
        samples: usable.length, samplesTotal: samples.length,
        spaces, staleSpaces: spaces.filter((s) => !s.matchable && s.samples > 0),
      }
    },

    reload() { state = readLibrary(file); return api },
  }
  return api
}

/** 当前空间下这个样本还能不能用（换模型/前端后旧样本不能匹配） */
export function sampleMatchesSpace(sample, space) {
  return !!sample && !!space && String(sample.spaceId) === String(space.spaceId)
}

export function currentSpace(modelId) {
  return buildSpace({ modelId })
}
