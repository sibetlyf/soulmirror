import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readWavHeader } from '../lib/offline-asr.js'

/**
 * 会后整理事故回归：
 *  1) 离线重转写成功后必然抛 ReferenceError（speakers 在声明前被使用）
 *     → 表现是"转文字跑完了，但纪要没生成、知识库没写"
 *  2) 整份 readFileSync 上传 → 长会议把 4GB 堆撑爆（FATAL ERROR: heap out of memory）
 */

const src = readFileSync(new URL('../index.js', import.meta.url), 'utf8')

test('speakers 必须先声明后使用（TDZ 回归）', () => {
  const declareAt = src.indexOf('const speakers = new Set(')
  const useAt = src.indexOf('speakers: speakers }')
  assert.ok(declareAt > 0, '找不到 speakers 声明')
  // 使用点若存在，必须晚于声明点
  if (useAt > 0) assert.ok(useAt > declareAt, 'speakers 在声明前被使用（TDZ ReferenceError）')
  // 现在的写法应是简写属性，且位于声明之后
  const shorthandAt = src.indexOf('speakers })', declareAt)
  assert.ok(shorthandAt > declareAt, 'setPostMeeting 里应在声明之后用 speakers')
})

test('离线重转写不再整份 readFileSync 上传', () => {
  const at = src.indexOf('transcribeFileWithSpeakers(')
  assert.ok(at > 0, '找不到 transcribeFileWithSpeakers 调用')
  const seg = src.slice(at, at + 500)
  assert.equal(/file:\s*readFileSync\(/.test(seg), false, '又改回整份 readFileSync 了（长会议会 OOM）')
  assert.match(seg, /openAsBlob\(/, '应使用 openAsBlob 流式上传')
})

test('算时长只读文件头，不读整份 PCM', () => {
  // 按函数定义定位（'runOfflinePass' 这个词在别处也出现，用第一次出现会找错地方）
  const at = src.indexOf('async function runOfflinePass')
  assert.ok(at > 0, '找不到 runOfflinePass 定义')
  const seg = src.slice(at, at + 2000)
  assert.match(seg, /readWavHeader\(wav\)/, '应用 readWavHeader 只读头')
  assert.equal(/const \{ seconds \} = readWavPcm\(wav\)/.test(seg), false, '不该为算时长读整份')
})

test('超大录音跳过云端文件识别', () => {
  assert.match(src, /wavBytes > 300 \* 1024 \* 1024/, '缺少大文件门限')
  assert.match(src, /跳过云端文件识别/, '缺少跳过说明')
})

test('离线重转写有总超时，超时后仍会用实时纪要继续', () => {
  assert.match(src, /offlineTimeoutMs/, '缺少离线超时配置')
  // 现在调用是三选一（默认内联、可选子进程），都必须被超时包裹。
  // 注意 withTimeout( 与表达式之间夹着注释，所以用窗口断言而不是跨行正则。
  const callAt = src.indexOf('const off = await withTimeout(')
  assert.ok(callAt > 0, '找不到离线调用')
  const callSeg = src.slice(callAt, callAt + 900)
  assert.match(callSeg, /offlineViaChild === true/, '应支持子进程开关')
  assert.match(callSeg, /: runOfflinePass\(runDir/, '默认应走内联（目录用快照）')
  assert.match(callSeg, /offlineTimeoutMs/, '应传超时')
  assert.match(callSeg, /onTimeout/, '超时后要通知底层取消，而不是只结束等待')
  const at = src.indexOf('function withTimeout(')
  assert.ok(at > 0, '缺少 withTimeout 实现')
})

test('会后重转写优先交给后台 dsh 进程（节约主进程资源）', () => {
  const at = src.indexOf('async function runOfflineInBackground')
  assert.ok(at > 0, '缺少后台执行器')
  const seg = src.slice(at, at + 1200)
  assert.match(seg, /runDshTask\(/, '没有起独立 dsh 进程')
  assert.match(seg, /meeting_offline_pass/, '后台任务应调用本插件的重转写工具')
  assert.match(seg, /return runOfflinePass\(dir\)/, '后台失败时要回落内联执行')

  // 该工具必须真的注册了，否则后台进程无从调用
  assert.match(src, /name: 'meeting_offline_pass'/, '缺少 meeting_offline_pass 工具')
})

test('音频只保留一个文件：转 wav 时流式拷贝并删掉 pcm', () => {
  const sessionSrc = readFileSync(new URL('../lib/session.js', import.meta.url), 'utf8')
  const at = sessionSrc.indexOf('async finalizeRecording')
  assert.ok(at > 0, '找不到 finalizeRecording')
  const seg = sessionSrc.slice(at, at + 1600)
  assert.match(seg, /pipeline\(createReadStream\(pcmPath\)/, '应流式拷贝而不是 readFile')
  assert.equal(/await readFile\(pcmPath\)/.test(seg), false, '又改回整份读入了')
  assert.match(seg, /unlink\(pcmPath\)/, '转完应删除 pcm（避免磁盘两份）')
})

test('readWavHeader 只读头部且算得对', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sm-wav-'))
  const f = join(dir, 'a.wav')
  // 造一个 1 秒的 16k/16bit/单声道 WAV：44 字节头 + 32000 字节数据
  const buf = Buffer.alloc(44 + 32000)
  buf.write('RIFF', 0, 'ascii')
  buf.writeUInt32LE(36 + 32000, 4)
  buf.write('WAVE', 8, 'ascii')
  buf.write('fmt ', 12, 'ascii')
  buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(1, 20)   // PCM
  buf.writeUInt16LE(1, 22)   // 单声道
  buf.writeUInt32LE(16000, 24)
  buf.writeUInt32LE(32000, 28)
  buf.writeUInt16LE(2, 32)
  buf.writeUInt16LE(16, 34)
  buf.write('data', 36, 'ascii')
  buf.writeUInt32LE(32000, 40)
  writeFileSync(f, buf)

  const h = readWavHeader(f)
  assert.equal(h.sampleRate, 16000)
  assert.equal(h.channels, 1)
  assert.ok(Math.abs(h.seconds - 1) < 0.01, '1 秒音频应算出 1 秒，实际 ' + h.seconds)
  rmSync(dir, { recursive: true, force: true })
})
