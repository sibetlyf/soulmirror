import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync, statSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  readWavInfo, scanAudioLevels, rms16, extractRangeToWav, planOfflineUpload, explainOfflineError,
  DEFAULT_SILENCE_RMS,
} from '../lib/offline-audio.js'

/**
 * 会后重转写的音频预处理。
 *
 * 为什么要它：整段静音上传会得到 SUCCESS_WITH_NO_VALID_FRAGMENT
 * ——名字像成功，其实一个字没识别，还白花流量。
 * 另外会议录音常有"前面十分钟没人说话、结尾拖一段空场"。
 */

const SR = 16000
const BYTES_PER_SEC = SR * 2   // 16bit 单声道

/** 造一个 wav：plain = 有声段，silent = 静音段 */
function makeWav(dir, { silentSec = 0, loudSec = 0, amp = 0.3 } = {}) {
  const data = Buffer.alloc((silentSec + loudSec) * BYTES_PER_SEC)
  let o = silentSec * BYTES_PER_SEC
  for (let i = 0; i < loudSec * SR; i++) {
    const v = Math.round(Math.sin((2 * Math.PI * 440 * i) / SR) * amp * 32767)
    data.writeInt16LE(v, o)
    o += 2
  }
  const head = Buffer.alloc(44)
  head.write('RIFF', 0, 'ascii')
  head.writeUInt32LE(36 + data.length, 4)
  head.write('WAVE', 8, 'ascii')
  head.write('fmt ', 12, 'ascii')
  head.writeUInt32LE(16, 16)
  head.writeUInt16LE(1, 20)
  head.writeUInt16LE(1, 22)
  head.writeUInt32LE(SR, 24)
  head.writeUInt32LE(SR * 2, 28)
  head.writeUInt16LE(2, 32)
  head.writeUInt16LE(16, 34)
  head.write('data', 36, 'ascii')
  head.writeUInt32LE(data.length, 40)
  const file = join(dir, 'a-' + silentSec + '-' + loudSec + '.wav')
  writeFileSync(file, Buffer.concat([head, data]))
  return file
}

const tmp = () => mkdtempSync(join(tmpdir(), 'sm-offline-audio-'))

test('读 WAV 头：采样率/声道/数据长度', () => {
  const d = tmp()
  try {
    const f = makeWav(d, { loudSec: 2 })
    const info = readWavInfo(f)
    assert.equal(info.ok, true)
    assert.equal(info.sampleRate, SR)
    assert.equal(info.channels, 1)
    assert.equal(info.dataOffset, 44)
    assert.equal(info.dataSize, 2 * BYTES_PER_SEC)
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('非 WAV 文件不崩，返回 ok:false', async () => {
  const d = tmp()
  try {
    const f = join(d, 'x.wav')
    writeFileSync(f, Buffer.from('not a wav at all'))
    assert.equal(readWavInfo(f).ok, false)
    const s = await scanAudioLevels(f)
    assert.equal(s.ok, false)
    assert.match(s.error, /WAV/)
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('扫描：纯静音 → silentRatio 接近 1', async () => {
  const d = tmp()
  try {
    const f = makeWav(d, { silentSec: 4 })
    const s = await scanAudioLevels(f)
    assert.equal(s.ok, true)
    assert.ok(s.silentRatio > 0.95, '实际 ' + s.silentRatio)
    assert.ok(s.peakRms < DEFAULT_SILENCE_RMS)
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('扫描：静音→有声→静音，能找到有声区间', async () => {
  const d = tmp()
  try {
    // 3s 静音 + 6s 有声；先造"前静后响"，再单独测"两边静"
    const f1 = makeWav(d, { silentSec: 3, loudSec: 6 })
    const s1 = await scanAudioLevels(f1)
    assert.equal(s1.ok, true)
    assert.ok(s1.firstLoudSec >= 2 && s1.firstLoudSec <= 4, '起点应约在 3s，实际 ' + s1.firstLoudSec)
    assert.ok(s1.lastLoudSec > s1.firstLoudSec)

    // 两端静音：静音 2 + 有声 4 + 静音 2 → 用两段拼接模拟
    const a = makeWav(d, { silentSec: 2, loudSec: 4 })
    const b = makeWav(d, { silentSec: 2 })
    const bufA = readFileSync(a)
    const bufB = readFileSync(b)
    const data = Buffer.concat([bufA.subarray(44), bufB.subarray(44)])
    const head = Buffer.from(bufA.subarray(0, 44))
    head.writeUInt32LE(36 + data.length, 4)
    head.writeUInt32LE(data.length, 40)
    const both = join(d, 'both.wav')
    writeFileSync(both, Buffer.concat([head, data]))
    const s2 = await scanAudioLevels(both)
    assert.ok(s2.firstLoudSec >= 1.5 && s2.firstLoudSec <= 3.5, '实际 ' + s2.firstLoudSec)
    assert.ok(s2.lastLoudSec < s2.durationSec - 1, '结尾应被识别为静音')
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('rms16 计算正常（0~1）', () => {
  const buf = Buffer.alloc(4)
  buf.writeInt16LE(16384, 0)
  buf.writeInt16LE(-16384, 2)
  const r = rms16(buf)
  assert.ok(r > 0.4 && r < 0.6, '实际 ' + r)
})

test('裁剪：只写有声区间，头部长度正确', async () => {
  const d = tmp()
  try {
    const src = makeWav(d, { silentSec: 3, loudSec: 5 })
    const dst = join(d, 'cut.wav')
    const r = await extractRangeToWav({ src, dst, startSec: 3, endSec: 8 })
    assert.ok(statSync(dst).size > 0)
    assert.equal(Math.round(r.seconds), 5)
    const info = readWavInfo(dst)
    assert.equal(info.dataSize, r.bytes)
    assert.equal(info.dataSize + 44, statSync(dst).size, '文件大小应与头里写的一致')
    // 裁出来的应该开头就有声
    const s = await scanAudioLevels(dst)
    assert.ok(s.silentRatio < 0.2, '裁完应几乎全程有声，实际静音占比 ' + s.silentRatio)
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('决策：几乎全静音 → 跳过（别白传）', () => {
  const p = planOfflineUpload({ ok: true, silentRatio: 0.995, firstLoudSec: 0, lastLoudSec: 0, durationSec: 600 })
  assert.equal(p.action, 'skip')
  assert.match(p.reason, /没有人声/)
})

test('决策：有声区间太短 → 跳过', () => {
  const p = planOfflineUpload({ ok: true, silentRatio: 0.5, firstLoudSec: 100, lastLoudSec: 103, durationSec: 600 }, { minKeepSec: 10 })
  assert.equal(p.action, 'skip')
  assert.match(p.reason, /太短/)
})

test('决策：整段有声 → 不裁', () => {
  const p = planOfflineUpload({ ok: true, silentRatio: 0.02, firstLoudSec: 0.5, lastLoudSec: 599, durationSec: 600 })
  assert.equal(p.action, 'full')
})

test('决策：两头静音 → 只传有声区间并说明省了多少', () => {
  const p = planOfflineUpload({ ok: true, silentRatio: 0.4, firstLoudSec: 200, lastLoudSec: 400, durationSec: 600 })
  assert.equal(p.action, 'trim')
  assert.ok(p.startSec <= 200)
  assert.ok(p.endSec >= 400)
  assert.match(p.reason, /省 \d+% 流量/)
})

test('错误翻译：无有效语音要说人话', () => {
  assert.match(explainOfflineError('识别失败：{"code":"SUCCESS_WITH_NO_VALID_FRAGMENT"}'), /没识别出任何语音/)
  assert.match(explainOfflineError('401 Unauthorized'), /Key 无效/)
  assert.match(explainOfflineError('getaddrinfo ENOTFOUND'), /网络不通/)
})
