/**
 * 「之前的录音」导入 + 完整会后整理（转写 → 认人 → 纪要 → 知识库）的测试。
 *
 * 被测的真实接口（以工作区代码为准）：
 *   GET  /api/soulmirror/recordings        → { ok, recordings[], unsupportedCount, silentCount, total, scanned }
 *   POST /api/soulmirror/import-recording  → {path} 导入本机音频 / {recordDir} 用已有录音重新整理
 *   POST /api/soulmirror/offline           → 无音频三分类：no-capture / no-audio-file / silent
 *   POST /api/soulmirror/records/delete    → 只删会议根的直接子目录、前端二次确认、日志留痕
 *   纯函数在 lib/recordings.js：pcmToWavBuffer / classifyNoAudio / parseWavHeader /
 *   isTargetWavFormat / isDirectChildDir / nextImportDir / listRecordings …
 *
 * 三层覆盖：
 *   ① 纯函数层：WAV 头与小端字节序、空输入、三类无音频分类 + hint、格式判定、删除边界、目录命名。
 *   ② 接口层：tests/helpers/isolated-plugin.mjs 隔离宿主（默认封锁真实 child_process / fetch），
 *      在临时数据目录里造样本，真跑 apiHandler：列表、导入（wav/pcm）、六种失败原因、删除。
 *   ③ 接线层（源码事实）：新增 sub 不能落在分组守卫外（voiceprint-install 404 的教训）、
 *      导入必须「先落盘 meta/audio 再 enqueue」、导入路由段不执行 shell、前端有无音频分支与二次确认。
 *
 * 约束：临时目录都在 isolatePlugin 的 fakeHome 里（统一 rmSync）；不联网、不录音、
 * 不读也不写用户真实数据目录。实现未落地的项用 t.skip('实现未落地: …')，不写会红的假测试。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync,
  rmSync, statSync, truncateSync, writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, basename } from 'node:path'
import { fileURLToPath } from 'node:url'

import { isolatePlugin, applyIsolated } from './helpers/isolated-plugin.mjs'

// ── 源码事实 ────────────────────────────────────────────────────────────
const HOST_SRC = readFileSync(new URL('../index.js', import.meta.url), 'utf8')
const CLIENT_SRC = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
const LIB_DIR = fileURLToPath(new URL('../lib/', import.meta.url))
const LIB_FILES = readdirSync(LIB_DIR)
  .filter((n) => n.endsWith('.js'))
  .map((n) => ({ name: n, path: join(LIB_DIR, n) }))

function hasRoute(sub) {
  const escaped = sub.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
  return new RegExp(`sub === '${escaped}'`).test(HOST_SRC)
}

// ── 隔离宿主（真跑 apiHandler，不启动服务器） ───────────────────────────
const fakeHome = mkdtempSync(join(tmpdir(), 'sm-rec-import-'))
isolatePlugin(fakeHome)
// 让 session.dataRoot() 与 CONFIG_DIR 落在同一处（与生产默认一致：cfg.dataDir 为空时
// dataRoot 就是 CONFIG_DIR），这样"列表读哪个根"没有歧义。
const DATA_DIR = join(fakeHome, 'soulmirror')
mkdirSync(DATA_DIR, { recursive: true })

const mod = await import('../index.js')
const plugin = mod.default || mod

const routes = []
applyIsolated(plugin, {
  tools: { register() {} },
  logger: { info() {}, warn() {}, error() {} },
  get: (k) => (k === 'webServer' ? { port: 3097 } : undefined),
  webServer: { port: 3097, register(r) { routes.push(r) } },
  on: () => () => {},
  effect: () => () => {},
  emit() {},
}, { dataDir: DATA_DIR })

const route = routes.find((r) => String(r.path || '').startsWith('/api/soulmirror')) || routes[0]
assert.ok(route && typeof route.handler === 'function', '隔离宿主里应当注册了 /api/soulmirror 前缀路由')

async function call(method, url, body) {
  let out = ''
  let status = 0
  const res = {
    writeHead(code) { status = code },
    end(s) { out = s },
    setHeader() {},
  }
  const req = { method, url }
  if (body !== undefined) {
    req[Symbol.asyncIterator] = async function* () { yield Buffer.from(JSON.stringify(body)) }
  }
  await route.handler(req, res)
  let parsed = null
  try { parsed = JSON.parse(out) } catch { parsed = out }
  return { status, body: parsed }
}

/** 轮询等待（journal 落盘是同步的，但给慢盘留余量） */
async function waitFor(fn, timeoutMs = 2000) {
  const until = Date.now() + timeoutMs
  while (Date.now() < until) {
    if (fn()) return true
    await new Promise((r) => setTimeout(r, 50))
  }
  return fn()
}

// ── 纯函数模块（动态导入，缺了就跳过而不是整份测试崩掉） ─────────────────
const REC = await import('../lib/recordings.js').catch(() => null)

// ── 造样本（不依赖任何真实用户文件） ─────────────────────────────────────
/** 标准 16k/16bit/单声道 WAV；silent=true 时样本全零 */
function makeWav({ seconds = 3, sampleRate = 16000, channels = 1, bits = 16, freq = 440, silent = false } = {}) {
  const bytesPerSample = bits / 8
  const frames = Math.round(seconds * sampleRate)
  const dataSize = frames * channels * bytesPerSample
  const buf = Buffer.alloc(44 + dataSize)
  const byteRate = sampleRate * channels * bytesPerSample
  buf.write('RIFF', 0, 'ascii')
  buf.writeUInt32LE(36 + dataSize, 4)
  buf.write('WAVE', 8, 'ascii')
  buf.write('fmt ', 12, 'ascii')
  buf.writeUInt32LE(16, 16)          // fmt 块长度
  buf.writeUInt16LE(1, 20)           // PCM
  buf.writeUInt16LE(channels, 22)
  buf.writeUInt32LE(sampleRate, 24)
  buf.writeUInt32LE(byteRate, 28)
  buf.writeUInt16LE(channels * bytesPerSample, 32) // block align
  buf.writeUInt16LE(bits, 34)
  buf.write('data', 36, 'ascii')
  buf.writeUInt32LE(dataSize, 40)
  if (!silent && bits === 16) {
    for (let i = 0; i < frames; i++) {
      const v = Math.round(Math.sin(2 * Math.PI * freq * i / sampleRate) * 0.35 * 32767)
      buf.writeInt16LE(Math.max(-32768, Math.min(32767, v)), 44 + i * 2)
    }
  }
  return buf
}

/** 3 秒裸 PCM（16k/16bit 单声道） */
function makePcm({ seconds = 3 } = {}) {
  const wav = makeWav({ seconds })
  return Buffer.from(wav.subarray(44))
}

let seq = 0
/** 造一个"会议目录"：目录名必须时间戳前缀（扫描只认这种），其余按需 */
function makeRecordDir(root, { withWav = false, wav = null, meta = null } = {}) {
  seq += 1
  const day = String(10 + seq).padStart(2, '0')
  const name = `2026-01-${day}-0900-${String(seq).padStart(2, '0')}-fixture`
  const dir = join(root, name)
  mkdirSync(dir, { recursive: true })
  if (withWav || wav) writeFileSync(join(dir, 'audio.wav'), wav || makeWav({ seconds: 3 }))
  if (meta) writeFileSync(join(dir, 'meta.json'), JSON.stringify(meta, null, 2), 'utf8')
  return dir
}

const norm = (p) => String(p || '').replace(/\\/g, '/')
const pickRecord = (list, dir) => (Array.isArray(list) ? list.find((r) => r && norm(r.dir) === norm(dir)) : null)

// ── 守卫结构扫描（可复用 + 自检，见"扫描器自检"用例） ─────────────────────
/**
 * 找出 index.js 里"分组守卫"（条件只用 || 串起若干 `sub === 'x'` 的 if），
 * 再检查分组体内的方法级处理器（`if (sub === 'y' && ...)`）是否都属于该分组。
 *
 * 为什么必须锁：上次 `voiceprint-install` 的路由写在分组体里，但分组条件漏了
 * 这个 sub，请求直接掉到 apiHandler 末尾的 404 —— 面板永远只有一个灰按钮。
 */
function scanGuardGroups(src) {
  const lines = src.split('\n')
  const indentOf = (l) => l.match(/^\s*/)[0].length
  const subTokens = (cond) => Array.from(cond.matchAll(/sub === '([^']+)'/g)).map((m) => m[1])

  const readCondition = (start) => {
    let paren = 0
    let cond = ''
    let end = start
    for (let j = start; j < lines.length && j < start + 12; j++) {
      cond += lines[j] + '\n'
      for (const ch of lines[j]) {
        if (ch === '(') paren += 1
        else if (ch === ')') paren -= 1
      }
      end = j
      if (paren <= 0 && cond.includes('(')) break
    }
    return { cond, end }
  }

  const groups = []
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim()
    if (!/^(?:else )?if\s*\(\s*sub ===/.test(t)) continue
    const { cond, end } = readCondition(i)
    if (/&&/.test(cond)) continue // 带 && 的是方法级处理器，不是分组守卫
    const members = subTokens(cond)
    if (!members.length) continue
    // 分组体收尾：同缩进的孤立 "}"
    let close = lines.length - 1
    for (let j = end + 1; j < lines.length; j++) {
      if (lines[j].trim() === '}' && indentOf(lines[j]) === indentOf(lines[i])) { close = j; break }
    }
    groups.push({ at: i + 1, members, close: close + 1 })
  }

  const problems = []
  for (const g of groups) {
    for (let j = g.at; j < g.close; j++) { // g.at 是 1-based 的 if 行 → 从其下一行开始
      const lt = lines[j].trim()
      if (!/^(?:else )?if\s*\(\s*(?:sub ===|req\.method ===)/.test(lt)) continue
      const inner = readCondition(j)
      const toks = subTokens(inner.cond)
      if (!toks.length) continue
      if (!/&&/.test(inner.cond)) continue // 嵌套分组自身由外层继续校验
      for (const tok of toks) {
        if (!g.members.includes(tok)) {
          problems.push(`index.js:${j + 1} 分组（index.js:${g.at}）成员[${g.members.join(',')}]里没有 sub '${tok}'，该路由会落到 404`)
        }
      }
    }
  }
  return { groups, problems }
}

// ══ ① 基线 + 守卫结构（现在就应该绿） ═══════════════════════════════════
test('隔离宿主基线：/records 只看到本测试造的数据，不读用户真实目录', async () => {
  const seeded = makeRecordDir(DATA_DIR, {
    withWav: true,
    meta: { title: 'fixture-baseline', startedAt: '2026-01-10T09:00:00Z', endedAt: '2026-01-10T09:30:00Z' },
  })
  const r = await call('GET', '/api/soulmirror/records')
  assert.equal(r.status, 200)
  assert.equal(r.body.ok, true)
  assert.ok(Array.isArray(r.body.records), 'records 必须是数组')
  const hit = r.body.records.some((x) => norm(x.dir) === norm(seeded))
  assert.ok(hit, '刚造好的会议目录应当出现在列表里')
  for (const rec of r.body.records) {
    assert.ok(norm(rec.dir).startsWith(norm(DATA_DIR)), '隔离失败：列表里出现了本测试目录之外的记录：' + rec.dir)
  }
})

test('守卫结构：新增 sub 不能落在分组守卫外（voiceprint-install 404 的教训）', () => {
  const { groups, problems } = scanGuardGroups(HOST_SRC)
  assert.ok(groups.length >= 6, '应当能找到现有的分组守卫（reply/advice/voiceprint/speakers/deps/pet…），实际 ' + groups.length)
  assert.deepEqual(problems, [], '所有分组内的 sub 处理器都必须属于该分组的条件：\n' + problems.join('\n'))

  // 声纹安装那次 404 的定点修复不能被回退
  assert.match(HOST_SRC, /sub === 'voiceprint-install'/, '声纹安装路由的守卫修复不能被回退')
  const vp = groups.find((g) => g.members.includes('voiceprint-install'))
  assert.ok(vp, 'voiceprint-install 必须出现在某个分组守卫的条件里')
  assert.ok(vp.members.includes('voiceprint-install-cancel'), '安装/取消是同一组上下文，不能只修一半')
})

test('守卫扫描器自检：漏写 sub 的写法必须被判定为问题（回放那次 404）', () => {
  const bad = [
    "if (sub === 'voiceprint' || sub === 'voiceprint-enroll') {",
    "  if (sub === 'voiceprint-install' && req.method === 'POST') {",
    '    return json(200, { ok: true })',
    '  }',
    '}',
  ].join('\n')
  const res = scanGuardGroups(bad)
  assert.equal(res.groups.length, 1)
  assert.equal(res.problems.length, 1, '漏写 sub 的分组必须被报出来，实际 ' + res.problems.length)
  assert.match(res.problems[0], /voiceprint-install/)
  const good = bad.replace("sub === 'voiceprint-enroll'", "sub === 'voiceprint-enroll' || sub === 'voiceprint-install'")
  assert.deepEqual(scanGuardGroups(good).problems, [], '修好之后必须归零')
})

// ══ ② 纯函数层（lib/recordings.js） ═════════════════════════════════════
test('pcmToWavBuffer：RIFF/WAVE 头、data 大小、采样参数与小端字节序', (t) => {
  if (!REC || typeof REC.pcmToWavBuffer !== 'function') return t.skip('实现未落地: lib/recordings.js 没有导出 pcmToWavBuffer')
  const payload = makePcm({ seconds: 1 })   // 32000 字节
  const wav = REC.pcmToWavBuffer(payload, { sampleRate: 16000 })
  assert.ok(Buffer.isBuffer(wav), 'pcmToWavBuffer 必须返回 Buffer')
  assert.equal(wav.length, 44 + payload.length, 'WAV 应是 44 字节标准头 + PCM')
  assert.equal(wav.toString('ascii', 0, 4), 'RIFF')
  assert.equal(wav.readUInt32LE(4), 36 + payload.length, 'RIFF 块长度 = 36 + data 长度（小端）')
  assert.equal(wav.toString('ascii', 8, 12), 'WAVE')
  assert.equal(wav.toString('ascii', 12, 16), 'fmt ')
  assert.equal(wav.readUInt32LE(16), 16, 'fmt 块长度 16')
  assert.equal(wav.readUInt16LE(20), 1, 'audioFormat 必须是 PCM(1)')
  assert.equal(wav.readUInt16LE(22), 1, '声道数必须是 1（16k 单声道）')
  assert.equal(wav.readUInt32LE(24), 16000, '采样率写的是 16000（小端）')
  assert.equal(wav.readUInt32LE(28), 32000, 'byteRate = 采样率*声道*位宽/8')
  assert.equal(wav.readUInt16LE(32), 2, 'blockAlign = 2')
  assert.equal(wav.readUInt16LE(34), 16, '位深 16')
  assert.equal(wav.toString('ascii', 36, 40), 'data')
  assert.equal(wav.readUInt32LE(40), payload.length, 'data 块长度必须等于 pcm 字节数')
  assert.deepEqual(Buffer.from(wav.subarray(44)), payload, '样本必须原样写进 data，不能静默重采样')
  // 小端反证：大端写入会让采样率读成荒谬的数
  assert.ok(wav.readUInt32LE(24) < 100000)
})

test('pcmToWavBuffer：空 pcm 明确报错，不产出坏 WAV', (t) => {
  if (!REC || typeof REC.pcmToWavBuffer !== 'function') return t.skip('实现未落地: pcmToWavBuffer 未导出')
  assert.throws(() => REC.pcmToWavBuffer(Buffer.alloc(0), { sampleRate: 16000 }),
    /(?:空|empty|没有|无效|invalid|required)/i,
    '空 pcm 必须抛错；返回 44 字节空壳会让下游误以为有音频')
})

test('classifyNoAudio：no-capture / no-audio-file / silent 三类，hint 非空', (t) => {
  if (!REC || typeof REC.classifyNoAudio !== 'function') return t.skip('实现未落地: classifyNoAudio 未导出')
  const kindOf = (r) => (r && (r.reason || r.kind)) || null
  const cases = [
    // 采集进程压根没起来：meta.capture.bytes === 0（且磁盘上确实没有音频）
    [{ meta: { capture: { bytes: 0, silentSec: 0, durationSec: 30, silentRatio: 1 } }, wavBytes: 0, pcmBytes: 0 }, 'no-capture'],
    // meta 没有 capture 记录，也没有留下任何音频文件
    [{ meta: { title: 'x' }, wavBytes: 0, pcmBytes: 0 }, 'no-audio-file'],
    // 有音频文件，但整场几乎静音
    [{ meta: { capture: { bytes: 96044, silentSec: 3, durationSec: 3, silentRatio: 0.99 } }, wavBytes: 96044, pcmBytes: 0 }, 'silent'],
  ]
  for (const [input, expected] of cases) {
    const got = REC.classifyNoAudio(input)
    assert.equal(kindOf(got), expected, JSON.stringify(input) + ' 应判为 ' + expected + '，实际 ' + kindOf(got))
    assert.ok(String((got && got.hint) || '').trim().length > 0, expected + ' 必须带非空 hint（界面要告诉用户下一步）')
  }
  // 反例：有声音的正常录音不能被判死
  assert.equal(REC.classifyNoAudio({ meta: { capture: { bytes: 192000, silentSec: 0, silentRatio: 0 } }, wavBytes: 192000, pcmBytes: 0 }), null)
  // 只有裸 pcm 也算有音频（强杀后没封装成 wav 的那种）
  assert.equal(REC.classifyNoAudio({ meta: { capture: { bytes: 0 } }, wavBytes: 0, pcmBytes: 96000 }), null, '有 pcm 就不能判成"没采集"')
  // 音频是硬证据：meta 写错了 bytes=0，但 wav 在，也不能判成 no-capture
  assert.notEqual(kindOf(REC.classifyNoAudio({ meta: { capture: { bytes: 0 } }, wavBytes: 96044, pcmBytes: 0 })), 'no-capture',
    '文件在就不能因为 meta 写错判死')
  // 连采集时长都没有记录：只能说"没有留下音频文件"，不能断言"没采到"
  assert.equal(kindOf(REC.classifyNoAudio({ meta: { capture: { bytes: 0 } }, wavBytes: 0, pcmBytes: 0 })), 'no-audio-file', '没有采集时长记录时不能说成没采到')
  // 契约里写的调用形状 classifyNoAudio(meta, files) 也要能用（不能只支持对象入参）
  assert.equal(kindOf(REC.classifyNoAudio({ capture: { bytes: 0, silentSec: 3, durationSec: 3 } }, [])), 'no-capture', '位置参数形式：meta + 文件清单')
  assert.equal(kindOf(REC.classifyNoAudio({ capture: { bytes: 100, silentRatio: 0.99 } }, ['audio.wav'])), 'silent', '位置参数形式也要能判静音')
})

test('WAV 头解析与目标格式判定：16k/16bit/单声道 才接受', (t) => {
  if (!REC || typeof REC.parseWavHeader !== 'function') return t.skip('实现未落地: parseWavHeader 未导出')
  const good = makeWav({ seconds: 3 })
  const fmt = REC.parseWavHeader(good, good.length)
  assert.equal(fmt.riff, true)
  assert.equal(fmt.wav, true)
  assert.equal(fmt.formatTag, 1)
  assert.equal(fmt.channels, 1)
  assert.equal(fmt.sampleRate, 16000)
  assert.equal(fmt.bits, 16)
  assert.equal(fmt.dataOffset, 44)
  assert.equal(fmt.dataBytes, 96000, '3 秒 16k 16bit = 96000 字节 data')
  assert.equal(REC.isTargetWavFormat(fmt), true)

  const wrong = makeWav({ seconds: 1, sampleRate: 48000, channels: 2 })
  const fmt2 = REC.parseWavHeader(wrong, wrong.length)
  assert.equal(REC.isTargetWavFormat(fmt2), false, '48k/立体声必须被拒（不能静默重采样）')
  assert.match(REC.describeWavFormat(fmt2), /48000 Hz \/ 2 通道 \/ 16 bit/)

  const empty = REC.parseWavHeader(makeWav({ seconds: 1 }), 0)
  assert.equal(REC.isTargetWavFormat(empty), false, '没有 data 区不能算可用')
  const junk = REC.parseWavHeader(Buffer.from('not a wav at all'), 16)
  assert.equal(junk.riff, false)
  assert.match(REC.describeWavFormat(junk), /不是合法的 WAV/)
})

test('isDirectChildDir：删除/整理只允许会议根的直接子目录（安全边界）', (t) => {
  if (!REC || typeof REC.isDirectChildDir !== 'function') return t.skip('实现未落地: isDirectChildDir 未导出')
  const root = join(fakeHome, 'boundary-root')
  mkdirSync(root, { recursive: true })
  const child = join(root, '2026-01-01-0900-x')
  mkdirSync(child, { recursive: true })
  const nested = join(child, 'nested')
  mkdirSync(nested, { recursive: true })
  assert.equal(REC.isDirectChildDir(root, child), true, '直接子目录应当允许')
  assert.equal(REC.isDirectChildDir(root, root), false, '根目录本身不能被当成记录删掉')
  assert.equal(REC.isDirectChildDir(root, nested), false, '嵌套子目录不能直接删（会误删整场会）')
  assert.equal(REC.isDirectChildDir(root, join(fakeHome, 'outside')), false, '根之外一律拒绝')
  assert.equal(REC.isDirectChildDir(root, join(root, '..', 'outside')), false, '.. 穿越必须拒绝')
  // 前缀混淆：soulmirror-evil 不能被当成 soulmirror 的子目录
  assert.equal(REC.isDirectChildDir(join(fakeHome, 'sm'), join(fakeHome, 'sm-evil')), false, '同前缀兄弟路径不能被接受')
})

test('nextImportDir：<时间戳>-import 命名且绝不复用已有目录', (t) => {
  if (!REC || typeof REC.nextImportDir !== 'function') return t.skip('实现未落地: nextImportDir 未导出')
  const root = mkdtempSync(join(fakeHome, 'nextdir-'))
  const now = new Date('2026-01-05T06:07:08.009Z')
  const first = REC.nextImportDir(root, { now })
  assert.match(basename(first), /^2026-01-05T06-07-08-009Z-import$/)
  mkdirSync(first, { recursive: true })
  const second = REC.nextImportDir(root, { now })
  assert.notEqual(norm(second), norm(first), '同名已存在时必须换一个目录，不能复用别人的')
  assert.match(basename(second), /-import-2$/)
  assert.ok(norm(second).startsWith(norm(root) + '/'))
  rmSync(root, { recursive: true, force: true })
})

test('ffmpeg 命令只是文案：16k/单声道，不执行任何命令', (t) => {
  if (!REC || typeof REC.ffmpegCommand !== 'function') return t.skip('实现未落地: ffmpegCommand 未导出')
  const cmd = REC.ffmpegCommand('C:\\Users\\你\\Downloads\\meeting (1).wav', 'C:\\out\\meeting-16k.wav')
  assert.match(cmd, /-ac 1/, '必须是单声道')
  assert.match(cmd, /-ar 16000/, '必须是 16k 采样率')
  assert.match(cmd, /-i "C:\\Users/, '路径要带引号（含空格/中文也能复制去跑）')
  assert.doesNotMatch(cmd, /&|\||>|<|\$\(/, '不能拼带 shell 元字符的命令串')
})

test('listRecordings（纯函数）：只认时间戳目录、无音频只计数、silent 单列', (t) => {
  if (!REC || typeof REC.listRecordings !== 'function') return t.skip('实现未落地: listRecordings 未导出')
  const root = mkdtempSync(join(fakeHome, 'listcand-'))
  mkdirSync(join(root, '_probe'), { recursive: true })                        // 非时间戳目录：忽略
  const good = join(root, '2026-02-01-0900-good')
  mkdirSync(good, { recursive: true })
  writeFileSync(join(good, 'audio.wav'), makeWav({ seconds: 3 }))
  writeFileSync(join(good, 'meta.json'), JSON.stringify({ title: '好录音', startedAt: '2026-02-01T01:00:00Z' }))
  const silent = join(root, '2026-02-02-0900-silent')
  mkdirSync(silent, { recursive: true })
  writeFileSync(join(silent, 'audio.wav'), makeWav({ seconds: 3, silent: true }))
  writeFileSync(join(silent, 'meta.json'), JSON.stringify({ capture: { bytes: 96044, silentRatio: 0.99, silentSec: 3, durationSec: 3 } }))
  const empty = join(root, '2026-02-03-0900-empty')
  mkdirSync(empty, { recursive: true })
  // 采集跑过（有时长/静音秒数）但 0 字节 → no-capture
  writeFileSync(join(empty, 'meta.json'), JSON.stringify({ capture: { bytes: 0, silentSec: 0, durationSec: 600, silentRatio: 1 } }))
  const imported = join(root, '2026-02-04-0900-import')
  mkdirSync(imported, { recursive: true })
  writeFileSync(join(imported, 'audio.wav'), makeWav({ seconds: 2 }))
  writeFileSync(join(imported, 'meta.json'), JSON.stringify({ source: 'import', originalPath: 'C:\\x\\a.wav', title: 'a.wav' }))

  const res = REC.listRecordings(root, { limit: 10 })
  assert.equal(res.unsupportedCount, 1, '没有音频的目录要计数（实际 ' + res.unsupportedCount + '）')
  assert.equal(res.silentCount, 1, '整场静音要单列计数')
  assert.equal(res.total, 4, '清单要包含：好录音 + 静音 + 没有音频 + 导入，实际 ' + res.total)
  // 没有音频的记录也要出现在清单里（否则用户看不到、也删不掉它）
  const hitEmpty = pickRecord(res.recordings, empty)
  assert.ok(hitEmpty, '没有音频的记录要在清单里（界面按 hasAudio 不出整理按钮）')
  assert.equal(hitEmpty.hasAudio, false, 'hasAudio 必须是磁盘事实')
  assert.equal(hitEmpty.reason, 'no-capture', '原因要带出来，用户才知道为什么不能整理')
  const hitImport = pickRecord(res.recordings, imported)
  assert.equal(hitImport.kind, 'import')
  assert.equal(hitImport.originalPath, 'C:\\x\\a.wav')
  const hitGood = pickRecord(res.recordings, good)
  assert.equal(hitGood.kind, 'meeting')
  assert.equal(hitGood.hasAudio, true)
  assert.ok(Math.abs(hitGood.seconds - 3) <= 0.2, '3 秒录音的 seconds 应约 3，实际 ' + hitGood.seconds)
  assert.equal(hitGood.bytes, statSync(join(good, 'audio.wav')).size, 'bytes 是 audio.wav 的真实大小')
  assert.equal(hitGood.hasMinutes, false)
  assert.equal(hitGood.hasTranscript, false)
  const hitSilent = pickRecord(res.recordings, silent)
  assert.equal(hitSilent.reason, 'silent', '静音场次要带 reason，界面据此不出整理按钮')
  assert.ok(String(hitSilent.hint || '').trim().length > 0)
  assert.ok(!res.recordings.some((r) => r && r.dir === join(root, '_probe')), '非时间戳目录不能被当成会议')
  rmSync(root, { recursive: true, force: true })
})

// ══ ③ 接口层（真跑 apiHandler） ═════════════════════════════════════════
test('GET /recordings：列出会议目录、算 seconds/bytes、无音频目录计入 unsupportedCount', async (t) => {
  if (!hasRoute('recordings')) return t.skip("实现未落地: index.js 没有 sub === 'recordings' 路由")
  const good = makeRecordDir(DATA_DIR, {
    withWav: true,
    meta: { title: 'fixture-recording', startedAt: '2026-01-11T01:00:00Z', endedAt: '2026-01-11T01:30:00Z' },
  })
  const wavBytes = statSync(join(good, 'audio.wav')).size
  const noAudio = makeRecordDir(DATA_DIR, {
    meta: { title: 'fixture-no-capture', startedAt: '2026-01-11T02:00:00Z', endedAt: '2026-01-11T02:10:00Z', capture: { bytes: 0, silentSec: 0, durationSec: 600, silentRatio: 1 } },
  })
  writeFileSync(join(noAudio, 'minutes.md'), '# 只有纪要（没有录音）\n', 'utf8')

  const r = await call('GET', '/api/soulmirror/recordings')
  assert.equal(r.status, 200)
  assert.equal(r.body.ok, true)
  assert.ok(Array.isArray(r.body.recordings), 'recordings 必须是数组')
  assert.equal(typeof r.body.unsupportedCount, 'number', 'unsupportedCount 必须是数字')
  assert.equal(typeof r.body.total, 'number')

  const hit = pickRecord(r.body.recordings, good)
  assert.ok(hit, '有录音的会议目录必须出现在列表里')
  assert.equal(hit.kind, 'meeting', '会议录音的 kind 是 meeting')
  assert.ok(Math.abs(Number(hit.seconds) - 3) <= 0.3, '3 秒 WAV 的 seconds 应约为 3，实际 ' + hit.seconds)
  assert.equal(Number(hit.bytes), wavBytes, 'bytes 必须是 audio.wav 的真实大小')
  assert.equal(hit.hasTranscript, false, '没转写不能写成有转写')
  assert.equal(hit.hasMinutes, false)

  const noHit = pickRecord(r.body.recordings, noAudio)
  assert.ok(noHit, '没有音频的记录也要列出来（用户才看得到、删得掉）')
  assert.equal(noHit.hasAudio, false, '没有音频时 hasAudio 必须为 false')
  assert.equal(noHit.reason, 'no-capture', '要带出原因（0 字节采集）')
  assert.match(String(noHit.hint || ''), /./, '不能整理要给下一步 hint')
  assert.equal(noHit.hasMinutes, true, '只有纪要的目录，hasMinutes 必须为真')
  assert.ok(r.body.unsupportedCount >= 1, '没有可用录音的目录应计入 unsupportedCount，实际 ' + r.body.unsupportedCount)
  // 隔离：列表里的目录全部在本测试数据根内
  for (const rec of r.body.recordings) assert.ok(norm(rec.dir).startsWith(norm(DATA_DIR)))
})

test('POST /import-recording：自造 3 秒 WAV → ok/queued/dir，落盘 audio.wav + meta.source=import', async (t) => {
  if (!hasRoute('import-recording')) return t.skip("实现未落地: index.js 没有 sub === 'import-recording' 路由")
  const srcDir = join(fakeHome, 'src-wavs')
  mkdirSync(srcDir, { recursive: true })
  const src = join(srcDir, 'tone-3s.wav')
  const wavBytes = makeWav({ seconds: 3 })
  writeFileSync(src, wavBytes)

  const r = await call('POST', '/api/soulmirror/import-recording', { path: src })
  assert.equal(r.status, 200)
  assert.equal(r.body.ok, true, '导入合法 WAV 必须成功，实际 ' + JSON.stringify(r.body))
  assert.ok(r.body.dir && typeof r.body.dir === 'string', '成功要返回 dir')
  assert.ok(existsSync(r.body.dir), '返回的 dir 必须真实存在')
  assert.equal(typeof r.body.queued, 'boolean', 'queued 必须是布尔（不能是 undefined 让前端猜）')
  assert.ok(Math.abs(Number(r.body.seconds) - 3) <= 0.3, 'seconds 应约为 3，实际 ' + r.body.seconds)
  assert.equal(Number(r.body.bytes), wavBytes.length, 'bytes 必须等于源文件大小')

  const audio = join(r.body.dir, 'audio.wav')
  assert.ok(existsSync(audio), '导入后必须在新目录里生成 audio.wav')
  assert.equal(statSync(audio).size, wavBytes.length, 'audio.wav 应等于源文件（同格式时不做有损重编码）')
  assert.deepEqual(readFileSync(audio), wavBytes, 'audio.wav 内容必须与源文件一致')

  const meta = JSON.parse(readFileSync(join(r.body.dir, 'meta.json'), 'utf8').replace(/^\uFEFF/, ''))
  assert.equal(meta.source, 'import', 'meta.json 必须标记 source=import')
  assert.equal(norm(meta.originalPath), norm(src), 'meta 要记下原始路径，事后可追查')
  assert.ok(meta.startedAt && meta.endedAt, '导入的会议也要有起止时间（列表排序依赖它）')
  assert.ok(meta.capture && meta.capture.bytes === wavBytes.length, 'capture.bytes 要写真实字节数')
})

test('POST /import-recording：裸 PCM（16k/16bit 单声道）也能导入并封装成 WAV', async (t) => {
  if (!hasRoute('import-recording')) return t.skip("实现未落地: import-recording 路由不存在")
  const srcDir = join(fakeHome, 'src-wavs')
  mkdirSync(srcDir, { recursive: true })
  const src = join(srcDir, 'capture-3s.pcm')
  const pcm = makePcm({ seconds: 3 })
  writeFileSync(src, pcm)

  const r = await call('POST', '/api/soulmirror/import-recording', { path: src })
  assert.equal(r.body.ok, true, '裸 PCM 应当被接受（按 16k 处理）：' + JSON.stringify(r.body))
  assert.equal(Number(r.body.bytes), pcm.length, 'PCM 的 bytes 是 data 区字节数')
  assert.ok(Math.abs(Number(r.body.seconds) - 3) <= 0.3)
  const audio = join(r.body.dir, 'audio.wav')
  assert.ok(existsSync(audio), 'PCM 导入后也要生成 audio.wav')
  assert.equal(statSync(audio).size, 44 + pcm.length, 'WAV = 44 字节头 + PCM')
  const head = readFileSync(audio)
  assert.equal(head.toString('ascii', 0, 4), 'RIFF')
  assert.equal(head.readUInt32LE(24), 16000, '封装头必须是 16k')
  assert.equal(head.readUInt16LE(34), 16, '封装头必须是 16bit')
  assert.equal(head.readUInt16LE(22), 1, '封装头必须是单声道')
})

test('GET /recordings 能看到刚导入的那一场（kind=import，带原始路径）', async (t) => {
  if (!hasRoute('recordings') || !hasRoute('import-recording')) return t.skip('实现未落地: recordings/import-recording 路由不全')
  const srcDir = join(fakeHome, 'src-wavs')
  mkdirSync(srcDir, { recursive: true })
  const src = join(srcDir, 'tone-2s.wav')
  writeFileSync(src, makeWav({ seconds: 2 }))
  const imp = await call('POST', '/api/soulmirror/import-recording', { path: src })
  assert.equal(imp.body.ok, true, '导入应当成功：' + JSON.stringify(imp.body))

  const list = await call('GET', '/api/soulmirror/recordings')
  const hit = pickRecord(list.body.recordings, imp.body.dir)
  assert.ok(hit, '导入后 GET /recordings 必须能看到它')
  assert.equal(hit.kind, 'import', '导入的录音 kind 必须是 import')
  assert.equal(norm(hit.originalPath), norm(src), '列表要把原始路径带出来')
})

test('用已有录音重新整理 {recordDir}：不新建目录、直接入队', async (t) => {
  if (!hasRoute('import-recording')) return t.skip('实现未落地: import-recording 路由不存在')
  const dir = makeRecordDir(DATA_DIR, { withWav: true, meta: { title: 'reorganize' } })
  const r = await call('POST', '/api/soulmirror/import-recording', { recordDir: dir })
  assert.equal(r.body.ok, true, '有录音的目录应当能重新整理：' + JSON.stringify(r.body))
  assert.equal(norm(r.body.dir), norm(dir), '不能新建目录，必须还是这一场')
  assert.ok(Math.abs(Number(r.body.seconds) - 3) <= 0.3)
  assert.ok(readdirSync(DATA_DIR).filter((n) => n.includes('-import')).length >= 0)
})

test('导入失败原因：不存在的路径 → not-found', async (t) => {
  if (!hasRoute('import-recording')) return t.skip('实现未落地: import-recording 路由不存在')
  const r = await call('POST', '/api/soulmirror/import-recording', { path: join(fakeHome, 'nope', 'missing.wav') })
  assert.equal(r.body.ok, false)
  assert.equal(r.body.reason, 'not-found')
  assert.ok(String(r.body.message || '').length > 0, '失败必须给人话 message')
  assert.ok(String(r.body.hint || '').length > 0, '失败要给下一步动作（hint）')
})

test('导入失败原因：目录 → not-a-file', async (t) => {
  if (!hasRoute('import-recording')) return t.skip('实现未落地: import-recording 路由不存在')
  const dir = join(fakeHome, 'a-directory')
  mkdirSync(dir, { recursive: true })
  const r = await call('POST', '/api/soulmirror/import-recording', { path: dir })
  assert.equal(r.body.ok, false)
  assert.equal(r.body.reason, 'not-a-file')
  assert.ok(String(r.body.message || '').length > 0)
  assert.ok(String(r.body.hint || '').length > 0)
})

test('导入失败原因：.mp3 → unsupported-format（附 ffmpeg 文案，不自动转码）', async (t) => {
  if (!hasRoute('import-recording')) return t.skip('实现未落地: import-recording 路由不存在')
  const srcDir = join(fakeHome, 'src-wavs')
  mkdirSync(srcDir, { recursive: true })
  const mp3 = join(srcDir, 'sample.mp3')
  writeFileSync(mp3, Buffer.from('ID3\u0003 fake mp3 payload'))
  const r = await call('POST', '/api/soulmirror/import-recording', { path: mp3 })
  assert.equal(r.body.ok, false)
  assert.equal(r.body.reason, 'unsupported-format')
  assert.match(String(r.body.hint || ''), /ffmpeg/, '不支持格式要给出可复制的 ffmpeg 命令（但不执行）')
})

test('导入失败原因：48k/立体声 WAV → bad-format（不静默重采样）', async (t) => {
  if (!hasRoute('import-recording')) return t.skip('实现未落地: import-recording 路由不存在')
  const srcDir = join(fakeHome, 'src-wavs')
  mkdirSync(srcDir, { recursive: true })
  const wrong = join(srcDir, '48k-stereo.wav')
  writeFileSync(wrong, makeWav({ seconds: 1, sampleRate: 48000, channels: 2 }))
  const r = await call('POST', '/api/soulmirror/import-recording', { path: wrong })
  assert.equal(r.body.ok, false, '不可用格式必须显式拒绝：' + JSON.stringify(r.body))
  assert.equal(r.body.reason, 'bad-format')
  assert.match(String(r.body.message || ''), /48000 Hz|2 通道/, '要告诉用户源格式是什么')
})

test('导入失败原因：0 字节文件 → no-audio', async (t) => {
  if (!hasRoute('import-recording')) return t.skip('实现未落地: import-recording 路由不存在')
  const srcDir = join(fakeHome, 'src-wavs')
  mkdirSync(srcDir, { recursive: true })
  const empty = join(srcDir, 'empty.wav')
  writeFileSync(empty, '')
  const r = await call('POST', '/api/soulmirror/import-recording', { path: empty })
  assert.equal(r.body.ok, false)
  assert.equal(r.body.reason, 'no-audio')
})

test('导入失败原因：超过 2 GiB → too-large（稀疏文件，不占真实磁盘）', async (t) => {
  if (!hasRoute('import-recording')) return t.skip('实现未落地: import-recording 路由不存在')
  const max = REC && REC.MAX_IMPORT_BYTES
  if (!(typeof max === 'number' && max > 0)) return t.skip('实现未落地: 取不到 MAX_IMPORT_BYTES 上限常量')
  const srcDir = join(fakeHome, 'src-wavs')
  mkdirSync(srcDir, { recursive: true })
  const big = join(srcDir, 'too-big.wav')
  writeFileSync(big, '')
  truncateSync(big, max + 1)          // NTFS 上只是元数据，不写数据
  assert.ok(lstatSync(big).size > max)
  try {
    const r = await call('POST', '/api/soulmirror/import-recording', { path: big })
    assert.equal(r.body.ok, false, '超限文件必须在上限处拒绝')
    assert.equal(r.body.reason, 'too-large')
    assert.match(String(r.body.message || ''), /2|太大|GiB/)
  } finally {
    rmSync(big, { force: true })      // 立刻回收，不等进程结束
  }
})

test('「用录音重新整理」三类无音频：no-capture / no-audio-file / silent 都带 hint，且都不排队', async (t) => {
  if (!hasRoute('offline') || !(REC && typeof REC.classifyNoAudio === 'function')) {
    return t.skip('实现未落地: /offline 还没有接入 classifyNoAudio 三类区分')
  }
  // no-capture：meta.capture.bytes === 0
  const noCapture = makeRecordDir(DATA_DIR, {
    meta: { title: 'no-capture', startedAt: '2026-01-12T01:00:00Z', endedAt: '2026-01-12T01:05:00Z', capture: { bytes: 0, silentSec: 0, durationSec: 300, silentRatio: 1 } },
  })
  // no-audio-file：没有 wav 也没有有效 pcm，meta 也没有 capture 记录
  const noFile = makeRecordDir(DATA_DIR, {
    meta: { title: 'no-audio-file', startedAt: '2026-01-12T02:00:00Z', endedAt: '2026-01-12T02:05:00Z' },
  })
  // silent：有音频文件，但整场几乎没有声音
  const silent = makeRecordDir(DATA_DIR, {
    wav: makeWav({ seconds: 3, silent: true }),
    meta: { title: 'silent', startedAt: '2026-01-12T03:00:00Z', endedAt: '2026-01-12T03:05:00Z', capture: { bytes: 96044, silentSec: 3, durationSec: 3, silentRatio: 0.99 } },
  })

  for (const [dir, expected] of [[noCapture, 'no-capture'], [noFile, 'no-audio-file'], [silent, 'silent']]) {
    const r = await call('POST', '/api/soulmirror/offline', { dir })
    assert.equal(r.body.ok, false, expected + ' 目录不该被排队整理，实际 ' + JSON.stringify(r.body))
    assert.equal(r.body.reason, expected, '目录 ' + basename(dir) + ' 的 reason 应是 ' + expected + '，实际 ' + JSON.stringify(r.body.reason))
    assert.ok(String(r.body.hint || '').trim().length > 0, expected + ' 必须带非空 hint，界面据此告诉用户下一步')
    assert.ok(r.body.queued === undefined || r.body.queued === false, expected + ' 不能进入整理队列')
  }
})

test('POST /records/delete：二次确认、只删会议根的直接子目录、越界拒绝、日志留痕', async (t) => {
  if (!hasRoute('records/delete')) return t.skip("实现未落地: index.js 没有 sub === 'records/delete' 路由")
  const inside = makeRecordDir(DATA_DIR, { meta: { title: 'to-delete', capture: { bytes: 0 } } })
  const outside = join(fakeHome, 'outside-record')
  mkdirSync(outside, { recursive: true })
  writeFileSync(join(outside, 'audio.wav'), makeWav({ seconds: 1 }))

  // ① 没有 confirm → 接口层也拒绝（不能靠"前端记得再问一次"）
  const noConfirm = await call('POST', '/api/soulmirror/records/delete', { dir: inside })
  assert.equal(noConfirm.body.ok, false, '不带 confirm 的删除请求必须被拒绝')
  assert.equal(noConfirm.body.reason, 'confirm-required')
  assert.ok(existsSync(inside), '没确认就不能真删')

  // ② 根之外：一律不删（带 confirm 也一样）
  const denyOutside = await call('POST', '/api/soulmirror/records/delete', { dir: outside, confirm: true })
  assert.equal(denyOutside.body.ok, false, '不能删会议根之外的目录')
  assert.ok(existsSync(outside), '越界请求必须真的没删')

  // ③ 根目录本身：不能删
  const denyRoot = await call('POST', '/api/soulmirror/records/delete', { dir: DATA_DIR, confirm: true })
  assert.equal(denyRoot.body.ok, false, '不能把整个会议根删掉')
  assert.ok(existsSync(DATA_DIR))

  // ④ 正常：会议根的直接子目录 + 二次确认 → 删掉
  const ok = await call('POST', '/api/soulmirror/records/delete', { dir: inside, confirm: true })
  assert.equal(ok.body.ok, true, '直接子目录 + confirm 应当可删：' + JSON.stringify(ok.body))
  assert.ok(!existsSync(inside), '删除成功后目录必须消失')

  // ⑤ 留痕：journal 里要能追查删了什么（含当时的 capture）
  const journalFile = join(DATA_DIR, 'journal.jsonl')
  const logged = await waitFor(() => {
    try { return readFileSync(journalFile, 'utf8').includes(basename(inside)) } catch { return false }
  })
  assert.ok(logged, '删除必须写进 journal.jsonl（留痕要能指认被删的目录）')
  const text = readFileSync(journalFile, 'utf8')
  assert.match(text, /records\.delete/, 'journal 要有 records.delete 事件')
  assert.match(text, /capture/, '留痕要带上当时的采集信息（事后能查清为什么没音频）')
})

// ══ ④ 接线（源码事实）：顺序 / 不执行 shell / 前端分支 ═══════════════════
test('导入成功路径：先写 meta/audio，再 enqueue（顺序断言）', (t) => {
  if (!hasRoute('import-recording')) return t.skip('实现未落地: import-recording 路由不存在')
  const fnStart = HOST_SRC.indexOf('async function importRecordingFile')
  if (fnStart < 0) return t.skip("无法判定顺序: 找不到 importRecordingFile（可能改名/下沉），需人工确认")
  const metaAt = HOST_SRC.indexOf("source: 'import'", fnStart)
  const enqueueAt = HOST_SRC.indexOf('enqueue(', metaAt)
  assert.ok(metaAt > fnStart, '导入实现里必须写 meta 且带 source=import')
  assert.ok(enqueueAt > metaAt, 'enqueue 必须在 meta 之后：否则队列先跑、文件还没落盘')

  // 音频必须先落盘（同格式复制 / pcm 封装 / 非标准头重封装）
  const beforeMeta = HOST_SRC.slice(fnStart, metaAt)
  assert.match(beforeMeta, /audio\.wav/, '写 meta 之前必须已经把 audio.wav 落盘')
  assert.match(beforeMeta, /writeWavFromPcm|copyWavStream|wrapWavStream/,
    '音频落盘要走流式复制/封装（不能把整段音频读进内存）')
  // 失败回滚：半成品目录不能留下（否则下次扫描当成"没音频的会议"）
  const fnEnd = HOST_SRC.indexOf('async function reorganizeRecord', metaAt)
  const body = fnEnd > 0 ? HOST_SRC.slice(fnStart, fnEnd) : HOST_SRC.slice(fnStart, metaAt + 4000)
  assert.match(body, /rmSync\(dir/, '导入失败要回滚半成品目录')
})

test('导入/整理路由不执行 shell（不拼命令行、不 spawn 进程）', (t) => {
  if (!hasRoute('import-recording')) return t.skip('实现未落地: import-recording 路由不存在')
  const patterns = [/sub === 'import-recording'/, /async function importRecordingFile/, /async function reorganizeRecord/]
  let checked = 0
  for (const re of patterns) {
    const at = HOST_SRC.search(re)
    if (at < 0) continue
    checked += 1
    // 取到下一个路由/函数边界之间的一段，避免把文件里别处的 spawn 误算进来
    const slice = HOST_SRC.slice(at, at + 2500)
    assert.doesNotMatch(slice, /\bexecFile(Sync)?\b|\bspawn(Sync)?\b|\bexecSync\b|child_process/,
      '导入/整理链路不允许执行外部命令（会变成新的注入面）：' + re)
  }
  assert.ok(checked >= 2, '至少要能在源码里定位到导入路由与实现函数（实际 ' + checked + '）')
})

/** 录音卡的源码区域：从 RecordingsCard 定义开始（标题 h2 在页面别处，不能拿来当锚点） */
function cardRegion() {
  const at = CLIENT_SRC.indexOf('function RecordingsCard')
  if (at < 0) return ''
  return CLIENT_SRC.slice(at, at + 8000)
}

test('前端接线：有「之前的录音」卡、路径输入框、「导入并整理」，并请求新接口', (t) => {
  if (CLIENT_SRC.indexOf('之前的录音') < 0) return t.skip('实现未落地: client.js 里没有「之前的录音」')
  const region = cardRegion()
  assert.ok(region.length > 0, '找不到 RecordingsCard 组件')
  assert.match(region, /'之前的录音'/, '卡片标题要写「之前的录音」')
  assert.match(region, /导入并整理/, '卡片上要有「导入并整理」按钮')
  assert.match(region, /音频文件绝对路径/, '输入框要说明填的是本机文件的绝对路径')
  assert.match(region, /placeholder:/, '要有路径输入框')
  assert.match(region, /\/api\/soulmirror\/recordings/, '卡片要读 GET /recordings')
  assert.match(region, /\/api\/soulmirror\/import-recording/, '按钮要打 POST /import-recording')
  assert.match(region, /unsupportedCount/, '界面要用宿主给的 unsupportedCount')
  assert.match(region, /条没音频/, '没音频的记录要在卡片上说清"还有几条"，不能装作没有')
  assert.match(region, /silentCount/, '整场静音的场次也要单列')
  assert.match(region, /16k \/ 16bit \/ 单声道/, '要写清支持的格式（用户不该靠猜）')
  assert.match(region, /ffmpeg/, '不支持格式要给出 ffmpeg 文案')
  // 导入口和"整理旧记录"用同一个接口，但两者的语义不能混：path 是导入、recordDir 是重整
  assert.match(region, /{ path: p }/, '导入传 path')
  assert.match(region, /{ recordDir: rec\.dir }/, '旧记录传 recordDir（不能当新文件再导入一份）')
  assert.match(region, /正在导入并整理/, '导入要立刻告诉用户已开始，不要静默')
})

test('前端：没有音频/静音的记录不给整理按钮，且把宿主的 message+hint 渲染出来', (t) => {
  if (CLIENT_SRC.indexOf('之前的录音') < 0) return t.skip('实现未落地: client.js 里没有「之前的录音」')
  const region = cardRegion()
  // 按钮条件必须来自宿主的磁盘事实 + reason，而不是前端自己猜
  assert.match(region, /canOrganize = !!rec\.hasAudio && !rec\.reason/, '按钮条件 = hasAudio && 没有 reason')
  assert.match(region, /canOrganize \? h\('button'/, '只有能整理的场次才渲染按钮')
  assert.match(region, /'没有音频'/, '没有音频的记录要有可见标记')
  assert.match(region, /不能整理：/, '不能整理的场次要明确说明')
  assert.match(region, /rec\.hint/, '要把宿主的 hint 渲染出来（下一步怎么办）')
  assert.match(region, /rec\.reason \? h\('div'/, 'reason 存在时只显示原因，不显示"转写并出纪要"')
  assert.match(region, /disabled: busy/, '提交中要禁用，避免重复入队')
  // 页面级「用录音重新整理」同样必须按宿主判定分支（v.recording.ok）
  assert.match(CLIENT_SRC, /v\.recording && !v\.recording\.ok \? h\(RecordingProblem/, '不能整理时要换成说明卡，而不是保留按钮')
  assert.match(CLIENT_SRC, /!v\.recording \|\| v\.recording\.ok\)[\s\S]{0,400}用录音重新整理/, '页面级重整按钮要以 v.recording.ok 为前提')
  assert.match(CLIENT_SRC, /function RecordingProblem/, '要有"为什么不能整理 + 怎么办"的说明组件')
})

test('前端删除：二次确认（confirm）之后才打 records/delete，并把 confirm 透传给接口', (t) => {
  if (!hasRoute('records/delete')) return t.skip("实现未落地: records/delete 路由不存在")
  const at = CLIENT_SRC.indexOf('function RecordingProblem')
  if (at < 0) return t.skip('实现未落地: 找不到 RecordingProblem 组件')
  const region = CLIENT_SRC.slice(at, at + 1800)
  assert.match(region, /rec\.reason === 'no-capture' \|\| rec\.reason === 'no-audio-file'/, '只有"空记录"才给删除入口')
  assert.match(region, /confirm\(tip\)/, '删除必须二次确认（用户点错不能直接删）')
  assert.match(region, /!confirm\(tip\)\) return/, '取消确认就必须真的不删')
  assert.match(region, /\/api\/soulmirror\/records\/delete/, '确认后才发删除请求')
  assert.match(region, /confirm: true/, '接口层也要求 confirm，前端必须把它带上（不能只靠 UI 拦）')
  assert.match(region, /不可恢复/, '确认文案要说清后果')
})
