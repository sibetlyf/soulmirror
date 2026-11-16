/**
 * 分段文件识别的回归测试（用户真实事故：412MB 录音直接 throw，整场会后整理失败）。
 *
 * 用真实 WAV（临时文件）+ 注入的 extract/transcribe/remove，不联网、不真实音频。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { transcribeInChunks } from '../lib/offline-chunked.js'

/** 造一个 16k/16bit/单声道的真 WAV（静音），返回路径与秒数 */
function makeWav(dir, seconds) {
  const pcmBytes = Math.round(seconds * 32000)
  const header = Buffer.alloc(44)
  header.write('RIFF', 0, 'ascii')
  header.writeUInt32LE(36 + pcmBytes, 4)
  header.write('WAVE', 8, 'ascii')
  header.write('fmt ', 12, 'ascii')
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(16000, 24)
  header.writeUInt32LE(32000, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36, 'ascii')
  header.writeUInt32LE(pcmBytes, 40)
  const p = join(dir, 'audio.wav')
  writeFileSync(p, Buffer.concat([header, Buffer.alloc(pcmBytes)]))
  return p
}

test('超长录音：切成多段、时间加偏移、失败段留可见断点、临时文件清理', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sm-chunk-'))
  try {
    const wav = makeWav(dir, 180)          // 180 秒
    const chunkBytes = 32000 * 60          // 每段约 60 秒 → 3 段
    const extracted = []
    const removed = []
    const result = await transcribeInChunks({
      wav, dir, key: 'k', chunkBytes,
      extract: async ({ startSec, endSec, dst }) => { extracted.push({ startSec, endSec, dst }); writeFileSync(dst, 'x') },
      transcribe: async ({ fileName }) => {
        if (fileName.includes('part-1')) throw new Error('模拟第 2 段失败')
        return { sentences: [{ text: '一段话', begin: 1000, end: 2000, speaker: '说话人1' }] }
      },
      remove: async (p) => { removed.push(p) },
    })
    assert.equal(result.segs, 3, '180 秒按 60 秒切应为 3 段')
    assert.equal(extracted.length, 3, '每段都要真的切出来')
    assert.equal(removed.length, 3, '三段临时文件都必须清理')
    assert.equal(result.failed, 1, '第 2 段失败要计数')
    // 第 1 段：begin 1000 + 0；第 3 段：begin 1000 + 120*1000
    const normal = result.lines.filter((x) => !x.gap)
    assert.equal(normal.length, 2)
    assert.equal(normal[0].begin, 1000)
    assert.equal(normal[1].begin, 121000, '第 3 段的时间必须加 120 秒偏移')
    const gap = result.lines.find((x) => x.gap)
    assert.ok(gap, '失败段必须留可见断点')
    assert.match(gap.text, /第 2 段识别失败/)
    assert.equal(gap.begin, 60000, '断点从第 2 段起点开始')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('未超限时只走一段（segs=1），行为与单段一致', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sm-chunk-one-'))
  try {
    const wav = makeWav(dir, 30)           // 30 秒
    const removed = []
    const r = await transcribeInChunks({
      wav, dir, key: 'k', chunkBytes: 32000 * 120,   // 上限 120 秒 > 30 秒
      extract: async ({ dst }) => { writeFileSync(dst, 'x') },
      transcribe: async () => ({ sentences: [{ text: '只有一句', begin: 0, end: 1000 }] }),
      remove: async (p) => { removed.push(p) },
    })
    assert.equal(r.segs, 1)
    assert.equal(r.failed, 0)
    assert.equal(r.lines.length, 1)
    assert.equal(r.lines[0].begin, 0, '唯一一段不加偏移')
    assert.equal(removed.length, 1)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
