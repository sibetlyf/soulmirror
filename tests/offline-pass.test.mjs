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
  // 两条返回路径都必须先计算speaker计数；不绑旧setPostMeeting拼写。
  const pass = src.slice(src.indexOf('async function runOfflinePass'), src.indexOf('async function stopAndOrganize'))
  assert.match(pass, /const speakers = new Set\(/)
  assert.ok(pass.indexOf('const speakers = new Set(') < pass.indexOf('setPostMeeting({ phase:', pass.indexOf('const speakers = new Set(')))
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

test('离线重转写总超时由持久化管线管理，取消传到底层且不回退实时稿', () => {
  assert.match(src, /timeouts:\{offline:Math.max\(60000,Number\(cfg.offlineTimeoutMs\)/)
  const at = src.indexOf('offline: async task =>')
  const body = src.slice(at,src.indexOf('minutes: async task =>',at))
  assert.match(body,/isCancelled:task.isCancelled/)
  assert.match(body,/if \(!r.ok\) throw new Error/)
  assert.doesNotMatch(body,/session.transcript|buildMinutes\(/)
  // 超时/迟到结果不能推进成功的行为见 postmeeting-reliability。
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

test('readWavHeader 只读头部且算得对', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'sm-wav-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
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
