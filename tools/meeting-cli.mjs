#!/usr/bin/env node
/**
 * 会议助手手动测试台（CLI）
 *
 *   node tools/meeting-cli.mjs help
 *   node tools/meeting-cli.mjs devices           # 列音频端点
 *   node tools/meeting-cli.mjs levels            # 实时峰值（此刻有没有声音、在哪个设备）
 *   node tools/meeting-cli.mjs probe             # 逐设备采 3 秒算 RMS，给出建议
 *   node tools/meeting-cli.mjs capture 20        # 采 20 秒并实时转写
 *   node tools/meeting-cli.mjs capture 20 --process wemeetapp   # 只采腾讯会议（实验）
 *   node tools/meeting-cli.mjs say "你好，我是会议助手"          # TTS → 发言设备
 *   node tools/meeting-cli.mjs watch 60 --speak   # 监听，听到名字自动回复（--speak 真播）
 *   node tools/meeting-cli.mjs mute / unmute / join <会议号> / leave
 *   node tools/meeting-cli.mjs selftest
 *
 * 环境变量：MEETING_SPEAK_DEVICE=耳机  MEETING_CAPTURE_DEVICE=扬声器  BOT_NAMES=DSH,助手
 */
import { existsSync } from 'node:fs'
import { mkdir, appendFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { bridge, listDevices, toolsDir, ui } from '../lib/bridge.js'
import { transcribeWav, boostWav } from '../lib/asr.js'
import { synthesize, playWav, sayToMeeting } from '../lib/tts.js'
import { MeetingBrain, createCompleter, makeCorrector } from '../lib/brain.js'
import { MeetingSession } from '../lib/session.js'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'

const here = dirname(dirname(fileURLToPath(import.meta.url)))
const SAVED = (() => {
  try { return JSON.parse(readFileSync(join(homedir(), '.dsh', 'soulmirror', 'config.json'), 'utf8')) } catch { return {} }
})()
const cfgs = {
  speakDevice: process.env.MEETING_SPEAK_DEVICE || SAVED.devices?.speak || 'CABLE Input',
  micRestore: process.env.MEETING_MIC_RESTORE || SAVED.devices?.micRestore || '',
  captureDevice: process.env.MEETING_CAPTURE_DEVICE || '',
  botNames: (process.env.BOT_NAMES || 'DSH,助手,会议助手,小助手').split(','),
  chunkSeconds: Number(process.env.CHUNK_SECONDS || 6),
  silenceRms: Number(process.env.SILENCE_RMS || 0.004),
  workDir: join(here, '.asr-test'),
}

const cyan = (s) => `\x1b[36m${s}\x1b[0m`
const gray = (s) => `\x1b[90m${s}\x1b[0m`
const green = (s) => `\x1b[32m${s}\x1b[0m`
const yellow = (s) => `\x1b[33m${s}\x1b[0m`

function help() {
  console.log(`${cyan('会议助手测试台')}

  devices                         列音频端点
  levels                          实时峰值（秒级，判断此刻有没有声音）
  probe [seconds]                 逐设备采样算 RMS，给出 devices.capture 建议
  capture [seconds] [--process N] 采音频并实时转写（默认 20 秒）
  say <文本>                       TTS 合成并播放到发言设备
  watch [seconds] [--speak]        监听转写，命中名字就生成回复（--speak 真的播出去）
  mute | unmute                    开/闭腾讯会议麦克风
  join <会议号> [密码]              加入会议
  leave                            离开会议
  selftest                         依赖自检

环境变量：
  MEETING_SPEAK_DEVICE    发言播放到哪个渲染设备（虚拟声卡，如 "CABLE Input"）
  MEETING_CAPTURE_DEVICE  从哪个渲染设备采会议声（空 = 系统默认）
  BOT_NAMES               触发名字，逗号分隔（默认 DSH,助手,会议助手,小助手）
  CHUNK_SECONDS           切片长度（默认 6）
`)
}

async function cmdDevices() {
  const devs = await listDevices()
  for (const d of devs) console.log(`${d.flow === 'RENDER' ? '▶' : '●'} ${d.name}`)
}

async function cmdLevels() {
  const out = await bridge(['meters'])
  let max = 0
  let loud = ''
  for (const line of out.split(/\r?\n/)) {
    const [name, peak] = line.split('\t')
    if (!name) continue
    const p = Number(peak || 0)
    if (p > max) { max = p; loud = name }
    console.log(`${p >= 0.004 ? green('[有声]') : gray('[静音]')} ${name}  peak=${peak}`)
  }
  console.log(max >= 0.004 ? cyan(`\n当前有声音：${loud}`) : yellow('\n所有渲染设备静音：会议没出声 / 静音了 / 声音去了别的设备'))
}

async function cmdProbe(seconds = 3) {
  await mkdir(cfgs.workDir, { recursive: true })
  const devs = (await listDevices()).filter((d) => d.flow === 'RENDER')
  let best = ''
  let bestRms = 0
  for (const [i, d] of devs.entries()) {
    const wav = join(cfgs.workDir, `probe-${i}.wav`)
    let rms = -1
    try {
      await bridge(['capture', '--out', wav, '--seconds', String(seconds), '--mode', 'loopback', '--device', d.name], { timeoutMs: (seconds + 12) * 1000 })
      const t = await bridge(['rms', '--file', wav])
      const m = /RMS\s+([0-9.]+)/.exec(t)
      if (m) rms = Number(m[1])
    } catch (e) { console.log(gray(`${d.name}: ${e.message}`)) }
    if (rms > bestRms) { bestRms = rms; best = d.name }
    console.log(`${rms >= cfgs.silenceRms ? green('[有声]') : gray('[静音]')} ${d.name}  RMS=${rms >= 0 ? rms.toFixed(4) : 'n/a'}`)
  }
  console.log(bestRms >= cfgs.silenceRms
    ? cyan(`\n建议：MEETING_CAPTURE_DEVICE=${best}`)
    : yellow('\n都没声音：先确认会议在出声'))
}


function sessionCfg(label) {
  const asr = SAVED.asr || {}
  return {
    devices: Object.assign({ capture: '', captureMode: 'loopback', speak: '', micName: '', micRestore: '' }, SAVED.devices || {}),
    tts: SAVED.tts || { provider: 'sapi' },
    asr: {
      provider: asr.provider || 'local',
      dashscopeModel: asr.dashscopeModel || asr.model || 'paraformer-realtime-v2',
      model: asr.model || 'whisper-1',
      baseUrl: asr.baseUrl || '',
      apiKey: asr.apiKey || '',
      apiKeyEnv: asr.apiKeyEnv || 'DASHSCOPE_API_KEY',
      chunkSeconds: asr.chunkSeconds || 6,
      lang: asr.lang || 'zh',
      silenceRms: 0.004,
      whisperBin: '',
      whisperModel: '',
    },
    brain: SAVED.brain || {},
    policy: SAVED.policy || 'suggest',
    dataDir: join(here, '.asr-test', label || 'cli'),
    keepAudio: false,
  }
}

async function runSession(seconds, onLine, label, brain) {
  const cfg = sessionCfg(label)
  const s = new MeetingSession(cfg, console)
  const completerCli = createCompleter({ baseUrl: SAVED.brain?.baseUrl, model: SAVED.brain?.model, apiKey: SAVED.brain?.apiKey, apiKeyEnv: SAVED.brain?.apiKeyEnv })
  if (completerCli && SAVED.asr?.llmCorrect !== false) {
    s.correctText = makeCorrector({
      names: [SAVED.userName, ...(SAVED.wakeWords || [])].filter(Boolean),
      context: SAVED.asr?.context || '',
      completer: completerCli,
    })
  }
  s.acceptLine = (line) => Date.now() >= (brain && brain.muteUntil ? brain.muteUntil : 0)
  s.onLine = async (line) => { console.log(`${gray('[' + line.t.slice(11, 19) + ']')} ${line.text}`); if (onLine) await onLine(line) }
  await s.startCapture(label)
  const t0 = Date.now()
  while (Date.now() - t0 < seconds * 1000) {
    await new Promise((r) => setTimeout(r, 500))
    if (s.lastError) { console.log(yellow('! ' + s.lastError)); s.lastError = '' }
  }
  await s.stopCapture()
  return s
}
async function captureOnce({ seconds = 20, process = '', onLine }) {
  await mkdir(cfgs.workDir, { recursive: true })
  const dir = join(cfgs.workDir, `run-${Date.now()}`)
  await mkdir(dir, { recursive: true })
  const endAt = Date.now() + seconds * 1000
  let n = 0
  while (Date.now() < endAt) {
    const wav = join(dir, `chunk-${String(n).padStart(4, '0')}.wav`)
    try {
      if (process) {
        await bridge(['capture-process', '--out', wav, '--seconds', String(cfgs.chunkSeconds), '--process', process], { timeoutMs: (cfgs.chunkSeconds + 15) * 1000 })
      } else {
        const args = ['capture', '--out', wav, '--seconds', String(cfgs.chunkSeconds), '--mode', 'loopback']
        if (cfgs.captureDevice) args.push('--device', cfgs.captureDevice)
        await bridge(args, { timeoutMs: (cfgs.chunkSeconds + 15) * 1000 })
      }
      n += 1
      const rmsOut = await bridge(['rms', '--file', wav])
      const rms = Number((/RMS\s+([0-9.]+)/.exec(rmsOut) || [])[1] || 0)
      if (rms < cfgs.silenceRms) {
        console.log(gray(`#${n} 静音 RMS=${rms.toFixed(4)}`))
        continue
      }
      if (rms < 0.02) await boostWav(wav, Math.min(10, 0.08 / Math.max(rms, 0.002)))
      const r = await transcribeWav(wav, { provider: 'local', lang: 'zh', whisperBin: '', whisperModel: '' })
      if (r.ok && r.text) {
        const line = { t: new Date().toISOString(), text: r.text, rms }
        await appendFile(join(dir, 'transcript.jsonl'), JSON.stringify(line) + '\n', 'utf8')
        console.log(`${gray('[' + line.t.slice(11, 19) + ']')} ${r.text}`)
        if (onLine) onLine(line)
      } else if (!r.ok) {
        console.log(yellow('识别失败: ' + r.reason))
      }
    } catch (e) {
      console.log(yellow('采集失败: ' + e.message))
      await new Promise((r) => setTimeout(r, 800))
    }
  }
  return dir
}


let micState = (process.env.MEETING_MIC_INITIALLY_MUTED || 'true') === 'true' ? 'muted' : 'unmuted'
const MIC_SEL = ['-title', '腾讯会议', '-cls', 'BaseDialog|VideoMainWindow|FloatSpeakingWnd', '-proc', 'wemeetapp']

const NO_MIC = process.env.MEETING_NO_MIC === '1'

async function micOn() {
  if (NO_MIC) return false
  if (micState === 'unmuted') return false
  const r = await ui(['click', ...MIC_SEL, '-name', 'mic'])
  if (r.code !== 0) {
    const k = await ui(['key', ...MIC_SEL, '-keys', 'ctrl+m'])
    if (k.code !== 0) throw new Error('开麦失败：找不到麦克风控件，也发不出 Ctrl+M')
  }
  micState = 'unmuted'
  return true
}

async function micOff() {
  if (NO_MIC) return false
  if (micState !== 'unmuted') return false
  const r = await ui(['click', ...MIC_SEL, '-name', 'mic'])
  if (r.code !== 0) await ui(['key', ...MIC_SEL, '-keys', 'ctrl+m'])
  micState = 'muted'
  return true
}
async function cmdSay(text, viaMeeting = false) {
  await mkdir(cfgs.workDir, { recursive: true })
  const wav = join(cfgs.workDir, `say-${Date.now()}.wav`)
  const tts = { voice: 'Microsoft Huihui Desktop', rate: 0 }
  if (viaMeeting && cfgs.micRestore) {
    const r = await sayToMeeting(text, tts, { speakDevice: cfgs.speakDevice, micRestore: cfgs.micRestore, outPath: wav })
    console.log(green(`已送进会议（麦克风临时切到 ${r.cableMic || '虚拟声卡'}，播完已切回 ${cfgs.micRestore}）`))
    return
  }
  await synthesize(text, tts, wav)
  await playWav(wav, cfgs.speakDevice)
  console.log(green(`已播放 → ${cfgs.speakDevice || '系统默认设备'}`))
}

async function cmdWatch(seconds = 60, speak = false) {
  const hits = []
  console.log(cyan(`监听 ${seconds}s，命中 ${cfgs.botNames.join('/')} 触发回复${speak ? '（会真的播出去）' : '（只打印，不播）'}`))
  await runSession(seconds, async (line) => {
    const hit = cfgs.botNames.find((n) => n && line.text.includes(n))
    if (!hit) return
    const reply = `我在。刚才提到的内容我记下了：${line.text.slice(0, 40)}`
    hits.push({ hit, line, reply })
    console.log(yellow(`\n[触发] 听到「${hit}」→ 回复草稿：${reply}\n`))
    if (speak) {
      try { await cmdSay(reply) } catch (e) { console.log(yellow('播报失败: ' + e.message)) }
    }
  }, 'watch')
  console.log(cyan(`\n结束：命中 ${hits.length} 次`))
}


async function cmdAgent(seconds = 120, speakOn = false) {
  const brain = new MeetingBrain({ minGapMs: 6000 })
  const complete = createCompleter({
    baseUrl: process.env.BRAIN_BASE_URL || SAVED.brain?.baseUrl || '',
    model: process.env.BRAIN_MODEL || SAVED.brain?.model || '',
    apiKey: process.env.BRAIN_API_KEY || SAVED.brain?.apiKey || '',
  })
  console.log(cyan(`后台大脑启动：${seconds}s，LLM=${complete ? '已配置' : '未配置（规则+模板）'}，播报=${speakOn ? '开' : '关'}`))
  await runSession(seconds, async (line) => {
      const trig = brain.push(line)
      if (!trig) return
      const d = await brain.decide(trig, { complete })
      const tag = d.speak ? 'SPEAK' : 'skip '
      console.log(yellow(`[${tag}] ${d.reason} (${d.confidence}) -> ${d.text || '-'}`))
      if (d.speak && speakOn && d.text) {
        brain.markSpoken(d.text)
        try { if (await micOn()) console.log(green('  已开麦')) } catch (e) { console.log(yellow('  开麦失败: ' + e.message)) }
        try {
          const ttsCfg = SAVED.tts || { provider: 'sapi', voice: 'Microsoft Huihui Desktop' }
          if (process.env.TTS_PROVIDER) ttsCfg.provider = process.env.TTS_PROVIDER
          const r = await sayToMeeting(d.text, ttsCfg, {
            speakDevice: cfgs.speakDevice,
            micRestore: cfgs.micRestore,
          })
          brain.markSpoken(d.text)
          console.log(green(`  已播报（${r.mode}）`))
        } catch (e) { console.log(yellow('  播报失败: ' + e.message)) }
      }
  }, 'agent', brain)
  console.log(cyan(`结束：听 ${brain.stats.seen} · 触发 ${brain.stats.triggered} · 播报 ${brain.stats.spoken}`))
}
async function cmdMute(action) {
  const r = await ui(['click', '-title', '腾讯会议', '-cls', 'VideoMainWindow|FloatSpeakingWnd|MeetingMainWindow|BaseDialog', '-proc', 'wemeetapp', '-name', 'mic'])
  if (r.code !== 0) throw new Error((r.text || r.stderr || '').trim())
  console.log(green(r.text))
}

async function cmdJoin(code, pwd) {
  await ui(['focus', '-title', '腾讯会议', '-proc', 'wemeetapp'])
  try { console.log(await ui(['click', '-title', '腾讯会议', '-proc', 'wemeetapp', '-name', '加入会议'])) } catch (e) { console.log(yellow(e.message)) }
  await new Promise((r) => setTimeout(r, 800))
  for (const cand of ['会议号', '请输入会议号', 'meeting_code']) {
    try { console.log(await ui(['settext', '-title', '腾讯会议', '-proc', 'wemeetapp', '-name', cand, '-value', code])); break } catch { /* next */ }
  }
  if (pwd) {
    for (const cand of ['密码', '入会密码']) {
      try { await ui(['settext', '-title', '腾讯会议', '-proc', 'wemeetapp', '-name', cand, '-value', pwd]); break } catch { /* next */ }
    }
  }
  console.log(green('已填会议号，接下来需要在界面上点「加入」'))
}

async function cmdLeave() {
  for (const cand of ['离开会议', '离开']) {
    try { console.log(await ui(['click', '-title', '腾讯会议', '-proc', 'wemeetapp', '-name', cand])); return } catch { /* next */ }
  }
  console.log(yellow('没找到离开按钮'))
}

async function cmdSelftest() {
  console.log(`mbridge.exe : ${existsSync(join(toolsDir, 'mbridge.exe')) ? green('✓') : yellow('✗')}`)
  const bin = join(toolsDir, 'whisper', 'Release', 'whisper-cli.exe')
  const model = join(toolsDir, 'whisper', 'models', 'ggml-base.bin')
  console.log(`whisper     : ${existsSync(bin) ? green('✓') : yellow('✗')} ${gray(bin)}`)
  console.log(`model       : ${existsSync(model) ? green('✓') : yellow('✗')} ${gray(model)}`)
  try {
    const devs = await listDevices()
    console.log(`audio       : ${green('✓')} ${devs.filter((d) => d.flow === 'RENDER').length} 渲染 / ${devs.filter((d) => d.flow === 'CAPTURE').length} 采集`)
    const virt = devs.filter((d) => /CABLE|VB-Audio|虚拟|Virtual/i.test(d.name))
    console.log(`virtual mic : ${virt.length ? green('✓ ' + virt.map((d) => d.name).join(' | ')) : yellow('✗ 未安装（发言进不了会议）')}`)
  } catch (e) { console.log(yellow('audio ✗ ' + e.message)) }
  const r = await ui(['list'])
  const hasMeeting = /wemeetapp/.test(r.text || '')
  console.log(`meeting app : ${hasMeeting ? green('✓ 腾讯会议在运行') : yellow('✗ 未发现 wemeetapp')}`)
}

const [cmd = 'help', ...rest] = process.argv.slice(2)
try {
  switch (cmd) {
    case 'help': help(); break
    case 'devices': await cmdDevices(); break
    case 'levels': await cmdLevels(); break
    case 'probe': await cmdProbe(Number(rest[0] || 3)); break
    case 'capture': {
      const sec = Number(rest[0] || 20)
      const pi = rest.indexOf('--process')
      const proc = pi >= 0 ? rest[pi + 1] : ''
      await runSession(sec, null, 'capture')
      break
    }
    case 'say': await cmdSay(rest.filter(x => x !== '--meeting').join(' '), rest.includes('--meeting')); break
    case 'watch': {
      const sec = Number(rest[0] || 60)
      const speak = rest.includes('--speak')
      await cmdWatch(sec, speak)
      break
    }
    case 'agent': await cmdAgent(Number(rest[0] || 120), rest.includes('--speak')); break
    case 'mute': await cmdMute('mute'); break
    case 'unmute': await cmdMute('unmute'); break
    case 'join': await cmdJoin(rest[0], rest[1]); break
    case 'leave': await cmdLeave(); break
    case 'selftest': await cmdSelftest(); break
    default: help()
  }
} catch (e) {
  console.error(yellow('ERROR: ' + e.message))
  process.exitCode = 1
}
