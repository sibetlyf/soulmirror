import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/**
 * 录声纹时的朗读文本 + 体检里的声纹项。
 *
 * 为什么单独锁：
 *   · 朗读文本是用户唯一必读的界面文案。段太短会录不够 10 秒；太长用户读到一半
 *     就不耐烦；英文单词 / 长数字 / 绕口令会让人卡壳，反过来污染声纹。
 *   · 字数、时长、门槛都是"写死就容易漂移"的数字：门槛必须永远等于 quality.js 的
 *     注册门槛，服务端文案也只有一份（客户端不能复制副本）。
 *   · buildPreflight 是纯函数：它只判 env，不许读文件、更不许加载 ONNX 运行库
 *     （native DLL 一旦加载会被锁住，后续安装/升级就删不掉文件）。
 *
 * 约束：不 import 重型依赖，不录音、不联网；源码路径全部按本文件位置拼接。
 */

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = dirname(HERE)
const READ_ALOUD = join(ROOT, 'lib', 'voiceprint', 'read-aloud.js')
const QUALITY = join(ROOT, 'lib', 'voiceprint', 'quality.js')
const INDEX = join(ROOT, 'index.js')
const CLIENT = join(ROOT, 'lib', 'client.js')
const PREFLIGHT = join(ROOT, 'lib', 'preflight.js')

const HAN = /[\u4e00-\u9fff]/g
const hanCount = (text) => (String(text == null ? '' : text).match(HAN) || []).length
const passageText = (p) => (typeof p === 'string' ? p : String((p && p.text) || ''))
const passageId = (p, i) => (p && typeof p === 'object' && p.id ? String(p.id) : '#' + (i + 1))

/** 读文本；文件不存在返回 null（用于把"实现未落地"变成跳过而不是假红） */
function readSource(file) {
  return existsSync(file) ? readFileSync(file, 'utf8') : null
}

let READ = null
let READ_ERROR = null
try {
  READ = existsSync(READ_ALOUD) ? await import(pathToFileURL(READ_ALOUD).href) : null
} catch (e) {
  READ_ERROR = e
}

/** 每次换一个 URL query，拿到全新的模块实例（pickPassage 用模块级 lastPickId 排除上一次） */
let freshSeq = 0
async function freshReadAloud() {
  const url = pathToFileURL(READ_ALOUD).href + '?fresh=' + (++freshSeq)
  return import(url)
}

function needRead(t) {
  if (!READ) {
    t.skip('实现未落地：lib/voiceprint/read-aloud.js 不存在')
    return null
  }
  if (READ_ERROR) throw READ_ERROR
  return READ
}

/** 从签名起按大括号配对截出一个函数段（源码事实断言只看这一段）。
 *  先跨过参数表：`function f({ a = {} } = {}) {` 的第一个 `{` 是解构参数，不是函数体。
 */
function functionSource(src, signature) {
  const start = src.indexOf(signature)
  if (start < 0) return ''
  let bodyOpen = -1
  const paren = src.indexOf('(', start)
  if (paren >= 0) {
    let pd = 0
    for (let i = paren; i < src.length; i++) {
      const ch = src[i]
      if (ch === '(') pd++
      else if (ch === ')') {
        pd--
        if (pd === 0) {
          bodyOpen = src.indexOf('{', i)
          break
        }
      }
    }
  }
  if (bodyOpen < 0) bodyOpen = src.indexOf('{', start)
  if (bodyOpen < 0) return src.slice(start, start + 4000)
  let depth = 0
  for (let i = bodyOpen; i < src.length; i++) {
    const ch = src[i]
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return src.slice(start, i + 1)
    }
  }
  return src.slice(start)
}

/** 只去掉注释，保留代码，用来区分"注释里解释不要加载 native"和"真的调用了" */
function stripComments(js) {
  return String(js || '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

/** 从路由标记截到下一个 if (sub === ...)，避免把整个 index.js 当证据 */
function routeBlock(src, marker) {
  const start = src.indexOf(marker)
  if (start < 0) return ''
  const next = src.indexOf('if (sub ===', start + marker.length)
  return src.slice(start, next < 0 ? Math.min(src.length, start + 5000) : next)
}

// ---------------------------------------------------------------------------
// 1. 朗读文本质量（用户核心要求，必须逐段验）
// ---------------------------------------------------------------------------

test('read-aloud：导出 PASSAGES / pickPassage / MIN_READ_SECONDS / estimateSeconds，且 PASSAGES ≥ 8 段', (t) => {
  const m = needRead(t)
  if (!m) return
  assert.equal(typeof m.estimateSeconds, 'function', '必须导出 estimateSeconds')
  assert.equal(typeof m.pickPassage, 'function', '必须导出 pickPassage')
  assert.equal(typeof m.MIN_READ_SECONDS, 'number', '必须导出数字 MIN_READ_SECONDS')
  assert.ok(Array.isArray(m.PASSAGES), 'PASSAGES 必须是数组')
  assert.ok(m.PASSAGES.length >= 8, '至少 8 段朗读文本，实际 ' + m.PASSAGES.length)
  for (const [i, p] of m.PASSAGES.entries()) {
    const text = passageText(p)
    assert.ok(text.length > 0, '第 ' + (i + 1) + ' 段没有 text')
  }
  assert.equal(m.estimateSeconds(''), 0, '空文本应估 0 秒')
})

test('read-aloud：每段汉字数 70~MAX_CHARS（上限常量 ≤ 100，标点不算）', (t) => {
  const m = needRead(t)
  if (!m) return
  const maxChars = typeof m.MAX_CHARS === 'number' ? m.MAX_CHARS : 100
  const bad = []
  const rows = []
  for (const [i, p] of m.PASSAGES.entries()) {
    const text = passageText(p)
    const n = hanCount(text)
    rows.push('#' + (i + 1) + ' ' + passageId(p, i) + ' ' + n + ' 汉字')
    if (n < 70) bad.push('#' + (i + 1) + ' ' + passageId(p, i) + '：' + n + ' 汉字 < 70（读不满 10 秒）')
    if (n > maxChars) bad.push('#' + (i + 1) + ' ' + passageId(p, i) + '：' + n + ' 汉字 > ' + maxChars + '（太长，用户会读烦）')
  }
  assert.deepEqual(bad, [], '每段必须 70~' + maxChars + ' 个汉字，不合格：\n' + bad.join('\n') + '\n全部：\n' + rows.join('\n'))
})

test('read-aloud：10 秒 ≤ 每段估算时长 ≤ MAX_ESTIMATE_SECONDS（上限常量 ≤ 25，按实现的字/秒系数）', (t) => {
  const m = needRead(t)
  if (!m) return
  const maxSeconds = typeof m.MAX_ESTIMATE_SECONDS === 'number' ? m.MAX_ESTIMATE_SECONDS : 25
  assert.equal(typeof m.estimateSeconds, 'function')
  const bad = []
  const rows = []
  for (const [i, p] of m.PASSAGES.entries()) {
    const text = passageText(p)
    const est = m.estimateSeconds(text)
    rows.push('#' + (i + 1) + ' ' + passageId(p, i) + ' chars=' + hanCount(text) + ' est=' + est + 's')
    if (!Number.isFinite(est)) bad.push('#' + (i + 1) + ' estimateSeconds 不是数字：' + String(est))
    else if (est < 10) bad.push('#' + (i + 1) + ' ' + passageId(p, i) + '：估算 ' + est + ' 秒 < 10 秒，用户读完仍可能不够注册门槛')
    else if (est > maxSeconds) bad.push('#' + (i + 1) + ' ' + passageId(p, i) + '：估算 ' + est + ' 秒 > ' + maxSeconds + ' 秒（太长，用户会读烦）')
  }
  assert.deepEqual(bad, [], '每段必须 ' + 10 + '~' + maxSeconds + ' 秒：\n' + bad.join('\n') + '\n全部：\n' + rows.join('\n'))
})

test('read-aloud：MAX_CHARS ≤ 100、MAX_ESTIMATE_SECONDS ≤ 25，且两个上限互相自洽（防偷偷放宽）', (t) => {
  const m = needRead(t)
  if (!m) return
  if (typeof m.MAX_CHARS !== 'number' || typeof m.MAX_ESTIMATE_SECONDS !== 'number') {
    t.skip('实现未落地：MAX_CHARS / MAX_ESTIMATE_SECONDS 尚未导出')
    return
  }
  assert.ok(m.MAX_CHARS >= 70, 'MAX_CHARS=' + m.MAX_CHARS + '，低于 70 就违背"每段至少 70 汉字"')
  assert.ok(m.MAX_CHARS <= 100, 'MAX_CHARS=' + m.MAX_CHARS + ' > 100：上限被放宽了（目标 ~85）')
  assert.ok(m.MAX_ESTIMATE_SECONDS >= 10, 'MAX_ESTIMATE_SECONDS=' + m.MAX_ESTIMATE_SECONDS + ' < 10，低于注册门槛')
  assert.ok(m.MAX_ESTIMATE_SECONDS <= 25, 'MAX_ESTIMATE_SECONDS=' + m.MAX_ESTIMATE_SECONDS + ' > 25：上限被放宽了')
  // 两个常量必须用实现自己的字/秒系数自洽：写满 MAX_CHARS 个汉字也不得超过 MAX_ESTIMATE_SECONDS
  const atCap = m.estimateSeconds('字'.repeat(m.MAX_CHARS))
  assert.ok(
    atCap <= m.MAX_ESTIMATE_SECONDS,
    'MAX_CHARS=' + m.MAX_CHARS + ' 个汉字按实现估算要 ' + atCap + ' 秒，超过 MAX_ESTIMATE_SECONDS=' + m.MAX_ESTIMATE_SECONDS,
  )
})

test('read-aloud：注释引用上限常量，不再出现与常量冲突的硬编码数字（70~95 / 20 秒）', (t) => {
  const src = readSource(READ_ALOUD)
  if (!src) {
    t.skip('实现未落地：lib/voiceprint/read-aloud.js 不存在')
    return
    }
  const m = needRead(t)
  if (!m) return
  if (typeof m.MAX_CHARS !== 'number' || typeof m.MAX_ESTIMATE_SECONDS !== 'number') {
    t.skip('实现未落地：MAX_CHARS / MAX_ESTIMATE_SECONDS 尚未导出，注释一致性无从校验')
    return
  }
  const comments = (src.match(/\/\*[\s\S]*?\*\//g) || []).join('\n') + '\n' + (src.match(/(^|\n)\s*\/\/[^\n]*/g) || []).join('\n')
  assert.match(comments, /MAX_CHARS/, '注释必须引用 MAX_CHARS（写死数字迟早和常量漂移）')
  assert.match(comments, /MAX_ESTIMATE_SECONDS/, '注释必须引用 MAX_ESTIMATE_SECONDS')
  const stale = []
  if (/70\s*[~～\-]\s*95|95\s*个汉字/.test(comments)) stale.push('注释仍写 70~95 个汉字，与 MAX_CHARS=' + m.MAX_CHARS + ' 冲突')
  if (/(长到|超过|多于|以上)[^。\n]{0,8}20\s*秒|20\s*秒以上/.test(comments)) stale.push('注释仍写"不超过 20 秒"，与 MAX_ESTIMATE_SECONDS=' + m.MAX_ESTIMATE_SECONDS + ' 冲突')
  assert.deepEqual(stale, [], stale.join('\n'))
})

test('read-aloud：不含英文单词、不含 4 位以上数字串（会让人卡壳）', (t) => {
  const m = needRead(t)
  if (!m) return
  const bad = []
  for (const [i, p] of m.PASSAGES.entries()) {
    const text = passageText(p)
    const label = '#' + (i + 1) + ' ' + passageId(p, i)
    if (/[A-Za-z]{2,}/.test(text)) bad.push(label + '：含英文单词 ' + (text.match(/[A-Za-z]{2,}/) || [])[0])
    if (/\d{4,}/.test(text)) bad.push(label + '：含长数字串 ' + (text.match(/\d{4,}/) || [])[0])
  }
  assert.deepEqual(bad, [], '朗读文本不能含英文单词或长数字串：\n' + bad.join('\n'))
})

test('read-aloud：不是绕口令式重复（同一 4 字片段不重复 ≥ 3 次）', (t) => {
  const m = needRead(t)
  if (!m) return
  const bad = []
  for (const [i, p] of m.PASSAGES.entries()) {
    const text = passageText(p)
    const han = text.replace(/[^\u4e00-\u9fff]/g, '')
    const counts = new Map()
    for (let j = 0; j + 4 <= han.length; j++) {
      const gram = han.slice(j, j + 4)
      counts.set(gram, (counts.get(gram) || 0) + 1)
    }
    for (const [gram, n] of counts) {
      if (n >= 3) bad.push('#' + (i + 1) + ' ' + passageId(p, i) + '：片段「' + gram + '」出现 ' + n + ' 次')
    }
  }
  assert.deepEqual(bad, [], '朗读文本不能是绕口令式重复：\n' + bad.join('\n'))
})

test('read-aloud：每段含标点（逗号/句号/分号）便于自然停顿', (t) => {
  const m = needRead(t)
  if (!m) return
  const bad = []
  for (const [i, p] of m.PASSAGES.entries()) {
    const text = passageText(p)
    if (!/[,，。；]/.test(text)) bad.push('#' + (i + 1) + ' ' + passageId(p, i) + '：没有任何停顿标点')
  }
  assert.deepEqual(bad, [], '每段都要有标点停顿：\n' + bad.join('\n'))
})

test('read-aloud：各段文本互不相同（不能只是换个 id 的副本）', (t) => {
  const m = needRead(t)
  if (!m) return
  const seen = new Map()
  const dup = []
  for (const [i, p] of m.PASSAGES.entries()) {
    const text = passageText(p)
    if (seen.has(text)) dup.push('#' + (i + 1) + ' 与 #' + (seen.get(text) + 1) + ' 文本相同')
    else seen.set(text, i)
  }
  assert.deepEqual(dup, [], '朗读文本必须各不相同：\n' + dup.join('\n'))
  assert.equal(seen.size, m.PASSAGES.length)
})

// ---------------------------------------------------------------------------
// 2. 随机挑选（用注入的假随机函数覆盖边界）
// ---------------------------------------------------------------------------

test('pickPassage：rand=0 取第一段，rand≈1 取最后一段（含 rand=1 越界）', async (t) => {
  if (!existsSync(READ_ALOUD)) {
    t.skip('实现未落地：lib/voiceprint/read-aloud.js 不存在')
    return
  }
  const m = await freshReadAloud()
  const first = m.pickPassage(() => 0)
  assert.equal(first.id, passageId(m.PASSAGES[0], 0), 'rand=0 必须取第一段')
  assert.equal(first.text, passageText(m.PASSAGES[0]))
  const last = m.pickPassage(() => 0.999999)
  const lastIndex = m.PASSAGES.length - 1
  assert.equal(last.id, passageId(m.PASSAGES[lastIndex], lastIndex), 'rand≈1 必须取最后一段')
  assert.equal(last.text, passageText(m.PASSAGES[lastIndex]))

  // rand 返回 1（理论上越界）也要夹到最后一类，不能出现 undefined/null
  const m2 = await freshReadAloud()
  const edge = m2.pickPassage(() => 1)
  assert.ok(edge && edge.text, 'rand=1 不能返回空')
  assert.equal(edge.id, passageId(m2.PASSAGES[lastIndex], lastIndex), 'rand=1 应夹到最后一段')
})

test('pickPassage：连续两次不重复（排除上一次语义）', async (t) => {
  if (!existsSync(READ_ALOUD)) {
    t.skip('实现未落地：lib/voiceprint/read-aloud.js 不存在')
    return
  }
  const m = await freshReadAloud()
  // 固定同一个 rand：两次都会命中同一索引，第二次必须排除上一次
  const a = m.pickPassage(() => 0.5)
  const b = m.pickPassage(() => 0.5)
  assert.notEqual(a.id, b.id, '同一 rand 连续两次不能返回同一段（实现记录了上一次的 id）')

  // 不同 rand 的结果本来就该不同；这里用 0.2 / 0.3 验证不会钉死在同一段
  const m2 = await freshReadAloud()
  const c = m2.pickPassage(() => 0.2)
  const d = m2.pickPassage(() => 0.3)
  assert.notEqual(c.id, d.id, '不同 rand（0.2 / 0.3）应落到不同段')
})

test('pickPassage：返回结构含 id/text/chars/estimateSeconds，chars 等于实际汉字数', async (t) => {
  if (!existsSync(READ_ALOUD)) {
    t.skip('实现未落地：lib/voiceprint/read-aloud.js 不存在')
    return
  }
  const m = await freshReadAloud()
  const r = m.pickPassage(() => 0.42)
  assert.equal(typeof r, 'object', 'pickPassage 必须返回对象')
  assert.equal(typeof r.id, 'string', '必须含字符串 id')
  assert.ok(r.id.length > 0)
  assert.equal(typeof r.text, 'string', '必须含字符串 text')
  const known = m.PASSAGES.find((p) => passageId(p, 0) === r.id)
  assert.ok(known, '返回的 id 必须来自 PASSAGES')
  assert.equal(r.text, passageText(known), '返回的 text 必须与 PASSAGES 对应')
  assert.equal(typeof r.chars, 'number', '必须含数字 chars')
  assert.equal(r.chars, hanCount(r.text), 'chars 必须等于 text 的实际汉字数')
  assert.equal(typeof r.estimateSeconds, 'number', '必须含数字 estimateSeconds')
  assert.equal(r.estimateSeconds, m.estimateSeconds(r.text), 'estimateSeconds 必须由 text 计算，不能手写死数字')
})

// ---------------------------------------------------------------------------
// 3. 门槛一致性（回归锁：两处门槛不能漂移）
// ---------------------------------------------------------------------------

test('MIN_READ_SECONDS 必须等于 quality.js 的 MIN_SAMPLE_SPEECH_SECONDS（防两处门槛漂移）', async (t) => {
  if (!existsSync(READ_ALOUD)) {
    t.skip('实现未落地：lib/voiceprint/read-aloud.js 不存在')
    return
  }
  const m = await import(pathToFileURL(READ_ALOUD).href + '?gate=1')
  const q = await import(pathToFileURL(QUALITY).href)
  assert.equal(typeof q.MIN_SAMPLE_SPEECH_SECONDS, 'number', 'quality.js 必须导出数字门槛')
  assert.equal(
    m.MIN_READ_SECONDS,
    q.MIN_SAMPLE_SPEECH_SECONDS,
    '朗读门槛（' + m.MIN_READ_SECONDS + 's）必须与注册样本门槛（' + q.MIN_SAMPLE_SPEECH_SECONDS + 's）一致，否则用户读够了仍会被拒',
  )
})

// ---------------------------------------------------------------------------
// 4. 接线（源码事实断言）
// ---------------------------------------------------------------------------

test('接线：GET /voiceprint 返回 readAloud{minSeconds, passages}', (t) => {
  const src = readSource(INDEX)
  if (!src) {
    t.skip('index.js 不可读')
    return
  }
  const block = routeBlock(src, "sub === 'voiceprint' && req.method === 'GET'")
  assert.ok(block, '找不到 GET /voiceprint 路由')
  if (!block.includes('readAloud')) {
    t.skip('实现未落地：GET /voiceprint 还没有返回 readAloud')
    return
  }
  assert.match(block, /readAloud\s*:/, '返回体必须是 readAloud 字段')
  assert.match(block, /minSeconds/, 'readAloud 必须带 minSeconds')
  assert.match(block, /passages/, 'readAloud 必须带 passages')
})

test('接线：readAloud.passages 来自 read-aloud.js 的导出，不是硬编码副本', async (t) => {
  const src = readSource(INDEX)
  if (!src) {
    t.skip('index.js 不可读')
    return
  }
  if (!src.includes('readAloud')) {
    t.skip('实现未落地：index.js 还没有 readAloud')
    return
  }
  const block = routeBlock(src, "sub === 'voiceprint' && req.method === 'GET'")
  assert.ok(block.includes('readAloud'), 'GET /voiceprint 必须返回 readAloud')
  // 必须有从 read-aloud.js 的具名导入，且 readAloud 里用的是导出符号而不是字面量数组
  assert.match(
    src,
    /import\s*\{[^}]*\b(PASSAGES|listPassages|passageInfo|pickPassage|estimateSeconds|MIN_READ_SECONDS)\b[^}]*\}\s*from\s*'\.\/lib\/voiceprint\/read-aloud\.js'/,
    'index.js 必须从 ./lib/voiceprint/read-aloud.js 导入文案/函数',
  )
  const vp = block.slice(Math.max(0, block.indexOf('readAloud') - 120), block.indexOf('readAloud') + 800)
  assert.match(vp, /(PASSAGES|listPassages)/, 'readAloud.passages 必须由 read-aloud.js 的导出提供')
  // 客户端/宿主不能各存一份：index.js 里不应出现任何一段文案的原文（≥24 字足够判定复制）
  const m = await import(pathToFileURL(READ_ALOUD).href + '?copy=1')
  const copied = m.PASSAGES
    .map((p, i) => ({ i, text: passageText(p) }))
    .filter((x) => x.text.length >= 30 && src.includes(x.text.slice(0, 24)))
  assert.deepEqual(copied.map((x) => '#' + (x.i + 1)), [], 'index.js 不应硬编码朗读文案副本')
})

test('接线：VoiceprintCard 有「换一段」按钮', (t) => {
  const src = readSource(CLIENT)
  if (!src) {
    t.skip('lib/client.js 不可读')
    return
  }
  if (!src.includes('换一段')) {
    t.skip('实现未落地：VoiceprintCard 还没有「换一段」')
    return
  }
  const card = functionSource(src, 'function VoiceprintCard')
  assert.ok(card, '找不到 VoiceprintCard')
  assert.match(card, /换一段/, '「换一段」必须在 VoiceprintCard 里（不是别处）')
})

test('接线：VoiceprintCard 显示已录秒数，不足门槛时显式提示重录', (t) => {
  const src = readSource(CLIENT)
  if (!src) {
    t.skip('lib/client.js 不可读')
    return
  }
  if (!src.includes('换一段')) {
    t.skip('实现未落地：VoiceprintCard 还没有朗读文本接线')
    return
  }
  const card = functionSource(src, 'function VoiceprintCard')
  assert.ok(card)
  // 当前段落正文必须在卡片里渲染（服务端唯一一份文案）
  assert.match(card, /current\.text/, '必须渲染当前段落的正文（current.text）')
  // 已录秒数：必须用 elapsed（真实计时器）显示，而不是假进度
  assert.match(card, /已录 ' \+ elapsed \+ ' 秒/, '录音中必须显示真实已录秒数（已录 elapsed 秒）')
  // 不足门槛：录完要在客户端先判一次（不能等上传后靠后端拒绝），提示"再录一次"
  assert.match(card, /(recordedSec|elapsed)\s*<\s*minSeconds/, '必须用 minSeconds（服务端门槛）判"不够"')
  assert.match(card, /(不够|不足|再录|重录)[^\n]{0,80}(段|秒|一次)/, '不够时必须提示重录')
  // 门槛来自服务端 readAloud.minSeconds，不写死 10
  assert.match(card, /minSeconds\s*=.*readAloud.*minSeconds/, 'minSeconds 必须来自服务端 readAloud，不能写死')
})

// ---------------------------------------------------------------------------
// 5. 体检接入（真实 buildPreflight）
// ---------------------------------------------------------------------------

const healthyEnv = {
  platform: 'win32',
  bridgePresent: true,
  bridgeRuns: true,
  deviceCount: 3,
  deviceName: '扬声器 (Realtek)',
  meetingActive: true,
  asrProvider: 'dashscope',
  asrKey: 'sk-0123456789012345678901',
  asrKeySource: 'file',
}

/** 同时给出嵌套 voiceprint 对象和扁平字段，兼容实现采用的任一收集形状 */
function vpEnv(vp) {
  return {
    ...healthyEnv,
    voiceprint: vp,
    voiceprintEnabled: vp.enabled,
    voiceprintModelId: vp.modelId,
    voiceprintModelExists: vp.modelExists,
    voiceprintModelVerified: vp.modelVerified,
    voiceprintRuntimeInstalled: vp.runtimeInstalled,
    voiceprintRuntimeFilesOk: vp.runtimeFilesOk,
    voiceprintPeople: vp.people,
    voiceprintSamples: vp.samples,
  }
}

const VP_OFF = {
  enabled: false, modelId: 'wespeaker_zh_cnceleb_resnet34', modelExists: false, modelVerified: false,
  runtimeInstalled: false, runtimeFilesOk: false, people: 0, samples: 0,
}
const VP_MODEL_MISSING = {
  enabled: true, modelId: 'wespeaker_zh_cnceleb_resnet34', modelExists: false, modelVerified: false,
  runtimeInstalled: true, runtimeFilesOk: true, people: 0, samples: 0,
}
const VP_HASH_BAD = {
  enabled: true, modelId: 'wespeaker_zh_cnceleb_resnet34', modelExists: true, modelVerified: false,
  runtimeInstalled: true, runtimeFilesOk: true, people: 0, samples: 0,
}
const VP_RUNTIME_MISSING = {
  enabled: true, modelId: 'wespeaker_zh_cnceleb_resnet34', modelExists: true, modelVerified: true,
  runtimeInstalled: false, runtimeFilesOk: false, people: 0, samples: 0,
}
const VP_READY_EMPTY = {
  enabled: true, modelId: 'wespeaker_zh_cnceleb_resnet34', modelExists: true, modelVerified: true,
  runtimeInstalled: true, runtimeFilesOk: true, people: 0, samples: 0,
}
const VP_READY_SAMPLES = {
  enabled: true, modelId: 'wespeaker_zh_cnceleb_resnet34', modelExists: true, modelVerified: true,
  runtimeInstalled: true, runtimeFilesOk: true, people: 2, samples: 4,
}

let preflightMod = null
try {
  preflightMod = existsSync(PREFLIGHT) ? await import(pathToFileURL(PREFLIGHT).href) : null
} catch (e) {
  preflightMod = { __importError: e }
}

function requirePreflight(t) {
  if (!preflightMod) {
    t.skip('lib/preflight.js 不可读')
    return null
  }
  if (preflightMod.__importError) throw preflightMod.__importError
  return preflightMod
}

/** 体检结果里找声纹项；没有则返回 undefined（用于把实现未落地变成跳过） */
function voiceprintCheck(result) {
  const checks = (result && result.checks) || []
  return checks.find((c) => /voiceprint|声纹/i.test(String((c && (c.id || '')) + ' ' + (c && (c.label || '')))))
}

function voiceprintItemLevel(c) {
  return String((c && (c.level || c.status || '')) || '')
}

test('体检：buildPreflight 返回含 voiceprint 的条目', (t) => {
  const p = requirePreflight(t)
  if (!p) return
  const r = p.buildPreflight(vpEnv(VP_READY_SAMPLES))
  const c = voiceprintCheck(r)
  if (!c) {
    t.skip('实现未落地：buildPreflight 还没有 voiceprint 条目')
    return
  }
  assert.ok(c.id || c.key, '声纹项必须有 id/key')
  assert.ok('ok' in c || 'level' in c, '声纹项必须有 ok 或 level 判定字段')
})

test('体检：6 种声纹状态 → level 与关键词（关闭/model 缺失/哈希不符/运行库缺失/就绪无样本/就绪有样本）', (t) => {
  const p = requirePreflight(t)
  if (!p) return
  const probe = voiceprintCheck(p.buildPreflight(vpEnv(VP_READY_SAMPLES)))
  if (!probe) {
    t.skip('实现未落地：buildPreflight 还没有 voiceprint 条目')
    return
  }
  if (!probe.level) {
    t.skip('实现未落地：声纹项还没有 level 字段（当前只有 ok/fatal）')
    return
  }
  const cases = [
    {
      name: '关闭', env: VP_OFF, level: 'info',
      keywords: [/关闭|未开启|未启用|关着/],
      antiKeywords: [/安装/],
    },
    {
      name: '模型缺失', env: VP_MODEL_MISSING, level: 'warn',
      keywords: [/模型/],
      mustMention: [/安装|缺失|未安装|下载/],
    },
    {
      name: '哈希不符', env: VP_HASH_BAD, level: 'warn',
      keywords: [/校验|哈希|hash|verified|替换|损坏|截断/i],
      mustMention: [/重装|重新|安装|删/],
    },
    {
      name: '运行库缺失', env: VP_RUNTIME_MISSING, level: 'warn',
      keywords: [/运行库|onnxruntime|runtime/i],
      mustMention: [/安装|缺失|未安装/],
    },
    {
      name: '就绪无样本', env: VP_READY_EMPTY, level: 'info',
      keywords: [/样本|还没|没有|注册/],
    },
    {
      name: '就绪有样本', env: VP_READY_SAMPLES, level: 'ok',
      keywords: [/就绪|可用|已注册|正常/],
    },
  ]
  const bad = []
  for (const c of cases) {
    const r = p.buildPreflight(vpEnv(c.env))
    const item = voiceprintCheck(r)
    if (!item) { bad.push(c.name + '：没有 voiceprint 条目'); continue }
    const level = voiceprintItemLevel(item)
    if (level !== c.level) bad.push(c.name + '：level=' + (level || '(空)') + '，期望 ' + c.level)
    const text = [item.label, item.detail, item.message, item.verdict, item.hint, item.fix].filter(Boolean).join(' ')
    if (!c.keywords.some((re) => re.test(text))) bad.push(c.name + '：文案缺少关键词 ' + c.keywords.join(' / ') + '｜实际：' + text)
    if (c.mustMention && !c.mustMention.some((re) => re.test(text))) bad.push(c.name + '：fix/文案缺少可执行动作 ' + c.mustMention.join(' / ') + '｜实际：' + text)
    if (c.antiKeywords && c.antiKeywords.some((re) => re.test(text))) bad.push(c.name + '：关闭状态不应提示安装｜实际：' + text)
    // 整体 verdict 也要能看出声纹状态（info/ok 不改变可用性，warn 也不能崩）
    assert.equal(typeof r.verdict, 'string')
  }
  assert.deepEqual(bad, [], '声纹体检状态不符合预期：\n' + bad.join('\n'))
})

test('体检：每条 warn 的声纹项都带可执行 fix', (t) => {
  const p = requirePreflight(t)
  if (!p) return
  const probe = voiceprintCheck(p.buildPreflight(vpEnv(VP_READY_SAMPLES)))
  if (!probe) {
    t.skip('实现未落地：buildPreflight 还没有 voiceprint 条目')
    return
  }
  const warns = [VP_MODEL_MISSING, VP_HASH_BAD, VP_RUNTIME_MISSING]
  const bad = []
  for (const env of warns) {
    const item = voiceprintCheck(p.buildPreflight(vpEnv(env)))
    if (!item) { bad.push('缺少 voiceprint 条目'); continue }
    if (!/warn|warning/i.test(voiceprintItemLevel(item))) { bad.push('非 warn（' + (voiceprintItemLevel(item) || '(空)') + '）'); continue }
    const fix = String(item.fix || item.action || item.advice || '')
    if (fix.length < 4) bad.push((item.id || 'voiceprint') + '：warn 没有可执行 fix')
  }
  assert.deepEqual(bad, [], 'warn 必须有可执行 fix：\n' + bad.join('\n'))
})

test('体检：buildPreflight 是纯函数——源码不读文件/不加载模型，调用不改 env、不返回 Promise', (t) => {
  const p = requirePreflight(t)
  if (!p) return
  const src = readSource(PREFLIGHT)
  assert.ok(src, 'lib/preflight.js 可读')
  const fn = functionSource(src, 'export function buildPreflight') || functionSource(src, 'function buildPreflight')
  assert.ok(fn, '找不到 buildPreflight')
  assert.ok(fn.length > 800, 'buildPreflight 源码段过短（' + fn.length + ' 字符），切片被参数表截断了')
  const code = stripComments(fn)
  assert.doesNotMatch(code, /existsSync|readFileSync|readdirSync|statSync/, 'buildPreflight 不许读文件系统')
  assert.doesNotMatch(code, /\bInferenceSession\b|onnxruntime\b|createEmbedder\b/, 'buildPreflight 不许加载 native 模型/运行库')
  const probe = p.buildPreflight(vpEnv(VP_READY_SAMPLES))
  if (!voiceprintCheck(probe)) {
    t.skip('实现未落地：buildPreflight 还没有 voiceprint 条目')
    return
  }
  const env = vpEnv(VP_READY_SAMPLES)
  const snapshot = JSON.stringify(env)
  const r1 = p.buildPreflight(env)
  const r2 = p.buildPreflight(vpEnv(VP_READY_SAMPLES))
  assert.equal(JSON.stringify(env), snapshot, 'buildPreflight 不许改动传入的 env')
  assert.equal(typeof r1.then, 'undefined', 'buildPreflight 必须是同步纯函数，不能返回 Promise')
  assert.deepEqual(r1, r2, '同样输入必须得到同样输出（纯函数）')
})

// ---------------------------------------------------------------------------
// 6. 不加载模型（native DLL 会锁文件）
// ---------------------------------------------------------------------------

test('体检：collectPreflightEnv 的 voiceprint 采集不调用 createEmbedder/InferenceSession/onnxruntime，且注释写明理由', (t) => {
  const src = readSource(INDEX)
  if (!src) {
    t.skip('index.js 不可读')
    return
  }
  const fn = functionSource(src, 'async function collectPreflightEnv')
  assert.ok(fn, '找不到 collectPreflightEnv')
  assert.ok(fn.length > 300, 'collectPreflightEnv 源码段过短（' + fn.length + ' 字符），切片被参数表截断了')
  // 采集可能拆到独立 helper（collectVoiceprintEnv），两段都要查
  const helper = functionSource(src, 'async function collectVoiceprintEnv')
  const hasVp = /voiceprint/i.test(fn) || (helper && /voiceprint/i.test(helper))
  if (!hasVp) {
    t.skip('实现未落地：collectPreflightEnv 还没有 voiceprint 采集')
    return
  }
  const slices = /voiceprint/i.test(helper || '') ? [fn, helper] : [fn]
  const labels = slices.length === 2 ? ['collectPreflightEnv', 'collectVoiceprintEnv'] : ['collectPreflightEnv']
  // 只许"探测宿主有没有 onnxruntime"（require.resolve 不加载 DLL），不许真的 require/import 加载
  for (const [i, slice] of slices.entries()) {
    const code = stripComments(slice)
    assert.doesNotMatch(code, /\bcreateEmbedder\s*\(/, labels[i] + ' 不许创建 embedder（会加载 ONNX native）')
    assert.doesNotMatch(code, /\bInferenceSession\b/, labels[i] + ' 不许创建 InferenceSession')
    assert.doesNotMatch(code, /(?:^|[^.\w])require\s*\(\s*['"]onnxruntime/i, labels[i] + ' 不许 require 加载 onnxruntime')
    assert.doesNotMatch(code, /\bimport\s*\(\s*['"]onnxruntime/i, labels[i] + ' 不许动态 import onnxruntime')
    assert.doesNotMatch(code, /\bfrom\s*['"]onnxruntime/i, labels[i] + ' 不许静态 import onnxruntime')
    // 若采集体检调用了宿主可用性探测，探测本身也必须是 resolve-only
    if (/hostOnnxRuntimeAvailable\s*\(/.test(code)) {
      const probeSrc = functionSource(src, 'function hostOnnxRuntimeAvailable')
      assert.ok(probeSrc, 'hostOnnxRuntimeAvailable 的定义要可查')
      const probeCode = stripComments(probeSrc)
      assert.match(probeCode, /\.resolve\s*\(/, '宿主探测只能用 require.resolve（不加载 DLL）')
      assert.doesNotMatch(probeCode, /\bcreateEmbedder\s*\(|\bInferenceSession\b/, '宿主探测不许创建 embedder/InferenceSession')
    }
  }
  // 理由要留在注释里，避免下一个人"顺手"把它变成加载
  const withReason = slices.find((s) => /DLL|锁|native|不加载|别加载/i.test(s))
  assert.ok(withReason, '注释里要写明不加载 native 的理由（DLL 会被锁住）：' + labels.join(' / '))
})
