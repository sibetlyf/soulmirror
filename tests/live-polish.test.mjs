/**
 * 实时润色编排 + 延迟统计的单测（纯逻辑，不联网、不碰设备）。
 */
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import { record, summary, describe, quantile, emptyLatency, LATENCY_WINDOW } from '../lib/latency.js'
import {
  POLISH_MODES, BASE_RULES, routeMode, shouldPolishNow, buildPolishRequest, cleanPolished,
} from '../lib/live-polish.js'

// ── 延迟统计 ────────────────────────────────────────────────────────────────
test('延迟：p50/p95/max 计算正确，样本不足返回 null', () => {
  assert.equal(quantile([], 0.5), null, '没有样本不能假装有结论')
  assert.equal(quantile([10], 0.95), 10)
  assert.equal(quantile([10, 20, 30, 40], 0.5), 25)
  assert.equal(quantile([10, 20, 30, 40], 0.95), 39)
})

test('延迟：按通道记录，环形窗口不无限增长', () => {
  let s = emptyLatency()
  for (let i = 1; i <= LATENCY_WINDOW + 50; i++) s = record(s, 'polish', i)
  const sum = summary(s)
  assert.ok(sum.polish, '要有 polish 通道')
  assert.equal(sum.polish.n, LATENCY_WINDOW, '只能保留窗口内的样本')
  assert.ok(sum.polish.max <= LATENCY_WINDOW + 50)
  assert.match(describe(s), /p50=/)
  // 多通道互不影响
  s = record(s, 'asr.firstLine', 300)
  assert.ok(summary(s)['asr.firstLine'])
})

// ── 多模式路由 ──────────────────────────────────────────────────────────────
test('模式路由：待办/要点/术语/默认各归其位，强制模式优先', () => {
  assert.equal(routeMode('帮我记一下明天交周报').id, 'tasks')
  assert.equal(routeMode('总结一下今天的三点').id, 'minutes')
  assert.equal(routeMode('这个叫飞书不是飞轮').id, 'term')
  assert.equal(routeMode('今天天气不错我们继续开会').id, 'polish')
  assert.equal(routeMode('随便什么', { forced: 'term' }).id, 'term')
  assert.equal(routeMode('随便什么', { forced: '不存在的模式' }).id, 'polish', '非法模式退回默认')
})

// ── 低延迟门控 ──────────────────────────────────────────────────────────────
test('门控：太短/没稳定/冷却中/内容没变 都不润', () => {
  const base = { text: '这是一句正常长度的话', stableMs: 900, now: 10000, lastPolishAt: 0 }
  assert.equal(shouldPolishNow(base).ok, true)
  assert.equal(shouldPolishNow({ ...base, text: '短' }).why, 'too-short')
  assert.equal(shouldPolishNow({ ...base, stableMs: 200 }).why, 'not-stable')
  assert.equal(shouldPolishNow({ ...base, lastPolishAt: 9500 }).why, 'cooldown')
  assert.equal(shouldPolishNow({ ...base, lastPolished: base.text }).why, 'unchanged')
})

// ── 提示词装配 ──────────────────────────────────────────────────────────────
test('提示词：静态层含硬规则+任务+风格/人格/词典，动态层含上下文与知识，分层预算生效', () => {
  const req = buildPolishRequest({
    text: '这个这个我们明天再说一遍那个方案',
    mode: 'polish',
    dictionaryBlock: '【词典】飞书：不是飞轮',
    styleBlock: '【风格包】简洁，不要形容词',
    personaBlock: '【人格】说话直接',
    contextBlock: '【最近上下文】上一句在讲排期',
    knowledgeBlock: '【知识库参考】站会纪要：周五交付',
  })
  assert.match(req.system, /不是助手/, '硬规则必须在')
  assert.match(req.system, /飞书/, '词典在静态层')
  assert.match(req.system, /风格包/, '风格包在静态层')
  assert.match(req.system, /人格/, '人格在静态层')
  assert.match(req.user, /最近上下文/, '上下文在动态层')
  assert.match(req.user, /知识库参考/, '知识在动态层')
  assert.match(req.user, /待加工文本/, '转写层在 user')
  assert.ok(req.report.total > 0)
  // 硬规则里必须写死"不回答、不执行"
  assert.match(BASE_RULES, /不回答/)
  assert.match(BASE_RULES, /不执行/)
})

test('输出清理：去围栏、去开场白、去"好的，"', () => {
  assert.equal(cleanPolished('```text\n整理后的句子\n```'), '整理后的句子')
  assert.equal(cleanPolished('以下是整理后的文本：\n我们要开会'), '我们要开会')
  assert.equal(cleanPolished('好的，今天的排期是三号'), '今天的排期是三号')
  assert.equal(cleanPolished('   '), '', '空输出保持空（不许假装成功）')
  assert.match(POLISH_MODES.polish.instruction, /只输出整理后的文本/)
})

test('wiring：润色接进 session 且默认关闭、延迟进 /status', () => {
  const sess = readFileSync(new URL('../lib/session.js', import.meta.url), 'utf8')
  const idx = readFileSync(new URL('../index.js', import.meta.url), 'utf8')
  // 方法存在且用纯函数拼提示词
  assert.match(sess, /async _polishLine\(item\)/, 'session 必须有 _polishLine')
  assert.match(sess, /buildPolishRequest\(/, '必须用分层装配拼提示词')
  assert.match(sess, /cleanPolished\(/, '输出必须清理')
  // 未开启不产生模型调用
  assert.match(idx, /polish: z\.object\(/, '必须有 polish 配置')
  assert.match(idx, /enabled: z\.boolean\(\)\.default\(false\)/, '润色默认关闭')
  assert.match(idx, /polishComplete: cfg\.polish\?\.enabled \? makeDshCompleter/, '未开启不注入 completer')
  // 润色失败不能盖掉原文
  assert.match(sess, /润色失败（保留原文）/, '失败必须保留原文并可见')
  // /status 暴露延迟
  assert.match(idx, /latency: \(\(\) => \{/, '/status 必须暴露 latency')
  assert.match(idx, /latencyDescribe\(session\.latency\)/)
})

test('partial 即时润色：门控更紧、失败保留原文、延迟独立计数', () => {
  const sess = readFileSync(new URL('../lib/session.js', import.meta.url), 'utf8')
  assert.match(sess, /async _polishPartial\(text\)/, '必须有 partial 润色方法')
  assert.match(sess, /polish\.partial/, '延迟通道要独立记为 polish.partial')
  assert.match(sess, /inflight/, '必须防重入（上一句还没回来就别再发）')
  assert.match(sess, /partial 润色跳过（保留原始 partial）/, '失败必须保留原文')
  // partial 更新处必须触发它
  assert.match(sess, /this\.partial = fixed[\s\S]{0,400}_polishPartial\(fixed\)/, 'partial 更新要触发润色')
  // 整句落盘时清空 partial 润色缓存
  assert.match(sess, /this\.partialPolished = ''/, '整句落盘要清 partial 缓存')

  // 门控参数通过配置控制
  const idx = readFileSync(new URL('../index.js', import.meta.url), 'utf8')
  assert.match(idx, /partialCooldownMs: z\.number\(\)\.default\(800\)/, 'partial 冷却默认 800ms')
  assert.match(idx, /partialMinChars: z\.number\(\)\.default\(4\)/, 'partial 起步默认 4 字')
  assert.match(idx, /partialStableMs: z\.number\(\)\.default\(500\)/, 'partial 稳定阈值默认 500ms')
})
