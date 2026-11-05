import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/**
 * 4GB 堆爆掉的第二次事故。
 *
 * 已排除的：离线重转写（已移到独立 dsh 子进程）。
 * 现在做两件事：
 *   1) 让"到底什么在涨"可观测（/status.mem + 计数器）
 *   2) 接近上限时优雅停止采集，而不是让 V8 抛 FATAL ERROR 把宿主带走
 *   3) 判定会话定期轮换（它是普通 DSH 会话，历史会常驻内存）
 */

const src = readFileSync(new URL('../index.js', import.meta.url), 'utf8')

test('有内存快照与阈值判断，且默认取堆上限的 80%', () => {
  assert.match(src, /function memSnapshot\(\)/, '缺少 memSnapshot')
  assert.match(src, /heap_size_limit/, '应基于真实堆上限而不是写死数字')
  assert.match(src, /\* 0\.8\)/, '默认阈值应为堆上限的 80%')
  assert.match(src, /memLimitMb/, '阈值应可配置')
})

test('接近上限时优雅停止采集并写入可见原因', () => {
  const at = src.indexOf('function memSnapshot()')
  const seg = src.slice(at, at + 2200)
  assert.match(seg, /mem\.heapMb >= memLimitMb/, '缺少阈值比较')
  assert.match(seg, /stopCapture/, '应停止采集而不是等它崩')
  assert.match(seg, /已停止采集以保护/, '应给用户留一条可读的原因')
})

test('/status 暴露内存水位与可能增长的计数器', () => {
  assert.match(src, /mem: \(function/, '缺少 /status.mem')
  const at = src.indexOf('mem: (function')
  const seg = src.slice(at, at + 700)
  assert.match(seg, /heapMb/, '应报 heapMb')
  assert.match(seg, /peakMb|memPeakMb/, '应报峰值')
  assert.match(seg, /transcriptLines/, '应报转写行数')
  assert.match(seg, /judgementTurns/, '应报判定会话轮数')
})

test('判定会话会定期轮换（否则历史在内存里无限增长）', () => {
  const at = src.indexOf('async function ensureJudgementSession')
  assert.ok(at > 0, '找不到 ensureJudgementSession')
  const seg = src.slice(at, at + 1400)
  assert.match(seg, /judgementTurns >=/, '缺少轮数上限')
  assert.match(seg, /judgementMaxAgeMs|45 \* 60 \* 1000/, '缺少时间上限')
  assert.match(seg, /judgementTurns = 0/, '轮换后要清零计数')
})

test('计数确实在每次判定后累加', () => {
  assert.match(src, /judgementTurns \+= 1/, '没有累加，轮换就永不触发')
})
