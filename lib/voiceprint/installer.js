/**
 * 声纹模型 + 运行库：带校验的下载与安装。
 *
 * 参考 OpenASR 的下载方式（`model-registry/catalog.json` + `install.sh`）：
 *   · 清单里每个文件都有 sha256/sha512 + 大小 + 来源（多重镜像）
 *   · **先校验再落地**：下到 .part，算哈希，不匹配就删掉并报错
 *   · 安装是原子的：rename 到最终路径，不会留下半个文件
 *   · 用户看得见进度与失败原因，不静默继续
 *
 * 本插件特有的约束：
 *   · 不能装进宿主 node_modules（那是 junction，开发规则明确禁止写）
 *     → 运行库解到 `<数据目录>/voiceprint/runtime/`，按文件路径加载
 *   · 只取 CPU 需要的文件（onnxruntime.dll + binding + dist/lib），
 *     删掉 DirectML/dxcompiler（35MB 用不上）
 *
 * 解压落位约定（tar 里的根目录通常叫 `package`）：
 *   · 包没有 `into`：整棵 `package/` 落到 `<runtime>/package/`
 *   · 包有 `into`（嵌套依赖，如 onnxruntime-common）：
 *     整棵 `package/` 落到 `<runtime>/<into>/<pkg.name>/`
 *     —— 目录名必须是 npm 包名，否则 `require('onnxruntime-common')` 找不到它。
 *     （可选 `pkg.dest` 覆盖目录名，默认用 `pkg.name`）
 */
import { createHash } from 'node:crypto'
import {
  copyFileSync, createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync,
  readdirSync, renameSync, rmSync, statSync, writeFileSync,
} from 'node:fs'
import { join, dirname } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export const MANIFEST_REL = 'models.manifest.json'

/** 读清单（manifest 就在本模块旁边，随插件分发；也可显式给目录） */
export function loadManifest(baseDir) {
  const target = baseDir ? join(String(baseDir), MANIFEST_REL) : new URL('./models.manifest.json', import.meta.url)
  let raw
  try {
    raw = readFileSync(target, 'utf8')
  } catch (e) {
    throw new Error('读模型清单失败（' + String(target) + '）：' + (e && e.message ? e.message : String(e))
      + '｜插件可能没装全，请重新安装/升级插件')
  }
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch (e) {
    throw new Error('模型清单不是合法 JSON（' + String(target) + '）：' + (e && e.message ? e.message : String(e))
      + '｜清单文件被改坏了，恢复插件文件后重试')
  }
  if (!parsed || typeof parsed !== 'object') throw new Error('模型清单格式不对（' + String(target) + '）：顶层不是对象')
  return parsed
}

export function defaultModelId(manifest) {
  const models = (manifest && manifest.models) || []
  const def = models.find((m) => m && m.default)
  return def ? def.id : (models[0] ? models[0].id : '')
}

export function findModel(manifest, modelId) {
  const models = (manifest && manifest.models) || []
  return models.find((m) => m && m.id === modelId) || null
}

/** 流式算哈希（大文件不读进内存） */
export function hashFile(path, algo = 'sha256') {
  return new Promise((resolve, reject) => {
    const hash = createHash(algo)
    const stream = createReadStream(path)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('error', reject)
    stream.on('end', () => resolve(hash.digest('hex')))
  })
}

/**
 * 校验一个已下载的文件。
 * @returns {Promise<{ok: boolean, actual: string, reason?: string}>}
 */
export async function verifyFile({ path, sha256, sha512, bytes }) {
  if (!existsSync(path)) return { ok: false, actual: '', reason: '文件不存在' }
  const size = statSync(path).size
  if (bytes && size !== bytes) {
    return { ok: false, actual: String(size), reason: '大小不符：应为 ' + bytes + ' 字节，实际 ' + size + ' 字节' }
  }
  if (sha512) {
    const actual = await hashFile(path, 'sha512')
    if (actual !== String(sha512).toLowerCase()) {
      return { ok: false, actual, reason: 'sha512 不匹配（文件可能被截断或被替换）' }
    }
  }
  if (sha256) {
    const actual = await hashFile(path, 'sha256')
    if (actual !== String(sha256).toLowerCase()) {
      return { ok: false, actual, reason: 'sha256 不匹配（文件可能被截断或被替换）' }
    }
  }
  return { ok: true, actual: '' }
}

/** 取消 / 中断：统一成一个可识别的 AbortError，调用方据此给 reason:'canceled' */
function makeAbortError(message = '已取消') {
  const e = new Error(message)
  e.name = 'AbortError'
  e.code = 'ABORT_ERR'
  return e
}

function isAbortError(e, signal) {
  if (signal && signal.aborted) return true
  if (!e) return false
  return e.name === 'AbortError' || e.code === 'ABORT_ERR' || e.code === 'ABORTED'
}

/** 删文件/目录：Windows 上句柄刚关掉时可能 EBUSY，短重试几次，仍然不行就让调用方看到原因 */
function removeIfExists(path) {
  for (let i = 0; i < 3; i++) {
    try { rmSync(path, { recursive: true, force: true, maxRetries: 3, retryDelay: 40 }) } catch { return false }
    if (!existsSync(path)) return true
  }
  return !existsSync(path)
}

/**
 * 下载到目标文件。默认用 fetch（Node 22+ 内置），测试可注入。
 * 进度按**真实收到的字节数**报，不按时间估算。
 *
 * 失败语义：
 *   · 取消（AbortSignal 或字节流里的 AbortError）→ 抛 AbortError，并删掉写了一半的文件
 *   · 其它失败 → 删掉写了一半的文件再抛，消息里带 URL（不留下可被误认为已安装的 .part）
 */
export async function downloadFile({ url, dest, expectedBytes, onProgress, signal, fetchImpl }) {
  mkdirSync(dirname(dest), { recursive: true })
  const f = fetchImpl || (typeof fetch === 'function' ? fetch : null)
  if (!f) throw new Error('这个 Node 没有 fetch，无法下载；请用 Node ≥ 22 运行')
  if (signal && signal.aborted) throw makeAbortError()

  let res
  try {
    res = await f(url, { signal, redirect: 'follow' })
  } catch (e) {
    if (isAbortError(e, signal)) throw makeAbortError()
    throw new Error('下载请求失败（' + url + '）：' + (e && e.message ? e.message : String(e)) + '｜检查网络/代理后重试')
  }
  if (!res || !res.ok) throw new Error('下载失败：HTTP ' + (res ? res.status : '无响应') + '（' + url + '）')

  const total = Number(res.headers && res.headers.get ? res.headers.get('content-length') : 0) || expectedBytes || 0
  const hash = createHash('sha256')
  let received = 0
  const counter = new Transform({
    transform(chunk, _enc, cb) {
      hash.update(chunk)
      received += chunk.length
      if (onProgress) onProgress({ received, total })
      cb(null, chunk)
    },
  })

  try {
    if (res.body && typeof res.body.getReader === 'function') {
      // pipeline 负责背压、错误传播与取消时销毁写流；返回时句柄一定已关闭（否则 rename 会 EBUSY）
      const streams = [Readable.fromWeb(res.body), counter, createWriteStream(dest)]
      if (signal) await pipeline(...streams, { signal })
      else await pipeline(...streams)
    } else {
      const buf = Buffer.from(await res.arrayBuffer())
      if (signal && signal.aborted) throw makeAbortError()
      hash.update(buf)
      received = buf.length
      if (onProgress) onProgress({ received, total })
      await new Promise((resolve, reject) => {
        const file = createWriteStream(dest)
        file.on('error', reject)
        file.end(buf, () => resolve())
      })
    }
  } catch (e) {
    removeIfExists(dest) // 取消 / 网络断裂都不能留下 .part
    if (isAbortError(e, signal)) throw makeAbortError()
    throw new Error('下载中断（' + url + '）：' + (e && e.message ? e.message : String(e)) + '｜可重试，已删掉写了一半文件')
  }
  return { path: dest, bytes: received, sha256: hash.digest('hex') }
}

/**
 * 原子安装：rename .part → 正式路径。
 * Windows 上目标被占用时先删旧文件再 rename；跨设备（EXDEV）用复制兜底。
 */
export function atomicInstall(partPath, finalPath) {
  mkdirSync(dirname(finalPath), { recursive: true })
  try {
    renameSync(partPath, finalPath)
    return finalPath
  } catch (e) {
    if (e && e.code === 'EXDEV') {
      try {
        copyFileSync(partPath, finalPath)
        removeIfExists(partPath)
        return finalPath
      } catch (copyErr) {
        throw new Error('安装文件失败（跨设备复制）：' + (copyErr && copyErr.message ? copyErr.message : String(copyErr)) + '｜检查磁盘空间/权限后重试')
      }
    }
    // 目标已存在或被占用：先删再 rename（仍然失败就如实报出来）
    removeIfExists(finalPath)
    try {
      renameSync(partPath, finalPath)
      return finalPath
    } catch (e2) {
      throw new Error('安装文件失败（rename）：' + (e2 && e2.message ? e2.message : String(e2)) + '｜可能是文件被占用或权限不足')
    }
  }
}

/**
 * 下载并安装一个模型。
 *
 * @param {{manifest: any, modelId: string, modelsDir: string, onProgress?: Function,
 *   signal?: AbortSignal, fetchImpl?: Function}} o
 * @returns {Promise<{ok: boolean, path?: string, modelId?: string, sha256?: string,
 *   reason?: string, message?: string, bytes?: number}>}
 */
export async function installModel(o) {
  const manifest = o.manifest
  const model = findModel(manifest, o.modelId)
  if (!model) return { ok: false, reason: 'unknown-model', message: '清单里没有这个模型：' + o.modelId + '（用 --list 看可选项）' }
  const finalPath = join(o.modelsDir, model.file)
  const partPath = finalPath + '.part'

  // 已经装好了就不重复下载（幂等）
  if (existsSync(finalPath)) {
    const v = await verifyFile({ path: finalPath, sha256: model.sha256, bytes: model.bytes })
    if (v.ok) return { ok: true, path: finalPath, modelId: model.id, sha256: model.sha256, bytes: model.bytes, alreadyInstalled: true }
    // 旧文件不可信：删掉，别让它继续被当成"已安装"
    removeIfExists(finalPath)
  }
  // 上次中断留下的 .part 一律清掉，避免越攒越多
  removeIfExists(partPath)

  const urls = (model.urls || []).slice()
  if (!urls.length) return { ok: false, reason: 'no-source', message: '清单里没有下载地址' }
  let lastError = ''
  for (const url of urls) {
    if (o.signal && o.signal.aborted) {
      removeIfExists(partPath)
      return { ok: false, reason: 'canceled', message: '已取消下载（临时文件已清理）' }
    }
    try {
      const res = await downloadFile({
        url, dest: partPath, expectedBytes: model.bytes,
        signal: o.signal, fetchImpl: o.fetchImpl,
        onProgress: (p) => o.onProgress && o.onProgress({ phase: 'download-model', ...p, url }),
      })
      if (o.signal && o.signal.aborted) {
        removeIfExists(partPath)
        return { ok: false, reason: 'canceled', message: '已取消下载（临时文件已清理）' }
      }
      // 大小先挡一道：明显不对就不用算哈希
      if (model.bytes && res.bytes !== model.bytes) {
        lastError = '大小不符：应为 ' + model.bytes + ' 字节，实际 ' + res.bytes + ' 字节（下载被截断？已删除 .part，重试或换镜像）'
        o.onProgress && o.onProgress({ phase: 'verify-model', failed: true, message: lastError })
        removeIfExists(partPath)
        continue
      }
      o.onProgress && o.onProgress({ phase: 'verify-model', received: res.bytes, total: res.bytes })
      if (String(res.sha256) !== String(model.sha256).toLowerCase()) {
        lastError = 'sha256 不匹配：下载到 ' + res.sha256 + '，清单要求 ' + model.sha256 + '（文件可能被截断/被替换，已删除 .part）'
        // 让界面能看到"校验没通过"，而不是等到最后只给一个 download-failed
        o.onProgress && o.onProgress({ phase: 'verify-model', failed: true, message: lastError })
        removeIfExists(partPath)
        continue
      }
      const installed = atomicInstall(partPath, finalPath)
      return { ok: true, path: installed, modelId: model.id, sha256: model.sha256, bytes: model.bytes }
    } catch (e) {
      removeIfExists(partPath)
      if (isAbortError(e, o.signal)) return { ok: false, reason: 'canceled', message: '已取消下载（临时文件已清理）' }
      lastError = e && e.message ? e.message : String(e)
    }
  }
  return { ok: false, reason: 'download-failed', message: (lastError || '所有地址都失败了') + '｜可以检查网络后重试' }
}

/** 读运行库标记（坏 JSON 当作没装） */
export function readRuntimeMarker(dir) {
  const marker = join(String(dir), 'installed.json')
  if (!existsSync(marker)) return null
  try {
    const m = JSON.parse(readFileSync(marker, 'utf8'))
    return m && typeof m === 'object' ? m : null
  } catch {
    return null
  }
}

/**
 * 标记对不对得上**磁盘上的文件**。
 * 只看 installed.json 存在是不够的：上次可能是解压到一半被中断，
 * 标记在但 binding 缺了，界面会误报"已装"。
 */
export function runtimeFilesOk(dir, marker) {
  const m = marker === undefined ? readRuntimeMarker(dir) : marker
  if (!m) return false
  const pkgNames = Array.isArray(m.packages) ? m.packages.map((p) => String((p && p.name) || '')) : []
  // 后端的加载入口是 package/dist/index.js：它不在就是没装好（哪怕其它文件都在）。
  // 空包清单（测试/无本地运行库方案）不适用这条。
  if (pkgNames.includes('onnxruntime-node')) {
    const entry = join(String(dir), 'package', 'dist', 'index.js')
    if (!existsSync(entry) || statSync(entry).size === 0) return false
  }
  const files = Array.isArray(m.files) ? m.files : null
  if (!files) {
    // 旧标记没记录文件清单：能确认的只有加载入口（上面已查）
    return true
  }
  if (files.length === 0) return pkgNames.length === 0
  for (const rel of files) {
    const path = join(String(dir), rel)
    if (!existsSync(path)) return false
    try {
      const st = statSync(path)
      if (st.isDirectory()) {
        if (readdirSync(path).length === 0) return false
      } else if (st.size === 0) return false
    } catch {
      return false
    }
  }
  return true
}

/** tar 里的成员路径 → 落位后的真实路径 */
function mapMember(member, rootName, destRoot) {
  const rel = member === rootName ? '' : (member.startsWith(rootName + '/') ? member.slice(rootName.length + 1) : member)
  return rel ? join(destRoot, rel) : destRoot
}

/**
 * 安装运行库（CPU 版）：解到数据目录，不碰宿主 node_modules。
 *
 * @returns {Promise<{ok: boolean, dir?: string, reason?: string, message?: string}>}
 */
export async function installRuntime(o) {
  const rt = (o.manifest && o.manifest.runtime) || null
  if (!rt) return { ok: false, reason: 'no-runtime', message: '清单里没有运行库信息（插件可能没装全）' }
  const dir = String(o.runtimeDir)
  const markerPath = join(dir, 'installed.json')

  // 已装且文件都在：幂等跳过，不重复下载 115MB
  const old = readRuntimeMarker(dir)
  if (old && old.backend === rt.backend && old.version === rt.version && runtimeFilesOk(dir, old)) {
    return { ok: true, dir, alreadyInstalled: true }
  }

  mkdirSync(dir, { recursive: true })
  // 上次被强杀留下的 .tmp-* 解压目录：先清掉，不然数据目录越攒越大
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    if (ent.isDirectory() && ent.name.startsWith('.tmp-')) removeIfExists(join(dir, ent.name))
  }
  // 旧标记与新装的不一致：先删，装完再写（失败时绝不留旧标记冒充"已装"）
  removeIfExists(markerPath)
  // 上次写 marker 时被强杀留下的半截标记也清掉
  removeIfExists(markerPath + '.part')

  const tmpDir = join(dir, '.tmp-' + Date.now() + '-' + process.pid)
  mkdirSync(tmpDir, { recursive: true })
  const installedFiles = []
  const placedDirs = []
  const abortedNow = () => !!(o.signal && o.signal.aborted)
  const canceledResult = () => {
    // 取消后不留半套运行库：已经落位的包也删掉（没有 marker 的东西本来也用不了）
    for (const d of placedDirs) removeIfExists(d)
    return { ok: false, reason: 'canceled', message: '已取消安装运行库（临时文件已清理）' }
  }
  try {
    const packages = rt.packages || []
    for (const pkg of packages) {
      if (abortedNow()) return canceledResult()
      const tgz = join(tmpDir, pkg.name + '.tgz')
      const res = await downloadFile({
        url: pkg.tarball, dest: tgz, expectedBytes: pkg.bytes,
        signal: o.signal, fetchImpl: o.fetchImpl,
        onProgress: (p) => o.onProgress && o.onProgress({ phase: 'download-runtime', package: pkg.name, ...p }),
      })
      if (abortedNow()) return canceledResult()
      if (pkg.bytes && res.bytes !== pkg.bytes) {
        throw new Error(pkg.name + ' 大小不符（实际 ' + res.bytes + ' 字节，清单要求 ' + pkg.bytes + ' 字节）')
      }
      o.onProgress && o.onProgress({ phase: 'verify-runtime', package: pkg.name })
      const v = await verifyFile({ path: tgz, sha512: pkg.sha512, sha256: pkg.sha256, bytes: pkg.bytes })
      if (abortedNow()) return canceledResult()
      if (!v.ok) throw new Error(pkg.name + ' 校验失败：' + v.reason + '｜可重试下载')

      // 先解到临时目录，再整棵搬到最终位置：半截解压不会被当成已安装
      const scratch = join(tmpDir, 'extract-' + pkg.name)
      mkdirSync(scratch, { recursive: true })
      if (abortedNow()) return canceledResult()
      o.onProgress && o.onProgress({ phase: 'extract-runtime', package: pkg.name })
      await extractTar(tgz, scratch, pkg.extract || [])
      // 解压不可中断（execFile 只有 timeout），所以解完立刻再查一次，取消后不再落位
      if (abortedNow()) return canceledResult()
      const entries = readdirSync(scratch)
      if (entries.length !== 1) {
        throw new Error('解压结果不是预期的单个包目录（' + pkg.name + '）：得到 ' + entries.length + ' 项；清单里的 extract 成员可能不对')
      }
      const rootName = entries[0]
      const destRoot = pkg.into
        ? join(dir, pkg.into, String(pkg.dest || pkg.name))
        : join(dir, rootName)
      mkdirSync(dirname(destRoot), { recursive: true })
      if (existsSync(destRoot) && !removeIfExists(destRoot)) {
        // Windows 上正在被加载的 DLL 删不掉：这时不能假装装好了
        throw new Error(pkg.name + ' 的旧文件删不掉：' + destRoot
          + '｜多半是运行库正被 DSH 占用，退出/重启 DSH 后再装一次')
      }
      try {
        renameSync(join(scratch, rootName), destRoot)
      } catch (e) {
        throw new Error(pkg.name + ' 落位失败（rename 到 ' + destRoot + '）：' + (e && e.message ? e.message : String(e)) + '｜检查是否被其他进程占用')
      }
      placedDirs.push(destRoot)
      // 删掉用不上的东西（DirectML/dxcompiler 等），路径按 tar 成员写，这里换算成实际路径
      for (const rel of pkg.cleanup || []) removeIfExists(mapMember(rel, rootName, destRoot))
      // 记下"装了什么"，之后判定已装/可用要看这些文件是否都还在
      for (const member of pkg.extract || []) {
        const finalPath = mapMember(member, rootName, destRoot)
        if (!existsSync(finalPath)) {
          throw new Error(pkg.name + ' 解压后缺少 ' + member + '（清单的 extract 成员可能不对）')
        }
        installedFiles.push(finalPath.slice(dir.length + 1).replace(/\\/g, '/'))
      }
      // 每个包都做完再查一次：取消后不得继续下一个包，也不得写 marker
      if (abortedNow()) return canceledResult()
    }

    // 写 marker 前最后一道：取消后绝不能留下"已装"标记
    if (abortedNow()) return canceledResult()
    const marker = {
      backend: rt.backend,
      version: rt.version,
      installedAt: new Date().toISOString(),
      packages: packages.map((p) => ({ name: p.name, sha512: p.sha512 })),
      files: installedFiles,
    }
    // 标记也要原子写：写一半的 installed.json 会让界面以为装好了
    const markerPart = markerPath + '.part'
    writeFileSync(markerPart, JSON.stringify(marker, null, 2), 'utf8')
    renameSync(markerPart, markerPath)
    return { ok: true, dir }
  } catch (e) {
    removeIfExists(markerPath)
    removeIfExists(markerPath + '.part')
    if (isAbortError(e, o.signal)) return canceledResult()
    return { ok: false, reason: 'runtime-failed', message: e && e.message ? e.message : String(e) }
  } finally {
    removeIfExists(tmpDir)
  }
}

/** 用系统 tar 解压指定成员（bsdtar/GNU tar 都支持"只解这些路径"） */
export async function extractTar(tgz, into, members) {
  const args = ['-xzf', tgz, '-C', into]
  if (members && members.length) args.push(...members)
  try {
    await execFileAsync('tar', args, { windowsHide: true, timeout: 120000 })
  } catch (e) {
    throw new Error('解压失败（需要系统 tar，Windows 10+ 自带）：' + (e && e.message ? e.message : String(e))
      + '｜检查磁盘空间，或手动解压 tarball 后放到运行库目录')
  }
}

/** 模型安装位置（约定） */
export function modelDir(dataDir) { return join(String(dataDir), 'voiceprint', 'models') }
export function runtimeDir(dataDir) { return join(String(dataDir), 'voiceprint', 'runtime') }
export function installedModelPath(dataDir, model) { return join(modelDir(dataDir), model.file) }

/**
 * 已装模型的校验缓存：GET /voiceprint 在安装期间每 800ms 轮询一次，
 * 每次都重算 25MB 的 sha256 太浪费；键里带 size+mtime，文件一变就重算。
 * 只缓存"通过"的结果，缓存不命中或文件变动都会重新真的算一遍。
 */
const verifiedCache = new Map()
function cachedVerified(path, model) {
  let st
  try { st = statSync(path) } catch { return false }
  const key = path + '|' + st.size + '|' + st.mtimeMs + '|' + String(model.sha256 || '')
  const hit = verifiedCache.get(key)
  if (hit === true) return true
  return null
}

/** 已经装了哪些模型（界面要显示"哪个能用"）。第一个参数是 models 目录本身。 */
export async function installedModels(modelsDir, manifest) {
  const out = []
  for (const m of (manifest && manifest.models) || []) {
    const path = join(String(modelsDir), m.file)
    const exists = existsSync(path)
    const bytes = exists ? statSync(path).size : 0
    let verified = false
    if (exists) {
      const hit = cachedVerified(path, m)
      if (hit === true) verified = true
      else {
        const v = await verifyFile({ path, sha256: m.sha256, bytes: m.bytes })
        verified = v.ok
        if (verified) {
          if (verifiedCache.size > 32) verifiedCache.clear()
          const st = statSync(path)
          verifiedCache.set(path + '|' + st.size + '|' + st.mtimeMs + '|' + String(m.sha256 || ''), true)
        }
      }
    }
    out.push({ id: m.id, displayName: m.displayName, dim: m.dim, file: m.file, path, exists, bytes, verified })
  }
  return out
}
