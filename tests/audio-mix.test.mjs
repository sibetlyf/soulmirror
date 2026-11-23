/**
 * PcmMixer 的单元测试（此前没有专测，这是补的）。
 *
 * 真实事故：界面报「混音丢弃 3200 字节：麦克风那一路过慢或中断（累计 21760 字节）」，
 * 也就是持续丢用户自己的发言。根因：mbridge 的 device 模式按**秒级块**交付，
 * 而混音器的落后容差只有 1 秒 → 每块到达时都刚好超出，反复清积压。
 *
 * 这里把两种交付形态都钉住：块级到达（不许丢）与真的停掉（必须丢且能继续出流）。
 * 全是纯内存计算，不碰设备、不联网。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PcmMixer, BYTES_PER_MS } from '../lib/audio-mix.js'

/** 造一段可辨识的 PCM：值等于 base（便于断言两路确实混进来） */
function pcm(bytes, base) {
  const n = bytes / 2
  const buf = Buffer.alloc(bytes)
  for (let i = 0; i < n; i++) buf.writeInt16LE(base, i * 2)
  return buf
}

test('两路匀速交错：不丢任何字节，输出是两路混音', () => {
  const m = new PcmMixer()
  const chunk = BYTES_PER_MS * 500          // 每 0.5 秒一块
  const n = 4
  for (let i = 0; i < n; i++) {
    m.push('a', pcm(chunk, 100))
    m.push('b', pcm(chunk, 40))
  }
  const out = m.pull(chunk * n)
  assert.ok(out, '数据够时应能取出')
  const st = m.stats()
  assert.equal(st.dropped, 0, '匀速交付不应丢字节')
  assert.equal(st.pulledBytes, chunk * n)
  // 混音 = 100 + 40
  assert.equal(out.readInt16LE(0), 140)
})

test('块级交付（一路比另一路晚 1 秒多）：容差覆盖后不再丢（回归真事故）', () => {
  const m = new PcmMixer()
  const sec = BYTES_PER_MS * 1000
  // 环回每 1 秒来 1 块；麦克风也每 1 秒来 1 块，但比环回晚 1.2 秒（历史容差 1s 会丢）
  m.push('a', pcm(sec, 100))
  m.push('a', pcm(sec, 100))
  m.push('b', pcm(sec, 40))                  // 麦克风第 1 块（晚 1.2 秒）
  assert.equal(m.stats().dropped, 0, '1.2 秒的块级落后不许被判为掉线')
  m.push('a', pcm(sec, 100))
  m.push('b', pcm(sec, 40))
  m.push('b', pcm(sec, 40))
  assert.equal(m.stats().dropped, 0, '持续块级交付也不许丢')
})

test('一路被判停掉（setActive=false）：另一路继续出流并补静音记账', () => {
  const m = new PcmMixer()
  const sec = BYTES_PER_MS * 1000
  // 麦克风路被判停掉（真实链路里由 session 侧判定后调用 setActive）
  m.setActive('b', false)
  m.push('a', pcm(sec, 100))
  const out = m.pull(sec)
  assert.ok(out, '单路时仍要能出流（不能卡住）')
  assert.equal(out.readInt16LE(0), 100, '另一路缺席时按静音补位，值保持 100')
  const st = m.stats()
  assert.ok(st.singleSidePulls >= 1 || st.paddedPulls >= 1, '应记录"单路/补位"次数')
  assert.equal(st.dropped, 0, '只缺席不算丢，丢是"有积压被清掉"')
})

test('一路积压过深（超过缓冲上限）：丢最旧的并计入 dropped，不越界', () => {
  const m = new PcmMixer({ maxBufferedBytes: BYTES_PER_MS * 1500 })
  const sec = BYTES_PER_MS * 1000
  // 麦克风先灌 5 秒（超过 1.5 秒上限）
  for (let i = 0; i < 5; i++) m.push('b', pcm(sec, 40))
  const st = m.stats()
  assert.ok(st.dropped > 0, '超限必须丢最旧的并记账')
  assert.ok(st.droppedB > 0, '账要记到具体哪一路（麦克风）')
  // 缓冲不会无限增长
  assert.ok(st.bufferedB <= BYTES_PER_MS * 1500, '缓冲应按上限截断，实际 ' + st.bufferedB)
})
