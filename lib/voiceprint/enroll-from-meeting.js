/**
 * 从「已有会议录音」里把某个云端说话人（说话人1/2/3）存成声纹。
 *
 * 用户原话：
 *   「可以从录制的音频中，根据云端返回的说话人1/2/3，也可以手动将对应的声纹加入声纹库。」
 *
 * 为什么不能"把这段说话人的音频整段算一个向量"：
 *   OpenASR 的 evidence 规则已经证明，整段算向量会把别人的话/静音/回声一起揉成混合向量，
 *   注册进去的样本从此污染整簇匹配。所以这里严格复用识别那一侧同一套规则：
 *     · planWindows：2.0s 窗 / 1.0s 步进 / turn 首尾各修 0.5s / 每人 ≤20 窗 / 不跨别人说话
 *     · keepMainCluster：二簇切分后丢掉少数簇（少数簇 >35% 判成"混了两个人"→ 不入库）
 *     · 注册门槛 10 秒照 quality.js（registered speech seconds，**按去重后的可用时长算**，
 *       不能拿互相重叠的窗口时长相加，否则 6 秒的发言会被算成 16 秒骗过门槛）
 *
 * 落盘顺序（AGENTS.md：先落盘再展示、失败不留半个人）：
 *   算窗口 → 算向量 → 纯化 → 过质量门槛 → 定人（同名=同一人，追加样本）→ 写库
 *   写库抛错时，如果这个人是我们刚建的，就立刻标删，不留下"有个人但没有样本"的半成品。
 *
 * 这一层不认识 HTTP：路由（/voiceprint-enroll）、面板、将来的批量补录都调用它，
 * 保证"从会议录音入库"只有一份实现。
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { checkEnrollment, qualityWeight, MIN_SAMPLE_SPEECH_SECONDS } from './quality.js'
import { planWindows, weightedMean } from './match.js'
import { keepMainCluster, readWavLayout, readWavSamples } from './service.js'
import { parseLog, replayLog } from '../transcript-log.js'
import { normalizeLabel, sanitizeName } from '../speaker-map.js'

/** 与 match.js 的 evidence 规则同源（这里显式写出来，便于日志与提示引用同一组数字） */
export const ENROLL_WINDOW_SECONDS = 2.0
export const ENROLL_STEP_SECONDS = 1.0
export const ENROLL_TRIM_SECONDS = 0.5
export const ENROLL_MAX_WINDOWS = 20
/** 声纹前端（fbank）只吃 16k 单声道 16bit；别的格式不静默重采样 */
export const ENROLL_SAMPLE_RATE = 16000
/** 转写优先级：非流式转写才有可靠的 begin/end 时间轴 */
export const TRANSCRIPT_FILES = Object.freeze(['transcript-offline.jsonl', 'transcript.jsonl'])

/**
 * 失败原因全集（界面/日志/文档都按这一份说话，避免各拼一套）。
 * 前 7 个是需求约定的必备原因；后面几个是这条链路上真实会遇到的分支。
 */
export const ENROLL_FROM_MEETING_REASONS = Object.freeze([
  'consent-required',     // 没有 consent.granted===true
  'model-missing',        // 声纹模型不可用（没装/校验不过/清单缺失）
  'runtime-missing',      // 模型在，但 onnxruntime 运行库不可用
  'no-audio',             // 目录里没有 audio.wav，或格式不是 16k/16bit/单声道
  'no-speaker',           // 该标签在这场会里没有可用句子（或句子没有时间轴）
  'not-enough-speech',    // 证据不足：去重后可用语音 < 10 秒
  'mixed-voices',         // 这段里像两个人（少数簇占比 > 35%）
  'embed-failed',         // 模型算不出向量（会话/维度/音频太短）
  'need-name',            // 没有姓名也没给 personId
  'library-missing',      // 没有声纹库（调用方漏传）
  'person-missing',       // 指定了 personId 但这个人不存在/已删除
  'store-failed',         // 向量算好了，写库失败（此时不会留下半个人）
])

const round1 = (v) => Math.round((Number(v) || 0) * 10) / 10
const round2 = (v) => Math.round((Number(v) || 0) * 100) / 100
const round3 = (v) => Math.round((Number(v) || 0) * 1000) / 1000

/**
 * 合并重叠区间（保留不连续段）。用于把互相重叠的 2s 窗口还原成"真正说了多久"：
 * 10 个 1s 步进的 2s 窗口如果直接相加是 20 秒，实际只覆盖 11 秒。
 *
 * @param {{start:number,end:number}[]} list 单位：秒
 * @returns {{start:number,end:number}[]}
 */
export function mergeIntervals(list) {
  const sorted = (Array.isArray(list) ? list : [])
    .filter((i) => i && Number.isFinite(i.start) && Number.isFinite(i.end) && i.end > i.start)
    .map((i) => ({ start: i.start, end: i.end }))
    .sort((a, b) => a.start - b.start)
  const out = []
  for (const iv of sorted) {
    const last = out[out.length - 1]
    if (last && iv.start <= last.end + 1e-6) last.end = Math.max(last.end, iv.end)
    else out.push({ ...iv })
  }
  return out
}

/**
 * 读一场会的转写句子（优先非流式转写：只有它有可靠时间轴）。
 * 读不到就返回空数组 + error，**不编造**任何句子。
 *
 * @param {string} dir 会议目录
 * @returns {{lines: object[], file: string, error: string}}
 */
export function readTranscriptLines(dir, { files = TRANSCRIPT_FILES } = {}) {
  const out = { lines: [], file: '', error: '' }
  const base = String(dir || '')
  if (!base) return out
  for (const name of Array.isArray(files) ? files : TRANSCRIPT_FILES) {
    const file = join(base, name)
    if (!existsSync(file)) continue
    let text = ''
    try {
      text = readFileSync(file, 'utf8')
    } catch (e) {
      out.error = '读不到转写文件 ' + name + '：' + (e && e.message ? e.message : String(e))
      continue
    }
    const { lines } = replayLog(parseLog(text).records)
    const usable = lines.filter((l) => l && l.speaker
      && Number.isFinite(Number(l.begin)) && Number.isFinite(Number(l.end))
      && Number(l.end) > Number(l.begin))
    if (usable.length) return { lines: usable, file, error: '' }
  }
  return out
}

/**
 * 挑出某个说话人标签的句子（毫秒区间）。
 * 助手播报（role=assistant）和断点（src=gap）不是人说的，必须排除，否则会污染窗口。
 *
 * @param {object[]} lines
 * @param {string} speaker 「说话人2」/「speaker 2」/「2」都可以
 * @returns {{speaker:string, begin:number, end:number}[]}
 */
export function pickSpeakerLines(lines, speaker) {
  const want = normalizeLabel(speaker)
  if (!want) return []
  const out = []
  for (const l of Array.isArray(lines) ? lines : []) {
    if (!l || !l.speaker) continue
    if (l.role === 'assistant' || l.src === 'gap') continue
    if (normalizeLabel(l.speaker) !== want) continue
    const begin = Number(l.begin)
    const end = Number(l.end)
    if (!Number.isFinite(begin) || !Number.isFinite(end) || end <= begin) continue
    out.push({ speaker: want, begin, end })
  }
  return out
}

/** 把给人看的失败对象做成唯一形状：{ok:false, reason, message, hint, ...数字} */
function fail(reason, message, hint, extra) {
  return { ok: false, reason, message, hint: hint || '', ...(extra && typeof extra === 'object' ? extra : {}) }
}

/** 嵌入器不可用时区分"模型没装"与"运行库没装"（都是 model-missing 之外的真实分支） */
function embedderFailure(embedder) {
  const reason = String((embedder && embedder.reason) || 'model-missing')
  if (/runtime|onnx-runtime/.test(reason)) return { reason: 'runtime-missing', hint: '运行库不可用：在「纪要与产物 → 我认识的人 · 本机声纹」点「一键安装」补齐运行库' }
  const hint = (embedder && embedder.hint)
    || '在「纪要与产物 → 我认识的人 · 本机声纹」点「一键安装」，装好后自动生效'
  return { reason: 'model-missing', hint }
}

/**
 * 从会议录音的某个说话人入库。**同一个路由/同一条链路**同时服务两个入口：
 *   A. 面板「这场会谁是谁」每一行的「存成声纹」（dir + speaker）
 *   B. 声纹卡「从会议录音添加」（历史会议目录 + speaker）
 *
 * @param {{
 *   library: any, space: any, embedder: any,
 *   dir: string, speaker: string, lines?: object[],
 *   name?: string, personId?: string,
 *   consent?: {granted?:boolean, grantedAt?:string, noticeVersion?:string, captureMethod?:string},
 *   minSeconds?: number, logger?: any,
 * }} o
 * @returns {Promise<object>} 成功见文末 return；失败统一 {ok:false, reason, message, hint, …}
 */
export async function enrollFromMeeting(o = {}) {
  const library = o.library
  const logger = o.logger || null
  const dir = String(o.dir || '')
  const speaker = normalizeLabel(o.speaker)
  const minSeconds = Number(o.minSeconds) > 0 ? Number(o.minSeconds) : MIN_SAMPLE_SPEECH_SECONDS
  // 一句连续说多久才能凑够门槛：窗口几何决定（turn 首尾各修 0.5s）——不给 UI 自己推算
  const requiredContinuousSeconds = round1(minSeconds + ENROLL_TRIM_SECONDS * 2)
  const requiredWindows = Math.max(5, Math.ceil(minSeconds - ENROLL_STEP_SECONDS))
  const failBase = { speaker, dir, requiredSeconds: minSeconds, requiredContinuousSeconds, requiredWindows }

  if (!library) return fail('library-missing', '没有声纹库，无法入库', '宿主没有打开 <数据目录>/voiceprint/library.json', failBase)
  // ① 同意是硬门槛：没有显式 granted===true 直接拒绝，绝不替用户"造"一条同意记录
  if (!(o.consent && o.consent.granted === true)) {
    return fail('consent-required', '还没有勾选同意，不能把这个人的声纹存进本机库',
      '勾选「我同意在本机保存这个人的声纹，仅用于会后认人」后再提交', failBase)
  }
  // ② 人名 / 已有 personId：两者都没有就没法定人
  const personName = sanitizeName(o.name)
  const personIdGiven = String(o.personId || '')
  if (!personName && !personIdGiven) {
    return fail('need-name', '请先填这个人的名字', '名字用来在「我认识的人」里显示，同名会追加样本而不是新建一个人', failBase)
  }
  // ③ 目录
  if (!dir) return fail('no-audio', '没有指定会议目录', '从「这场会谁是谁」或「之前的录音」里挑一场有音频的会', failBase)
  if (!existsSync(dir)) return fail('no-audio', '这场会的目录已经不存在：' + dir, '它可能被删除了；从「之前的录音」里重新挑一场', failBase)
  // ④ 模型/运行库：**在碰音频之前**判定（不解码、不切窗；没装就明确说没装）
  const embedder = o.embedder
  if (!embedder || !embedder.ok) {
    const f = embedderFailure(embedder)
    return fail(f.reason, '声纹模型/运行库不可用，这段录音**没有解码、也没有入库**', f.hint,
      { ...failBase, decoded: false })
  }
  // ⑤ 说话人
  if (!speaker) {
    return fail('no-speaker', '没有说明要存哪个说话人', '传 speaker：「说话人1」/「说话人2」（云端分人返回的标签）', failBase)
  }
  // ⑥ 音频文件 + 格式（格式不对就别装作能算：fbank 只吃 16k/16bit/单声道）
  const wavFile = join(dir, 'audio.wav')
  if (!existsSync(wavFile)) {
    return fail('no-audio', '这场会的目录里没有 audio.wav', '只有带录音的会才能补声纹；在「之前的录音」里挑一条 hasAudio=true 的',
      { ...failBase, wavFile })
  }
  let layout
  try {
    layout = readWavLayout(wavFile)
  } catch (e) {
    return fail('no-audio', '这段录音读不出来：' + (e && e.message ? e.message : String(e)),
      '录音可能损坏；用「之前的录音」里的音频重新整理一次，或换一场会', { ...failBase, wavFile })
  }
  if (layout.channels !== 1 || layout.bits !== 16 || layout.sampleRate !== ENROLL_SAMPLE_RATE) {
    return fail('no-audio',
      '这段录音的格式不支持声纹：' + layout.channels + ' 声道 / ' + layout.bits + 'bit / ' + layout.sampleRate + ' Hz'
      + '（只支持 16k/16bit/单声道）',
      '声纹前端不做重采样；用「之前的录音 → 导入音频」把它转成 16k 单声道 WAV 后再试',
      { ...failBase, wavFile, format: { channels: layout.channels, bits: layout.bits, sampleRate: layout.sampleRate } })
  }

  // ⑦ 这个标签在这场会里说了什么
  const source = Array.isArray(o.lines)
    ? { lines: o.lines, file: '(调用方传入)' }
    : readTranscriptLines(dir)
  if (source.error && !source.lines.length) {
    logger?.warn?.('[soulmirror] 会议录音补声纹：' + source.error)
  }
  const picked = pickSpeakerLines(source.lines, speaker)
  const labels = Array.from(new Set((source.lines || [])
    .filter((l) => l && l.speaker && l.role !== 'assistant' && l.src !== 'gap')
    .map((l) => normalizeLabel(l.speaker)).filter(Boolean)))
  const availableSeconds = round1(picked.reduce((a, l) => a + (l.end - l.begin) / 1000, 0))
  if (!picked.length) {
    const why = labels.length
      ? '这场会里没有「' + speaker + '」的可用句子（云端只分出了：' + labels.join('、') + '）'
      : '这场会没有带时间轴的说话人句子，切不出证据窗口'
    return fail('no-speaker', why,
      labels.length
        ? '换一个标签试试；也可能是这场的转写里这个人只有助手播报/断点'
        : '先让这场会用「非流式转写」整理一次（要 transcript-offline.jsonl），再来补声纹',
      { ...failBase, file: source.file, labels, availableSeconds: 0 })
  }

  // ⑧ 证据窗口（规则与识别同一套：不跨别人、首尾修剪、每人 ≤20）
  const windows = planWindows(picked, {
    window: ENROLL_WINDOW_SECONDS, step: ENROLL_STEP_SECONDS,
    trim: ENROLL_TRIM_SECONDS, maxWindows: ENROLL_MAX_WINDOWS,
  })
  if (!windows.length) {
    return fail('not-enough-speech',
      '「' + speaker + '」这场会只说了 ' + availableSeconds + ' 秒，凑不出一个 '
      + ENROLL_WINDOW_SECONDS + ' 秒的干净窗口（首尾各要修 ' + ENROLL_TRIM_SECONDS + ' 秒）',
      '需要这个人在不被打断的情况下连续说满约 ' + requiredContinuousSeconds + ' 秒；换一场发言更长的会，或现场录一段',
      {
        ...failBase, file: source.file, windows: 0, keptSeconds: 0,
        availableSeconds, speechSeconds: availableSeconds,
      })
  }

  // ⑨ 逐窗算向量（只读需要的区间：一场会的 audio.wav 可能几十上百 MB）
  const vectors = []
  const keptWindowsAll = []
  let embedError = ''
  let readError = ''
  for (const w of windows) {
    let pcm
    try {
      pcm = readWavSamples(wavFile, w.start, w.end)
    } catch (e) {
      readError = e && e.message ? e.message : String(e)
      continue
    }
    if (pcm.length < ENROLL_SAMPLE_RATE * 0.5) continue
    try {
      const vec = await embedder.embed(pcm)
      if (vec && vec.length) {
        vectors.push(vec)
        keptWindowsAll.push(w)
      }
    } catch (e) {
      embedError = e && e.message ? e.message : String(e)
    }
  }
  if (!vectors.length) {
    if (embedError) {
      return fail('embed-failed', '算声纹向量失败：' + embedError,
        '模型/运行库和音频格式都要对得上；可以在声纹卡点「一键安装」重装模型后重试',
        { ...failBase, file: source.file, windows: windows.length, decoded: true })
    }
    if (readError) {
      return fail('no-audio', '这段录音切不出来：' + readError,
        '录音可能损坏或被截断；换一场会，或用「之前的录音 → 导入音频」重新转一次',
        { ...failBase, file: source.file, windows: windows.length, decoded: true })
    }
    return fail('not-enough-speech',
      '「' + speaker + '」这场会只说了 ' + availableSeconds + ' 秒，切出来的窗口都太短了',
      '需要这个人在不被打断的情况下连续说满约 ' + requiredContinuousSeconds + ' 秒',
      { ...failBase, file: source.file, windows: windows.length, keptSeconds: 0, availableSeconds })
  }

  // ⑩ 纯化：二簇切分后丢掉少数簇（少数簇 >35% = 真的混了两个人 → 拒绝入库）
  const main = keepMainCluster(vectors)
  const kept = main.kept.map((i) => vectors[i])
  const keptWindows = main.kept.map((i) => keptWindowsAll[i])
  // 去重后的可用时长（窗口互相重叠 1 秒，直接相加会把 6 秒算成 16 秒）
  const union = mergeIntervals(keptWindows)
  const speechSeconds = round2(union.reduce((a, i) => a + (i.end - i.start), 0))
  const droppedSeconds = round2(main.dropped.reduce((a, i) => a + (keptWindowsAll[i].end - keptWindowsAll[i].start), 0))
  const diag = {
    ...failBase, file: source.file, windows: keptWindows.length,
    windowsTotal: windows.length, droppedWindows: main.dropped.length, droppedSeconds,
    keptSeconds: speechSeconds, availableSeconds, decoded: true,
  }
  if (main.mixed) {
    return fail('mixed-voices',
      '这段录音里像两个人在说话（丢掉少数簇后仍占 '
      + Math.round((main.dropped.length / Math.max(1, vectors.length)) * 100) + '%），'
      + '混着存会把两个人的声音写进同一个人，所以先不入库',
      '换这一场里更干净的另一个人，或换一场只有他一个人发言的会；现场对着面板录一段也更稳',
      { ...diag, mixed: true })
  }

  // ⑪ 质量门槛（10 秒 / 静音 / 削波）：先过门槛，再写库
  let gatePcm = null
  try {
    gatePcm = readIntervalPcm(wavFile, union, layout.sampleRate)
  } catch (e) {
    return fail('no-audio', '这段录音切不出来：' + (e && e.message ? e.message : String(e)),
      '录音可能损坏；换一场会再试', diag)
  }
  if (!gatePcm || !gatePcm.length) {
    return fail('no-audio', '这一段切出来是空的（音频可能比转写时间轴短）',
      '这场会的 audio.wav 与转写时间轴对不上；用「之前的录音 → 用录音重新整理」重跑一次',
      { ...diag, windows: 0, keptSeconds: 0 })
  }
  const gate = checkEnrollment(gatePcm)
  if (!gate.ok) {
    if (gate.reason === 'not-enough-speech') {
      return fail('not-enough-speech',
        '「' + speaker + '」这段只够 ' + round1(gate.stats.speechSeconds) + ' 秒可用语音，至少需要 '
        + minSeconds + ' 秒，所以没有入库',
        '这个说话人在这场会里一共说了 ' + availableSeconds + ' 秒；注册声纹需要一段连续说满约 '
        + requiredContinuousSeconds + ' 秒的干净发言（推荐 ' + (minSeconds + 2) + ' 秒），或换一场发言更长的会',
        {
          ...diag, windows: keptWindows.length, keptSeconds: round1(gate.stats.speechSeconds),
          speechSeconds: round1(gate.stats.speechSeconds), availableSeconds,
        })
    }
    // 静音 / 削波：把 quality.js 的原话与建议原样交出去（不自己另编一套）
    return fail(gate.reason, gate.message, gate.advice, {
      ...diag, windows: keptWindows.length,
      keptSeconds: round1(gate.stats.speechSeconds),
      speechSeconds: round1(gate.stats.speechSeconds),
    })
  }

  // ⑫ 定人：同名 = 同一个人（追加样本），不新建；显式 personId 优先
  let target = null
  let created = false
  if (personIdGiven) {
    const existing = library.person(personIdGiven)
    if (!existing || existing.status !== 'active') {
      return fail('person-missing', '这个人已经不在本机声纹库里了', '清掉重选，按名字新建一次', { ...diag, personId: personIdGiven })
    }
    target = existing
  } else {
    const sameName = library.people().find((p) => sanitizeName(p.displayName).toLowerCase() === personName.toLowerCase())
    if (sameName) target = sameName
    else {
      target = library.addPerson(personName)
      created = true
    }
  }

  // ⑬ 质心入库：主簇窗口向量的平均（不是把整段音频算一个向量）
  const embedding = weightedMean(kept, kept.map(() => 1))
  const weight = qualityWeight(gate.stats)
  let sample = null
  try {
    sample = library.addSample({
      personId: target.personId,
      space: o.space,
      embedding,
      quality: {
        ...gate.stats,
        weight,
        windows: keptWindows.length,
        windowsTotal: windows.length,
        droppedWindows: main.dropped.length,
        speaker,
      },
      seconds: round1(gate.stats.speechSeconds),
      consent: {
        grantedAt: (o.consent && o.consent.grantedAt) || new Date().toISOString(),
        noticeVersion: (o.consent && o.consent.noticeVersion) || 'v1',
        captureMethod: (o.consent && o.consent.captureMethod) || 'meeting-recording',
      },
    })
  } catch (e) {
    // 写库失败不能留下半个人：刚建的这个人立刻标删（墓碑保留了"发生过的删除"这条事实）
    let rolledBack = false
    if (created) {
      try {
        library.deletePerson(target.personId, 'enroll-rollback')
        rolledBack = true
      } catch (e2) {
        logger?.warn?.('[soulmirror] 声纹入库回滚失败（' + target.personId + '）：' + (e2 && e2.message ? e2.message : String(e2)))
      }
    }
    return fail('store-failed', '向量算好了，但写声纹库失败：' + (e && e.message ? e.message : String(e)),
      rolledBack
        ? '刚建的人已经撤回，库里没有半成品；检查 <数据目录> 是否可写后重试'
        : '可以重试；如果一直失败，检查 <数据目录>/voiceprint 是否可写、磁盘是否已满',
      { ...diag, personId: rolledBack ? '' : target.personId, rolledBack, windows: keptWindows.length })
  }

  const samples = library.listSamples(target.personId, { space }).length
  const result = {
    ok: true,
    personId: target.personId,
    personName: target.displayName,
    speaker,
    // 本次用了多少证据：窗口数 + 去重后的秒数（两者都进结果与日志）
    windows: keptWindows.length,
    windowsTotal: windows.length,
    droppedWindows: main.dropped.length,
    seconds: round1(gate.stats.speechSeconds),
    keptSeconds: speechSeconds,
    availableSeconds,
    quality: {
      weight: round2(weight),
      snrEstimate: round1(gate.stats.snrEstimate),
      clippingRatio: round3(gate.stats.clippingRatio),
      speechSeconds: round1(gate.stats.speechSeconds),
      windows: keptWindows.length,
    },
    sampleId: sample.sampleId,
    samples,
    appended: !created,
    // 可审计：这一段证据来自哪个文件、哪个标签、哪些秒
    source: { file: source.file, wavFile, windowsKept: keptWindows.map((w) => ({ start: w.start, end: w.end })) },
    mixed: false,
  }
  logger?.info?.('[soulmirror] 从会议录音入库声纹：' + result.personName + ' · ' + speaker + ' · '
    + result.windows + '/' + result.windowsTotal + ' 窗 · ' + result.keptSeconds + ' 秒 · 质量 '
    + result.quality.weight + ' · ' + (result.appended ? '追加样本' : '新建') + ' · 现有 ' + result.samples + ' 个样本')
  return result
}

/**
 * 读一段（可多段）区间的 PCM 并拼起来。质量门槛看的是"真正说了多少秒"，
 * 所以这里按**合并后的区间**读，不按互相重叠的窗口读。
 *
 * @param {string} wavFile
 * @param {{start:number,end:number}[]} intervals 秒
 * @param {number} sampleRate
 * @returns {Float32Array}
 */
function readIntervalPcm(wavFile, intervals, sampleRate) {
  const parts = []
  let total = 0
  for (const iv of intervals) {
    const pcm = readWavSamples(wavFile, iv.start, iv.end)
    if (!pcm.length) continue
    parts.push(pcm)
    total += pcm.length
  }
  if (!parts.length) return new Float32Array(0)
  const expected = Math.round(intervals.reduce((a, i) => a + Math.max(0, i.end - i.start), 0) * (Number(sampleRate) || ENROLL_SAMPLE_RATE))
  const out = new Float32Array(Math.max(total, expected))
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out.subarray(0, at)
}
