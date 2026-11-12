/**
 * 演练模式产物契约：演练目录必须和真实会议目录同构（audio.wav + meta.json + capture 字段），
 * 这样会后整理/离线转写/纪要对演练目录同样可用；写盘失败必须可见，不能静默。
 *
 * 全部在 mkdtemp 里跑：不联网、不碰设备、不写用户数据目录。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, existsSync, statSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DemoController, DEMO_ASSET } from '../lib/demo.js'
import { parseWav } from '../lib/sources.js'
import { inspectRecord } from '../lib/recordings.js'

function tempRoot() {
  return mkdtempSync(join(tmpdir(), 'soulmirror-demo-'))
}

test('演练落盘：audio.wav 是 16k/16bit/单声道，meta.json 标 demo:true 且 capture.bytes 与文件一致', async () => {
  assert.ok(existsSync(DEMO_ASSET), '内置演练音频应存在：' + DEMO_ASSET)
  const root = tempRoot()
  const demo = new DemoController({ root })
  try {
    // 用公共入口 start()：不需要设备/网络；即时 stop() 让断言不受转写节奏影响
    const started = await demo.start({ speed: 20 })
    assert.equal(started.error, '', '演练启动不应有错误')
    assert.equal(started.demo, true)
    assert.equal(started.running, true)
    const dir = demo.dir
    assert.ok(dir && dir.startsWith(root), '演练目录必须在临时根目录里：' + dir)

    // 1) audio.wav 真的落盘了，而且是录音同一格式
    const wavPath = join(dir, 'audio.wav')
    assert.ok(existsSync(wavPath), '演练目录缺 audio.wav')
    const size = statSync(wavPath).size
    assert.ok(size > 0, 'audio.wav 字节数应大于 0')
    const wav = parseWav(readFileSync(wavPath))
    assert.equal(wav.rate, 16000)
    assert.equal(wav.channels, 1)
    assert.equal(wav.bits, 16)
    assert.ok(wav.pcm.length > 0)

    // 2) 结束一次演练，收尾信息按真实会议的 meta.capture 形状写
    const stopped = await demo.stop()
    assert.equal(stopped.finished, true)
    assert.equal(stopped.running, false)

    const metaPath = join(dir, 'meta.json')
    assert.ok(existsSync(metaPath), '演练目录缺 meta.json')
    const meta = JSON.parse(readFileSync(metaPath, 'utf8'))
    assert.equal(meta.demo, true, 'meta.demo 必须是 true（界面据此区分演练与真实）')
    assert.equal(meta.source, 'demo')
    assert.equal(meta.audioBytes, size)
    assert.ok(meta.capture && typeof meta.capture === 'object', 'meta.capture 必须存在且与真实会议同形')
    assert.equal(meta.capture.bytes, size, 'meta.capture.bytes 必须等于实际 audio.wav 字节数')
    assert.ok(Number(meta.capture.durationSec) > 0, 'capture.durationSec 应来自真实音频时长')
    assert.ok(meta.endedAt, 'endedAt 应写入')

    // 3) snapshot 里的演练字段也要对得上（界面读的是这一份）
    const snap = demo.snapshot()
    assert.equal(snap.demo, true)
    assert.equal(snap.audioBytes, size)
    assert.equal(snap.audioPath, wavPath)
    assert.equal(snap.dir, dir)
    assert.equal(snap.error, '')

    // 4) 这个目录已经是"可整理"的（inspectRecord 是录音清单/整理按钮的判定入口）
    const rec = inspectRecord(dir)
    assert.equal(rec.ok, true, '演练目录应可整理：' + (rec.message || rec.reason))
    assert.equal(rec.wavBytes, size)
    assert.ok(rec.seconds > 0)
    assert.equal(rec.meta && rec.meta.demo, true)
  } finally {
    await demo.stop().catch(() => {})
    rmSync(root, { recursive: true, force: true })
  }
})

test('演练落盘失败必须可见：目录不可写时 snapshot().error 非空，且没有假装写入成功', async () => {
  const root = tempRoot()
  try {
    // 用一个普通文件当父路径：mkdirSync/writeFileSync 都会失败（ENOTDIR/ENOENT），不依赖 ACL
    const blocker = join(root, 'not-a-dir')
    writeFileSync(blocker, 'x')
    const demo = new DemoController({ root: join(blocker, 'sub') })
    try {
      const started = await demo.start({ speed: 20 })
      const snap = demo.snapshot()
      assert.ok(snap.error && snap.error.length > 0, '写盘失败必须出现在 snapshot().error 里，不能静默')
      assert.match(snap.error, /演练音频落盘失败|演练 meta\.json 写入失败/, '错误要带阶段：' + snap.error)
      assert.equal(snap.audioBytes, 0, '没写成功就不能报音频字节数')
      assert.equal(started.audioBytes, 0)
      assert.equal(snap.demo, true, '演练标识不因为写盘失败而丢失')
      // 目录没被创建出来，也就不存在"看起来能整理"的假象
      assert.equal(existsSync(join(blocker, 'sub')), false)
    } finally {
      await demo.stop().catch(() => {})
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('演练跑完整一轮：转写行带 demo:true 落盘，收尾后 meta 有 endedAt 且目录可整理', async () => {
  const root = tempRoot()
  const demo = new DemoController({ root })
  try {
    await demo.start({ speed: 100, maxSeconds: 30 })
    const deadline = Date.now() + 10000
    while (!demo.finished && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50))
    assert.equal(demo.finished, true, '演练应在 10 秒内自然结束')
    assert.equal(demo.running, false)
    assert.ok(demo.transcript.length > 0, '演练应产出转写句')
    assert.ok(demo.transcript.every((line) => line.demo === true), '演练转写行必须带 demo:true')

    // transcript.jsonl 与真实会议同形，且每行标 demo
    const lines = readFileSync(join(demo.dir, 'transcript.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map((s) => JSON.parse(s))
    assert.equal(lines.length, demo.transcript.length)
    assert.ok(lines.every((line) => line.demo === true && line.text))
    assert.match(demo.dir, /[\\/]\d{4}-\d{2}-\d{2}T/)

    const meta = JSON.parse(readFileSync(join(demo.dir, 'meta.json'), 'utf8'))
    assert.ok(meta.endedAt, '自然收尾也要有 endedAt')
    assert.equal(meta.demo, true)
    assert.ok(Number(meta.capture.durationSec) > 0)
    assert.equal(meta.capture.bytes, statSync(join(demo.dir, 'audio.wav')).size)
    assert.equal(demo.snapshot().banner, '')

    const rec = inspectRecord(demo.dir)
    assert.equal(rec.ok, true)
    assert.ok(rec.seconds > 0)
  } finally {
    await demo.stop().catch(() => {})
    rmSync(root, { recursive: true, force: true })
  }
})
