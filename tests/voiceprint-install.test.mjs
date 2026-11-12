import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync,
  rmSync, statSync, writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'

import {
  loadManifest, defaultModelId, findModel, hashFile, verifyFile, downloadFile,
  atomicInstall, installModel, installRuntime, extractTar, modelDir, runtimeDir,
  installedModels, installedModelPath, MANIFEST_REL,
} from '../lib/voiceprint/installer.js'
import { EMBEDDER_MODELS, DEFAULT_MODEL_ID } from '../lib/voiceprint/space.js'
import {
  createEmbedder, loadOrtRuntime, runtimeStatus, modelStatus, EmbedError,
} from '../lib/voiceprint/embed.js'

/**
 * 「声纹模型一键安装」的独立测试。
 *
 * 守住参考项目的原则：
 *   清单哈希是真的、先校验再落盘、失败不留垃圾、安装原子且幂等、
 *   进度是真实字节而不是时间估算、取消要清理、
 *   没装模型/运行库要明确报原因而不是假装能用。
 *
 * 约束：不真实下载（一律注入 fetchImpl/local tarball），
 * 不写用户数据目录、不碰麦克风/桌面、不依赖 onnxruntime 已安装。
 */

// ── 公用小工具 ────────────────────────────────────────────────────────────

function tmpDir(t, prefix = 'sm-vp-install-') {
  const d = mkdtempSync(join(tmpdir(), prefix))
  // 注册清理：断言失败也要删临时目录（AGENTS.md 的强制要求）
  t.after(() => rmSync(d, { recursive: true, force: true }))
  return d
}

function sha256hex(buf) {
  return createHash('sha256').update(buf).digest('hex')
}

function sha512hex(buf) {
  return createHash('sha512').update(buf).digest('hex')
}

/** 16k 单声道正弦波，给 test 嵌入器用（不涉及真实模型） */
function toneSamples(seconds = 2, freq = 440) {
  const n = 16000 * seconds
  const s = new Float32Array(n)
  for (let i = 0; i < n; i++) s[i] = Math.sin(2 * Math.PI * freq * i / 16000) * 0.35
  return s
}

/** 按真实字节流返回 Response（模拟 Node fetch 的 res.body.getReader 路径） */
function makeStreamingFetch(buf, { chunkSize = 512 } = {}) {
  let calls = 0
  const impl = async () => {
    calls++
    let offset = 0
    const body = new ReadableStream({
      pull(controller) {
        if (offset >= buf.length) { controller.close(); return }
        const end = Math.min(buf.length, offset + chunkSize)
        controller.enqueue(new Uint8Array(buf.subarray(offset, end)))
        offset = end
      },
    })
    return {
      ok: true,
      status: 200,
      headers: new Headers({ 'content-length': String(buf.length) }),
      body,
    }
  }
  impl.calls = () => calls
  return impl
}

/** 没有 body.getReader 的 Response（走 arrayBuffer 兜底路径） */
function makeBufferFetch(buf) {
  let calls = 0
  const impl = async () => {
    calls++
    return {
      ok: true,
      status: 200,
      headers: new Headers({ 'content-length': String(buf.length) }),
      arrayBuffer: async () => buf,
    }
  }
  impl.calls = () => calls
  return impl
}

/** fetch 一开始就抛 AbortError（用户在下载前取消） */
function makeAbortFetch() {
  let calls = 0
  const impl = async () => {
    calls++
    const e = new Error('用户取消')
    e.name = 'AbortError'
    throw e
  }
  impl.calls = () => calls
  return impl
}

/**
 * 已经写出第一个 chunk 后再以 AbortError 中断字节流（模拟下载中途取消）。
 * 历史 bug：downloadFile 错误路径不销毁写流，删 .part 与未完成的 open 竞态，
 * 迟到的 ENOENT 会变成 uncaughtException。现在用 pipeline，取消必须干净。
 */
function makeMidStreamAbortFetch(buf) {
  let calls = 0
  const impl = async () => {
    calls++
    let offset = 0
    let pulls = 0
    const body = new ReadableStream({
      pull(controller) {
        pulls++
        if (pulls >= 2) {
          const e = new Error('用户取消')
          e.name = 'AbortError'
          e.code = 'ABORT_ERR'
          controller.error(e)
          return
        }
        const end = Math.min(buf.length, offset + 256)
        controller.enqueue(new Uint8Array(buf.subarray(offset, end)))
        offset = end
      },
    })
    return {
      ok: true,
      status: 200,
      headers: new Headers({ 'content-length': String(buf.length) }),
      body,
    }
  }
  impl.calls = () => calls
  return impl
}

/**
 * 用「真实小文件」造一份清单：哈希/大小都由测试实际算出来，
 * 不依赖 26MB 的线上权重，也不假装测过真实清单哈希。
 */
function makeManifest(buf, opts = {}) {
  const id = opts.id || DEFAULT_MODEL_ID
  const model = EMBEDDER_MODELS[id]
  return {
    schema: 1,
    models: [{
      id,
      displayName: '测试用小模型',
      family: model.family,
      version: model.version,
      dim: model.dim,
      file: opts.file || 'test-model.onnx',
      bytes: opts.bytes === undefined ? buf.length : opts.bytes,
      sha256: opts.sha256 || sha256hex(buf),
      urls: ['https://example.invalid/models/test-model.onnx'],
      inputName: 'feats',
      outputName: 'embs',
      default: true,
    }],
    runtime: { backend: 'onnxruntime-node', version: '1.31.1', packages: [] },
  }
}

function expectedModelPath(dir, model) {
  return join(modelDir(dir), model.file)
}

function assertNoLeftovers(finalPath, why) {
  assert.equal(existsSync(finalPath), false, why + '：最终文件不能出现')
  assert.equal(existsSync(finalPath + '.part'), false, why + '：.part 必须清理')
}

// ── 1. 清单自身完整性 ───────────────────────────────────────────────────

test('清单完整性：模型哈希是 64 位小写十六进制，bytes/dim/输入输出名齐全，urls 全是 https', (t) => {
  const d = tmpDir(t)
  const manifest = loadManifest()

  assert.ok(Array.isArray(manifest.models) && manifest.models.length >= 1, '清单至少要有一个模型')
  for (const m of manifest.models) {
    assert.match(String(m.id || ''), /^[a-z0-9][a-z0-9-]*$/, '模型 id 必须能被引用：' + m.id)
    assert.match(String(m.sha256 || ''), /^[0-9a-f]{64}$/, m.id + ' 的 sha256 必须是 64 位小写十六进制（大写/短哈希都不可信）')
    assert.ok(Number.isInteger(m.bytes) && m.bytes > 0, m.id + ' 的 bytes 必须是正整数')
    assert.equal(Number.isInteger(m.dim) && m.dim > 0, true, m.id + ' 必须登记向量维度')
    assert.equal(typeof m.inputName === 'string' && m.inputName.trim().length > 0, true, m.id + ' 必须登记 ONNX 输入名')
    assert.equal(typeof m.outputName === 'string' && m.outputName.trim().length > 0, true, m.id + ' 必须登记 ONNX 输出名')
    assert.match(String(m.file || ''), /\.onnx$/, m.id + ' 的落盘文件必须是 .onnx')
    assert.ok(Array.isArray(m.urls) && m.urls.length > 0, m.id + ' 必须有下载地址（多重镜像）')
    for (const url of m.urls) {
      assert.equal(new URL(url).protocol, 'https:', m.id + ' 的下载地址必须走 https：' + url)
    }
  }

  // baseDir 形式也要能读同一份清单（安装入口用 loadManifest(数据目录) 也行）
  copyFileSync(new URL('../lib/voiceprint/models.manifest.json', import.meta.url), join(d, MANIFEST_REL))
  const fromDir = loadManifest(d)
  assert.deepEqual(fromDir, manifest, 'MANIFEST_REL 指向的文件必须与内置清单一致')
  assert.equal(MANIFEST_REL, 'models.manifest.json')
})

test('清单与 space 不能漂移：每个清单模型都能在 EMBEDDER_MODELS 找到且 dim 一致', () => {
  const manifest = loadManifest()
  const spaceIds = Object.keys(EMBEDDER_MODELS)

  for (const m of manifest.models) {
    const s = EMBEDDER_MODELS[m.id]
    assert.ok(s, '清单里的模型 id 在 space.js 里不存在（换了模型就认不出/维度对不上）：' + m.id)
    assert.equal(s.dim, m.dim, m.id + ' 的 dim 在清单与 space.js 必须一致，否则向量存进错误维度')
    assert.equal(s.family, m.family, m.id + ' 的 family 必须一致（spaceId 由它算出来）')
    assert.equal(s.version, m.version, m.id + ' 的 version 必须一致（换权重必须换空间）')
  }

  // 反向也要守：space 里宣称支持的模型必须可安装，否则界面会显示一个装不了的模型
  for (const id of spaceIds) {
    assert.ok(manifest.models.some((m) => m.id === id), 'EMBEDDER_MODELS 里的模型在清单里缺失：' + id)
  }
  assert.ok(findModel(manifest, DEFAULT_MODEL_ID), '默认模型必须能在清单里找到')
  assert.equal(defaultModelId(manifest), DEFAULT_MODEL_ID, '清单默认模型必须等于 space 默认模型（否则一键安装装错模型）')
})

test('运行库清单：两个包的 sha512 是 128 位小写十六进制、bytes>0、tarball https，且 npmIntegrity 交叉一致', () => {
  const runtime = loadManifest().runtime
  assert.ok(runtime, '清单必须有 runtime 段')
  assert.equal(runtime.backend, 'onnxruntime-node')
  assert.equal(runtime.version, '1.31.1')
  const packages = runtime.packages || []
  const names = packages.map((p) => p.name)
  for (const must of ['onnxruntime-node', 'onnxruntime-common']) {
    assert.ok(names.includes(must), '运行库必须包含 ' + must)
  }
  for (const p of packages) {
    assert.match(String(p.sha512 || ''), /^[0-9a-f]{128}$/, p.name + ' 的 sha512 必须是 128 位小写十六进制（运行库只有 sha512，写短了就校验不住）')
    assert.ok(Number.isInteger(p.bytes) && p.bytes > 0, p.name + ' 的 bytes 必须是正整数')
    assert.equal(new URL(p.tarball).protocol, 'https:', p.name + ' 的 tarball 必须走 https')
    assert.ok(Array.isArray(p.extract) && p.extract.length > 0, p.name + ' 必须限定解压成员（不然会把整棵包解进数据目录）')
    // npmIntegrity 是 npm 的真实校验值；它必须与清单 sha512 一致，否则"哈希是真的"就是假的
    assert.match(String(p.npmIntegrity || ''), /^sha512-[A-Za-z0-9+/]+=*$/, p.name + ' 缺少 npmIntegrity')
    const npmHex = Buffer.from(String(p.npmIntegrity).slice('sha512-'.length), 'base64').toString('hex')
    assert.equal(npmHex, p.sha512.toLowerCase(), p.name + ' 的 npmIntegrity 与 sha512 不一致（清单里两份哈希对不上，无法证明下载的是同一个文件）')
  }
})

test('清单哈希字段与 installer 实际校验字段一致（防止校验退化到"看起来在校验"）', () => {
  // 真机安装证据（25.3MB 模型 + 115.4MB 运行库）不在单测里重放，也没有留下 sm-final-* 目录；
  // 这里改为交叉检查"清单声明了哈希"与"installer 真的拿这些字段去校验"，防止有人把校验改成不看哈希。
  const manifest = loadManifest()
  const src = readFileSync(new URL('../lib/voiceprint/installer.js', import.meta.url), 'utf8')

  // 模型：已装幂等校验 + 下载后的哈希比对都必须用清单 sha256/bytes
  assert.match(src, /verifyFile\(\{ path: finalPath, sha256: model\.sha256, bytes: model\.bytes \}\)/, '安装器必须用清单 sha256+bytes 校验模型（否则截断/替换的文件会被当成已装）')
  assert.match(src, /String\(res\.sha256\) !== String\(model\.sha256\)\.toLowerCase\(\)/, '下载结果必须与清单 sha256 比对后才能落盘')
  // 运行库：必须用清单 sha512（清单以后若补 sha256 也一起传进去）
  assert.match(src, /verifyFile\(\{ path: tgz, sha512: pkg\.sha512, sha256: pkg\.sha256, bytes: pkg\.bytes \}\)/, '运行库必须用清单 sha512 校验 tarball，不能只查 HTTP 状态')
  // 下载阶段必须真的边下边算 sha256（否则 installModel 的比对没有依据）
  assert.match(src, /createHash\('sha256'\)/, 'downloadFile 必须真的计算 sha256')
  assert.match(src, /hash\.update\(chunk\)/, '哈希必须覆盖下载的每个 chunk（不能只算首尾）')
  assert.match(src, /if \(isAbortError\(e, signal\)\)/, '取消必须能被识别，不能被当成普通网络错误吞掉')

  // 清单字段本身必须齐全；否则上面的校验会拿到 undefined 而静默跳过，回归就失效了
  for (const m of manifest.models) {
    assert.match(String(m.sha256), /^[0-9a-f]{64}$/, m.id + ' 必须有可用的 sha256，installer 才能校验')
    assert.ok(Number.isInteger(m.bytes) && m.bytes > 0, m.id + ' 必须有 bytes，installer 才能先挡大小')
  }
  for (const p of manifest.runtime.packages) {
    assert.match(String(p.sha512), /^[0-9a-f]{128}$/, p.name + ' 必须有可用的 sha512')
    assert.ok(Number.isInteger(p.bytes) && p.bytes > 0, p.name + ' 必须有 bytes')
    if (p.sha256 !== undefined) assert.match(String(p.sha256), /^[0-9a-f]{64}$/, p.name + ' 的 sha256 若存在也必须是合法值')
  }
})

// ── 2. verifyFile ───────────────────────────────────────────────────────

test('verifyFile：大小与 sha256 都正确才通过', async (t) => {
  const d = tmpDir(t)
  const buf = Buffer.from('声纹模型校验用的小文件'.repeat(64), 'utf8')
  const p = join(d, 'ok.onnx')
  writeFileSync(p, buf)

  const r = await verifyFile({ path: p, sha256: sha256hex(buf), bytes: buf.length })
  assert.equal(r.ok, true, '正确文件必须通过：' + JSON.stringify(r))
  assert.equal(r.actual, '', '通过时不应再编造一个"实际"哈希')

  // 大小完全不符 → 明确说差多少，不能只给 false
  const size = await verifyFile({ path: p, sha256: sha256hex(buf), bytes: buf.length + 7 })
  assert.equal(size.ok, false)
  assert.match(size.reason, /大小不符/, '必须让用户看懂是大小问题')
  assert.match(size.reason, new RegExp(String(buf.length + 7)), '原因里要有期望值')
  assert.match(size.reason, new RegExp(String(buf.length)), '原因里要有实际值')

  const missing = await verifyFile({ path: join(d, 'no-such.onnx'), sha256: sha256hex(buf), bytes: buf.length })
  assert.equal(missing.ok, false)
  assert.equal(missing.reason, '文件不存在', '不存在也要有明确原因，不能当成"空文件通过"')
  assert.equal(missing.actual, '')
})

test('verifyFile：同大小但内容被换掉时 sha256 必须失败', async (t) => {
  const d = tmpDir(t)
  const good = Buffer.from('A'.repeat(4096))
  const other = Buffer.from('B'.repeat(4096))
  const p = join(d, 'swapped.onnx')
  writeFileSync(p, other)

  const r = await verifyFile({ path: p, sha256: sha256hex(good), bytes: good.length })
  assert.equal(r.ok, false, '同大小不代表同文件：被替换的模型必须拒绝')
  assert.match(r.reason, /sha256 不匹配/)
  assert.equal(r.actual, sha256hex(other), '要回报实际哈希，方便核对')

  // 运行库走 sha512：同样必须校验
  const p512 = join(d, 'rt.tgz')
  writeFileSync(p512, good)
  const ok512 = await verifyFile({ path: p512, sha512: sha512hex(good), bytes: good.length })
  assert.equal(ok512.ok, true)
  const bad512 = await verifyFile({ path: p512, sha512: sha512hex(other), bytes: good.length })
  assert.equal(bad512.ok, false)
  assert.match(bad512.reason, /sha512 不匹配/, '运行库用 sha512，必须真的算 sha512')
})

// ── 3. downloadFile ────────────────────────────────────────────────────

test('downloadFile：字节流完整写盘，返回真实 sha256/字节数，进度按真实字节单调递增并收在 total', async (t) => {
  const d = tmpDir(t)
  const buf = Buffer.alloc(6000)
  for (let i = 0; i < buf.length; i++) buf[i] = (i * 37) % 251
  const dest = join(d, 'downloads', 'model.part')
  const fetchImpl = makeStreamingFetch(buf, { chunkSize: 500 })
  const progress = []

  const r = await downloadFile({
    url: 'https://example.invalid/model.onnx',
    dest,
    expectedBytes: buf.length,
    fetchImpl,
    onProgress: (p) => progress.push(p),
  })

  assert.equal(fetchImpl.calls(), 1, '一份文件只该请求一次')
  assert.equal(r.path, dest)
  assert.equal(r.bytes, buf.length, '返回的字节数必须是实际写盘字节数')
  assert.equal(r.sha256, sha256hex(buf), '返回的 sha256 必须是真实下载内容的哈希')
  assert.deepEqual(readFileSync(dest), buf, '写盘内容必须与流完全一致（不能少字节/交错）')

  assert.ok(progress.length > 1, '大文件应有多段进度（不能只有一个 100%）')
  for (const p of progress) {
    assert.equal(p.total, buf.length, 'total 应来自 content-length/清单字节数')
    assert.ok(p.received >= 0 && p.received <= buf.length, 'received 不能超过 total')
  }
  for (let i = 1; i < progress.length; i++) {
    assert.ok(progress[i].received >= progress[i - 1].received, '进度必须单调递增（不能倒退），第 ' + i + ' 次')
  }
  assert.equal(progress[progress.length - 1].received, buf.length, '最后一次进度必须等于总字节数（否则界面会永远停在 99%）')
})

test('downloadFile：返回前 flush 已完成 —— 下载后立刻 rename 不能丢数据（历史 bug 回归）', async (t) => {
  const d = tmpDir(t)
  const buf = Buffer.from('flush-测试-'.repeat(1000), 'utf8')

  // 路径 A：字节流
  const streamed = join(d, 'a.part')
  const fa = makeStreamingFetch(buf, { chunkSize: 2048 })
  await downloadFile({ url: 'https://example.invalid/a', dest: streamed, expectedBytes: buf.length, fetchImpl: fa })
  const movedA = join(d, 'a-final.onnx')
  renameSync(streamed, movedA) // 没 flush 完成时，Windows 上会 EBUSY 或拿到截断内容
  assert.equal(existsSync(movedA), true, '下载返回时句柄必须已关闭')
  assert.deepEqual(readFileSync(movedA), buf, 'rename 后内容必须完整')

  // 路径 B：arrayBuffer 兜底
  const buffered = join(d, 'b.part')
  const fb = makeBufferFetch(buf)
  await downloadFile({ url: 'https://example.invalid/b', dest: buffered, expectedBytes: buf.length, fetchImpl: fb })
  const movedB = join(d, 'b-final.onnx')
  renameSync(buffered, movedB)
  assert.deepEqual(readFileSync(movedB), buf, 'arrayBuffer 路径同样必须在返回前写完')
})

// ── 4. installModel（注入 fetchImpl，真实小文件）──────────────────────────

test('installModel：正常安装后文件存在并通过校验，且不留 .part', async (t) => {
  const d = tmpDir(t)
  const buf = Buffer.from('fake-onnx-'.repeat(3000), 'utf8')
  const manifest = makeManifest(buf)
  const model = manifest.models[0]
  const fetchImpl = makeStreamingFetch(buf)

  const r = await installModel({ manifest, modelId: model.id, modelsDir: modelDir(d), fetchImpl })
  assert.equal(r.ok, true, '小文件应安装成功：' + JSON.stringify(r))
  assert.equal(r.path, expectedModelPath(d, model))
  assert.equal(r.modelId, model.id)
  assert.equal(r.sha256, model.sha256)
  assert.equal(r.bytes, model.bytes)
  assert.equal(fetchImpl.calls(), 1)

  const final = expectedModelPath(d, model)
  assert.equal(existsSync(final), true, '最终文件必须落盘')
  assert.equal(existsSync(final + '.part'), false, '成功安装后不能留 .part')
  const v = await verifyFile({ path: final, sha256: model.sha256, bytes: model.bytes })
  assert.equal(v.ok, true, '落盘文件必须能通过清单校验')

  const installed = await installedModels(modelDir(d), manifest)
  assert.equal(installed[0].verified, true)
})

test('installModel：已装且校验通过时幂等 —— 第二次绝不能再下载', async (t) => {
  const d = tmpDir(t)
  const buf = Buffer.from('idempotent-'.repeat(4000), 'utf8')
  const manifest = makeManifest(buf)
  const model = manifest.models[0]
  const modelsDir = modelDir(d)

  const first = await installModel({ manifest, modelId: model.id, modelsDir, fetchImpl: makeStreamingFetch(buf) })
  assert.equal(first.ok, true)

  // 会 throw 的 fetchImpl 证明第二次没有发出请求：重复点击不能重新下载 26MB
  const mustNotDownload = async () => { throw new Error('幂等安装不应该再次调用 fetchImpl') }
  const second = await installModel({ manifest, modelId: model.id, modelsDir, fetchImpl: mustNotDownload })
  assert.equal(second.ok, true, '已装且校验通过必须直接返回成功：' + JSON.stringify(second))
  assert.equal(second.alreadyInstalled, true)
})

test('installModel：哈希不符时返回 ok:false + 原因，且不产生最终文件', async (t) => {
  const d = tmpDir(t)
  const served = Buffer.from('C'.repeat(2048))
  const expected = Buffer.from('D'.repeat(2048)) // 同大小、不同内容 → 只能靠哈希挡住
  const manifest = makeManifest(expected)
  const model = manifest.models[0]
  const final = expectedModelPath(d, model)

  const r = await installModel({ manifest, modelId: model.id, modelsDir: modelDir(d), fetchImpl: makeStreamingFetch(served) })
  assert.equal(r.ok, false, '哈希不符绝不能当成功')
  assert.match(String(r.message), /sha256 不匹配/, '必须说明是哈希校验失败（而不是"网络错误"）')
  assertNoLeftovers(final, '哈希不符')
})

test('installModel：字节数与清单不符时提前拒绝，不调用哈希也不留文件', async (t) => {
  const d = tmpDir(t)
  const served = Buffer.from('size-mismatch-'.repeat(100), 'utf8')
  const manifest = makeManifest(served, { bytes: served.length + 99 })
  const model = manifest.models[0]
  const final = expectedModelPath(d, model)

  const r = await installModel({ manifest, modelId: model.id, modelsDir: modelDir(d), fetchImpl: makeStreamingFetch(served) })
  assert.equal(r.ok, false)
  assert.match(String(r.message), /大小不符/, '要告诉用户是大小问题，实际字节数对不上')
  assertNoLeftovers(final, '大小不符')
})

test('installModel：fetchImpl 抛 AbortError 时返回 canceled 并清理 .part', async (t) => {
  const d = tmpDir(t)
  const buf = Buffer.from('cancel-'.repeat(2000), 'utf8')
  const manifest = makeManifest(buf)
  const model = manifest.models[0]
  const final = expectedModelPath(d, model)

  // 预先放一个上次中断遗留的 .part，取消时必须被扫掉（不能越积越多）
  const modelsDir = modelDir(d)
  mkdirSync(modelsDir, { recursive: true })
  writeFileSync(final + '.part', 'stale partial')

  const r = await installModel({ manifest, modelId: model.id, modelsDir, fetchImpl: makeAbortFetch() })
  assert.equal(r.ok, false)
  assert.equal(r.reason, 'canceled', '取消必须是 canceled，不能被伪装成 download-failed')
  assert.match(String(r.message), /已取消/)
  assertNoLeftovers(final, '取消后')
})

test('installModel：下载流中途取消 → canceled、无 .part、无悬空写流（历史 uncaughtException 回归）', async (t) => {
  const d = tmpDir(t)
  const buf = Buffer.from('mid-cancel-'.repeat(1500), 'utf8')
  const manifest = makeManifest(buf)
  const model = manifest.models[0]
  const final = expectedModelPath(d, model)

  // 1) downloadFile 本身必须抛 AbortError 并删掉写了一半的 .part（不能把半截文件留在磁盘）
  const dest = join(d, 'direct.part')
  await assert.rejects(
    downloadFile({ url: 'https://example.invalid/mid', dest, expectedBytes: buf.length, fetchImpl: makeMidStreamAbortFetch(buf) }),
    (e) => e instanceof Error && e.name === 'AbortError',
    '中途取消必须以 AbortError 拒绝，调用方才好区分"取消"和"网络错误"',
  )
  assert.equal(existsSync(dest), false, 'downloadFile 自己就要清掉写了一半的 .part，不能指望上层兜底')

  // 2) installModel 必须返回 canceled，且 .part 和最终文件都不存在。
  //    修复前这里会留下悬空写流，晚一步 open 已删除的 .part → ENOENT uncaughtException；
  //    现在是 pipeline 负责销毁写流，用例稳定通过（无异步活动残留由 node:test 直接判失败）。
  const r = await installModel({ manifest, modelId: model.id, modelsDir: modelDir(d), fetchImpl: makeMidStreamAbortFetch(buf) })
  assert.equal(r.ok, false)
  assert.equal(r.reason, 'canceled', '中途取消也必须被识别成 canceled：' + JSON.stringify(r))
  assertNoLeftovers(final, '中途取消')
})

test('模型路径一致性（P0-A 回归锁）：落盘路径 === installedModelPath === 宿主查找路径', async (t) => {
  const d = tmpDir(t)
  const buf = Buffer.from('path-lock-'.repeat(2000), 'utf8')
  const manifest = makeManifest(buf)
  const model = findModel(manifest, DEFAULT_MODEL_ID)

  // 清单 id 与落盘文件名本来就不是同一个字符串；任何拿 id + '.onnx' 拼路径的代码都必然找不到文件。
  assert.notEqual(model.file, model.id + '.onnx', '清单 id 与落盘文件名必须能区分（否则 id 拼接的路径看似可用）')

  const r = await installModel({ manifest, modelId: model.id, modelsDir: modelDir(d), fetchImpl: makeStreamingFetch(buf) })
  assert.equal(r.ok, true)
  // 安装器落盘路径必须等于 installedModelPath(CONFIG_DIR, findModel(...))；安装/查找各算各的就是 P0-A
  assert.equal(r.path, installedModelPath(d, model), 'installModel 的落盘路径必须与 installedModelPath 一致')
  assert.equal(r.path, join(modelDir(d), model.file), '落盘路径必须来自清单 file（不能按 modelId 猜）')

  // 宿主查找路径也必须从清单 file 取、落到同一目录（源码事实断言，防止退回 id + '.onnx'）
  const host = readFileSync(new URL('../index.js', import.meta.url), 'utf8')
  assert.match(host, /const file = \(m && m\.file\) \|\|/, '宿主 voiceprintModelPath 必须优先用清单 file')
  assert.match(host, /join\(CONFIG_DIR, 'voiceprint', 'models', file\)/, '宿主查找必须落到与安装相同的 models 目录')

  // 这个路径必须能被嵌入器接受（存在 + .onnx），而不是一个永远不存在的猜测名
  const e = createEmbedder({ modelPath: r.path })
  assert.equal(e.ok, true, '嵌入器必须接受安装落盘的这个路径：' + r.path)
  assert.equal(e.modelId, DEFAULT_MODEL_ID)
})

// ── 5. atomicInstall ───────────────────────────────────────────────────

test('atomicInstall：目标已存在时必须被新文件替换，且 .part 不残留', (t) => {
  const d = tmpDir(t)
  const final = join(d, 'models', 'model.onnx')
  mkdirSync(join(d, 'models'), { recursive: true })
  writeFileSync(final, '旧模型（可能损坏）')
  const part = final + '.part'
  writeFileSync(part, '新模型内容')

  const got = atomicInstall(part, final)
  assert.equal(got, final)
  assert.deepEqual(readFileSync(final), Buffer.from('新模型内容'), '同路径必须换成新文件（不能旧文件继续留着）')
  assert.equal(existsSync(part), false, 'rename 后 .part 必须消失')
  assert.equal(statSync(final).size, Buffer.byteLength('新模型内容'), '落盘大小必须与 .part 内容一致')
})

test('atomicInstall：目标目录不存在时会创建，跨设备兜底不在本用例模拟', (t) => {
  const d = tmpDir(t)
  const final = join(d, 'deep', 'nested', 'models', 'model.onnx')
  const part = join(d, 'incoming.part')
  writeFileSync(part, 'payload')

  const got = atomicInstall(part, final)
  assert.equal(got, final)
  assert.deepEqual(readFileSync(final), Buffer.from('payload'), '目录不存在也要能装进去')
  assert.equal(existsSync(part), false)
})

// ── 6. installedModels ─────────────────────────────────────────────────

test('installedModels：不存在报 missing；被篡改报 exists 但 verified=false', async (t) => {
  const d = tmpDir(t)
  const buf = Buffer.from('installed-model-'.repeat(1000), 'utf8')
  const manifest = makeManifest(buf)
  const model = manifest.models[0]
  const modelsDir = modelDir(d)
  mkdirSync(modelsDir, { recursive: true })

  const missing = await installedModels(modelsDir, manifest)
  assert.equal(missing.length, 1)
  assert.equal(missing[0].id, model.id)
  assert.equal(missing[0].exists, false, '没装必须明确报不存在')
  assert.equal(missing[0].verified, false, '不存在不能算 verified')
  assert.equal(missing[0].bytes, 0)

  const final = expectedModelPath(d, model)
  writeFileSync(final, buf)
  const good = await installedModels(modelsDir, manifest)
  assert.equal(good[0].exists, true)
  assert.equal(good[0].verified, true, '哈希与大小都对才算已装可用')
  assert.equal(good[0].bytes, buf.length)

  // 被替换成别的字节：文件还在，但不能显示"可用"
  writeFileSync(final, Buffer.from('tampered-model-content'))
  const tampered = await installedModels(modelsDir, manifest)
  assert.equal(tampered[0].exists, true, '文件确实存在')
  assert.equal(tampered[0].verified, false, '篡改过的模型必须标记校验不通过（不能假装能用）')
  assert.equal(tampered[0].bytes, Buffer.from('tampered-model-content').length, 'bytes 应是实际大小，方便界面显示异常')
})

// ── 7. extractTar（本地小 tgz，不下载 115MB）──────────────────────────────

test('extractTar：只解指定成员/完整解压都能落地（无系统 tar 则跳过）', async (t) => {
  const hasTar = spawnSync('tar', ['--version'], { windowsHide: true }).status === 0
  if (!hasTar) { t.skip('系统没有 tar，extractTar 依赖它，跳过（这属于环境限制，不是功能通过）'); return }

  const d = tmpDir(t)
  const src = join(d, 'src')
  mkdirSync(join(src, 'b'), { recursive: true })
  writeFileSync(join(src, 'a.txt'), 'member-a')
  writeFileSync(join(src, 'b', 'inner.txt'), 'member-b')
  const tgz = join(d, 'small.tgz')
  execFileSync('tar', ['-czf', tgz, '-C', src, 'a.txt', 'b'], { windowsHide: true })
  assert.equal(existsSync(tgz), true)

  const onlyA = join(d, 'out-only-a')
  mkdirSync(onlyA)
  await extractTar(tgz, onlyA, ['a.txt'])
  assert.equal(readFileSync(join(onlyA, 'a.txt'), 'utf8'), 'member-a', '指定成员必须解出来且内容一致')
  assert.equal(existsSync(join(onlyA, 'b', 'inner.txt')), false, '没指定的成员不该被解出来（只取 CPU 需要的文件）')

  const full = join(d, 'out-full')
  mkdirSync(full)
  await extractTar(tgz, full)
  assert.equal(readFileSync(join(full, 'a.txt'), 'utf8'), 'member-a')
  assert.equal(readFileSync(join(full, 'b', 'inner.txt'), 'utf8'), 'member-b', '完整解压要包含嵌套成员')
})

// ── 8. runtimeStatus ───────────────────────────────────────────────────

test('runtimeStatus：没有 installed.json 时 installed=false', (t) => {
  const d = tmpDir(t)
  const s = runtimeStatus(join(d, 'voiceprint', 'runtime'))
  assert.equal(s.installed, false, '没标记就是没装，不能靠目录存在假装')
  assert.equal(s.version, '')
  assert.equal(s.backend, '')
})

test('runtimeStatus：合法 installed.json 能读出 version/backend；坏 JSON 不崩且当未装', (t) => {
  const d = tmpDir(t)
  const rt = join(d, 'runtime')
  mkdirSync(rt, { recursive: true })

  writeFileSync(join(rt, 'installed.json'), JSON.stringify({ backend: 'onnxruntime-node', version: '1.31.1', installedAt: '2026-11-11T00:00:00.000Z' }))
  const s = runtimeStatus(rt)
  assert.equal(s.installed, true)
  assert.equal(s.version, '1.31.1')
  assert.equal(s.backend, 'onnxruntime-node')
  assert.equal(s.dir, rt)

  writeFileSync(join(rt, 'installed.json'), '{坏 JSON')
  let broken
  assert.doesNotThrow(() => { broken = runtimeStatus(rt) }, '坏标记只能当作没装，界面不能崩')
  assert.equal(broken.installed, false)
  assert.equal(broken.version, '')
  assert.equal(broken.backend, '')
})

// ── 9. createEmbedder / loadOrtRuntime ─────────────────────────────────

test('createEmbedder：模型文件不存在 → ok:false + reason=model-missing（不假装能用）', () => {
  const missingPath = join(tmpdir(), 'definitely-no-such-voiceprint.onnx')
  const e = createEmbedder({ modelPath: missingPath })
  assert.equal(e.ok, false)
  assert.equal(e.reason, 'model-missing')
  assert.match(String(e.hint), /onnx/i, '必须告诉用户怎么装模型')
  assert.equal(modelStatus('').installed, false)
  assert.equal(modelStatus(missingPath).installed, false)
})

test('createEmbedder：kind=test 时 ok:true、dim=清单维度，向量维度与归一化都对', async (t) => {
  const d = tmpDir(t)
  const e = createEmbedder({ kind: 'test' })
  assert.equal(e.ok, true)
  assert.equal(e.kind, 'test')
  assert.equal(e.dim, EMBEDDER_MODELS[DEFAULT_MODEL_ID].dim)
  assert.equal(e.dim, 256, '默认模型登记 256 维')

  const v = await e.embed(toneSamples(2, 440))
  assert.equal(v.length, e.dim)
  let norm = 0
  for (const x of v) {
    assert.ok(Number.isFinite(x), '嵌入向量不能有 NaN/Inf')
    norm += x * x
  }
  norm = Math.sqrt(norm)
  assert.ok(Math.abs(norm - 1) < 1e-4, '向量必须 L2 归一化，余弦才有意义，norm=' + norm)
})

test('loadOrtRuntime：自装运行库缺 package/dist/index.js 时明确报 onnx-runtime-missing（或真实回退，不假成功）', async (t) => {
  const d = tmpDir(t)
  const rt = join(d, 'runtime-empty')
  mkdirSync(rt, { recursive: true })

  // 宿主是否装了 onnxruntime-node 会影响回退路径：两种结果都必须"真的能跑"或"明确报缺"
  const hostHasOrt = await import('onnxruntime-node').then(() => true, () => false)
  if (!hostHasOrt) {
    await assert.rejects(loadOrtRuntime(rt), (e) => {
      assert.ok(e instanceof EmbedError, '必须抛 EmbedError，而不是一个模糊的 Error')
      assert.equal(e.code, 'onnx-runtime-missing', '缺运行库要给可行动的原因，不能假装能 loading')
      assert.match(e.message, /onnxruntime-node|一键安装/)
      return true
    }, '宿主没有 onnxruntime 且自装库不完整时，加载必须失败')
  } else {
    const mod = await loadOrtRuntime(rt)
    assert.equal(typeof mod.InferenceSession, 'function', '宿主回退时也必须加载到真运行库，不能返回空壳')
  }
})

test('createEmbedder：运行库 package/dist/index.js 存在但加载失败 → embed 抛 EmbedError，不假装成功', async (t) => {
  const d = tmpDir(t)
  const rt = join(d, 'runtime-broken')
  mkdirSync(join(rt, 'package', 'dist'), { recursive: true })
  // 故意写一个 import 就 throw 的入口（模拟 native binding 缺失）
  writeFileSync(join(rt, 'package', 'dist', 'index.js'), 'throw new Error("native binding missing")\n', 'utf8')
  const modelPath = join(d, 'model.onnx')
  writeFileSync(modelPath, 'dummy onnx bytes')

  const e = createEmbedder({ modelPath, runtimeDir: rt })
  assert.equal(e.ok, true, '文件存在时构造阶段可以返回 ok，但 embed 必须真正加载失败')
  assert.equal(e.dim, EMBEDDER_MODELS[DEFAULT_MODEL_ID].dim)

  await assert.rejects(e.embed(toneSamples(1, 440)), (err) => {
    assert.ok(err instanceof EmbedError)
    assert.equal(err.code, 'onnx-runtime-load-failed', '自装运行库坏了要说"加载失败"，不能退回"没装"混淆用户')
    return true
  })
  await assert.rejects(loadOrtRuntime(rt), (err) => err instanceof EmbedError && err.code === 'onnx-runtime-load-failed')
})

// ── installRuntime（无网络：空清单/缺清单）──────────────────────────────

test('installRuntime：清单没有 runtime 时明确拒绝，不下载也不写标记', async (t) => {
  const d = tmpDir(t)
  const rd = runtimeDir(d)
  let fetched = 0
  const r = await installRuntime({ manifest: {}, runtimeDir: rd, fetchImpl: async () => { fetched++; throw new Error('不该下载') } })
  assert.equal(r.ok, false)
  assert.equal(r.reason, 'no-runtime')
  assert.ok(r.message, '要说明为什么装不了运行库')
  assert.equal(fetched, 0)
  assert.equal(existsSync(join(rd, 'installed.json')), false, '失败不能留 installed.json（否则界面以为装好了）')
})

test('installRuntime：空包清单写合法 installed.json，二次调用幂等且不再下载', async (t) => {
  const d = tmpDir(t)
  const rd = runtimeDir(d)
  const manifest = { runtime: { backend: 'onnxruntime-node', version: '1.31.1', packages: [] } }
  let fetched = 0
  const fetchImpl = async () => { fetched++; throw new Error('空包清单不应下载') }

  const first = await installRuntime({ manifest, runtimeDir: rd, fetchImpl })
  assert.equal(first.ok, true)
  assert.equal(first.dir, rd)
  const marker = join(rd, 'installed.json')
  assert.equal(existsSync(marker), true)
  const parsed = JSON.parse(readFileSync(marker, 'utf8'))
  assert.equal(parsed.backend, 'onnxruntime-node')
  assert.equal(parsed.version, '1.31.1')
  assert.ok(parsed.installedAt, '标记要写安装时间，便于审计')
  assert.equal(fetched, 0)

  const second = await installRuntime({ manifest, runtimeDir: rd, fetchImpl })
  assert.equal(second.ok, true)
  assert.equal(second.alreadyInstalled, true, '同版本重装应直接返回，不再下载')
  assert.equal(fetched, 0)
})

// ── 10. 宿主/客户端接线（读源码字符串，风格同 voiceprint.test.mjs）──────

test('接线：会后整理有 identify 步骤，且认人失败不阻断纪要', () => {
  const journal = readFileSync(new URL('../lib/journal.js', import.meta.url), 'utf8')
  const host = readFileSync(new URL('../index.js', import.meta.url), 'utf8')

  assert.match(journal, /PIPELINE_STEPS = Object\.freeze\(\['offline', 'identify', 'minutes'/, 'identify 必须插在 offline 之后、minutes 之前')
  assert.match(journal, /identify: 'speakers\.json'/, '认人结果必须先落盘')
  assert.match(host, /if \(!embedder\.ok\) \{/, '没装模型时要 skip 认人而不是 throw（纪要照样要出）')
  assert.match(host, /reason:'声纹模型未安装，说话人保持匿名'/, '跳过必须留下可见原因')
})

test('接线：/voiceprint-install 是受理式（立刻返回 started，不 await 整个安装），并发 busy，进度按真实字节加权', () => {
  const host = readFileSync(new URL('../index.js', import.meta.url), 'utf8')

  assert.match(host, /sub === 'voiceprint-install'/, '缺少一键安装路由')
  assert.match(host, /sub === 'voiceprint-install-cancel'/, '缺少取消路由；取消后不能一直显示"正在安装"')

  // 并发：读请求体前后各查一次 running（双击时两个请求都会先过第一次检查）
  const busyChecks = (host.match(/if \(installState\.running\) return json\(200, \{ ok: false, reason: 'busy'/g) || []).length
  assert.ok(busyChecks >= 2, '并发点击必须返回 busy，而且要在读 body 前后各挡一次，不能开两份下载')

  // 受理式：立刻返回 started:true；后台任务用 Promise.resolve(task).catch 兜住，不能把 await 挂在响应上
  assert.match(host, /return json\(200, \{ ok: true, started: true, install: installState/, 'POST 必须立刻返回 started:true + 当前 install（running 已是 true）')
  assert.match(host, /const task = runVoiceprintInstall\(/, '安装必须在后台任务里启动')
  assert.match(host, /Promise\.resolve\(task\)\.catch\(/, '后台任务失败必须自己兜住，不能把 await 挂在响应上')
  assert.equal((host.match(/await runVoiceprintInstall\(/g) || []).length, 0, '响应前不能 await 整个安装（否则几分钟里界面只有灰按钮，看不到真实进度）')

  // running 必须在第一个 await 之前同步置 true，这样受理式响应里的 install.running 一定是 true
  const runStart = host.indexOf('async function runVoiceprintInstall')
  const runningTrue = host.indexOf('running: true', runStart)
  const firstAwait = host.indexOf('await installModel(', runStart)
  assert.ok(runStart >= 0 && runningTrue > runStart && runningTrue < firstAwait, 'runVoiceprintInstall 必须同步占位 running:true（在第一个 await 之前），否则受理式返回时界面会以为没在装')

  // 进度：整体 percent 的分母是模型 bytes + 运行库各包 bytes 之和；运行库阶段要叠加模型已完成字节
  assert.match(host, /const runtimeBytes = rtPackages\.reduce\(/, '运行库总字节必须从清单 packages 汇总，不能估')
  assert.match(host, /const totalBytes = \(Number\(model\.bytes\) \|\| 0\) \+ runtimeBytes/, '整体进度分母必须是模型 bytes + 运行库 bytes 之和（否则装运行库时进度会归零或超 100）')
  assert.match(host, /const overall = totalBytes \? Math\.min\(100, Math\.floor\(\(p\.received \/ totalBytes\) \* 100\)\) : 0/, '模型下载阶段要按 received/totalBytes 算整体进度')
  assert.match(host, /const doneBytes = Number\(model\.bytes\) \+ Number\(p\.received\)/, '运行库下载阶段必须叠加模型已完成的字节')
  assert.match(host, /const overall = totalBytes \? Math\.min\(100, Math\.floor\(\(doneBytes \/ totalBytes\) \* 100\)\) : 0/, '运行库阶段的整体进度必须按 doneBytes/totalBytes 算')
  // 整体 percent 不能用单文件百分比（旧公式只允许留在"本步文案"里，不能写进 percent 字段）
  assert.doesNotMatch(host, /percent: Math\.floor\(\(p\.received \/ p\.total\)/, 'percent 字段必须用加权后的 overall')

  // 步数/步名：界面要能显示"第几步/共几步"
  assert.match(host, /step: 1, stepsTotal, stepLabel: '模型'/, '模型阶段要写 step/stepsTotal/stepLabel')
  assert.match(host, /step: 2, stepsTotal, stepLabel: '运行库'/, '运行库阶段要写 step/stepsTotal/stepLabel')
  assert.match(host, /step: stepsTotal, stepsTotal, stepLabel:/, '终态要落在最后一步')

  // 取消：路由只置"正在取消"，终态 idle 由后台任务写；取消后不允许再写 done/failed
  assert.match(host, /saveInstallState\(\{ canceling: true, message: '正在取消/, '取消路由不能直接抢写终态（否则和后台任务打架）')
  assert.match(host, /phase: 'idle', running: false, message: '已取消'/, '取消终态必须是 idle，不是 failed')
  assert.match(host, /if \(ac\.signal\.aborted\) return canceled\(\)/, '每个 await 之后都要查 signal，取消后不能再写 done/failed')
  // 所有退出路径都必须把 running 置回 false，界面不能永久卡在"正在安装…"
  assert.match(host, /if \(installState\.running\) saveInstallState\(\{ running: false, canceling: false \}\)/, 'finally 兜底必须复位 running=false')

  // 启动时读回 install.json 必须交给统一投影归一化（重启后不能保留"进行中"阶段）
  assert.match(host, /return normalizeInstallState\(raw\)/, '启动必须用 install-state.js 的 normalizeInstallState 归一化重启残留状态')
  assert.match(host, /installState = mergeInstallState\(installState, patch\)/, '状态迁移必须走 mergeInstallState（唯一一份投影）')
})

test('接线：client.js 显示受理式状态、stepLabel、真实字节进度、取消、失败原因与 hint', () => {
  const client = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')

  assert.match(client, /function VoiceprintCard/)
  assert.match(client, /一键安装/, '卡片上必须有安装入口')
  assert.match(client, /installing \? '正在安装…' : \('一键安装'/, '安装中按钮要变文案并禁用（避免重复点）')
  assert.match(client, /'aria-valuenow': install\.percent \|\| 0/, '进度条要读服务端真实 percent（aria-valuenow），不能是本地假动画')
  assert.match(client, /role: 'progressbar'/)
  assert.match(client, /onClick: cancelInstall \}, '取消'/, '安装中必须能取消')
  assert.match(client, /voiceprint-install-cancel/, '取消按钮要真的调后端取消路由')
  // 受理式：立刻提示"已开始安装"，不能等整个 135MB 下载完才反馈
  assert.match(client, /if \(j && j\.started\)/, '收到 started 要立刻提示"已开始安装"')
  assert.match(client, /已开始安装/, '受理式返回后要马上给用户反馈')
  // 步数/步名来自服务端状态，界面只展示不猜
  assert.match(client, /st\.stepsTotal/, '要展示共几步')
  assert.match(client, /st\.stepLabel/, '受理式反馈里要展示当前步名')
  assert.match(client, /install\.stepsTotal > 1/, '多步安装要显示第几步/共几步')
  // 取消：先显示"正在取消"，终态 idle 要显示"已取消"而不是"失败"
  assert.match(client, /正在取消/, '取消后要显示正在取消（终态由后台写）')
  // 语义断言：不依赖局部变量名（实现用 inst / install 都不该误报），只锁"idle 终态 + 读 message"
  assert.match(client, /phase === 'idle' && String\([A-Za-z_$][\w$]*\.message \|\| ''\)/, '取消终态 idle 要能识别成"已取消"，不能显示成失败')
  // 且必须真的按 message 的"已取消"前缀判定，不能只要 phase=idle 就当取消成功
  assert.match(client, /phase === 'idle'[\s\S]{0,160}已取消/, 'idle 终态必须按 message 的"已取消"前缀判定，不能一律显示失败')
  // 失败必须给原因 + hint
  assert.match(client, /安装失败：' \+ install\.error/, '失败必须把具体原因显示出来（不能只显示"失败"）')
  assert.match(client, /install\.hint \? h\('div'/, '失败要带 hint（告诉用户下一步怎么办）')
  assert.match(client, /setInterval\(function \(\) \{ if \(alive\) refresh\(\) \}, 800\)/, '安装中要轮询真实状态，而不是自己造进度')
})
