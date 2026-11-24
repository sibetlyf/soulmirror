import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  buildMinutesSystemPrompt, buildMinutesUserPrompt, normalizeMinutes,
  finalizeMinutes, minutesMeta, localStamp, CONTENT_SECTIONS, SUMMARY_MAX_CHARS,
} from '../lib/minutes-format.js'

/**
 * 用户对纪要的三条硬要求（都是现场反馈）：
 *   ① 出现英文——全篇要中文，只有专有名词例外；
 *   ② 出现"说话人1/说话人2"——像草稿，不像纪要；
 *   ③ 结构要固定：一 基本信息 / 二 会议主题 / 三 会议内容（4 小点）/ 四 纪要人。
 */

test('结构固定：一、二、三、四 都在提示里，且三下面有四个小节', () => {
  const p = buildMinutesSystemPrompt()
  for (const h of ['## 一、会议基本信息', '## 二、会议主题', '## 三、会议内容', '## 四、纪要人']) {
    assert.ok(p.includes(h), '缺少小节：' + h)
  }
  for (const s of CONTENT_SECTIONS) assert.ok(p.includes(s), '三、会议内容缺少：' + s)
  assert.match(p, /时间[:：]/, '一、要写时间')
  assert.match(p, /地点[:：]/, '一、要写地点')
  assert.match(p, /与会人员[:：]/, '一、要写与会人员')
  assert.match(p, /XXXX会/, '二、要写成"XXXX会"')
  assert.match(p, /纪要人[\s\S]*整理[:：]/, '四、要写谁整理的')
})

test('语言：明确要求简体中文，英文只允许专有名词', () => {
  const p = buildMinutesSystemPrompt()
  assert.match(p, /简体中文/)
  assert.match(p, /禁止整句英文|整句英文/)
  assert.match(p, /产品名|专有名词/, '要说明什么情况下可以保留英文')
})

test('不许出现说话人标签（提示要写，后处理也要真删）', () => {
  assert.match(buildMinutesSystemPrompt(), /不要出现"说话人1"/)
  const raw = [
    '# 会议纪要',
    '## 三、会议内容',
    '- 说话人1：这周先把接口对齐',
    '- [说话人2] 预算要压到 30 万',
    '- Speaker 3: 下周给结论',
    '说话人2：',
    '- 正常条目：没有被改动',
  ].join('\n')
  const out = normalizeMinutes(raw)
  assert.doesNotMatch(out, /说话人\s*\d/)
  assert.doesNotMatch(out, /Speaker\s*\d/i)
  assert.match(out, /这周先把接口对齐/)
  assert.match(out, /预算要压到 30 万/)
  assert.match(out, /正常条目：没有被改动/, '只删标签，不能改内容')
})

test('连续多做几次剥标签也不会把正文吃掉', () => {
  const out = normalizeMinutes('说话人1：说话人2：说话人3：最终结论是下周上线')
  assert.equal(out, '最终结论是下周上线')
})

test('用户消息带上已知会议信息，减少模型瞎填时间地点', () => {
  const u = buildMinutesUserPrompt({
    transcript: '[说话人1] 先说一下进度',
    meta: { title: '产品周会', startedAt: '2026-11-11 10:00', endedAt: '2026-11-11 11:00', author: '李亚峰' },
  })
  assert.match(u, /产品周会/)
  assert.match(u, /2026-11-11 10:00/)
  assert.match(u, /李亚峰/)
  assert.match(u, /说话人N.*不要写进纪要/, '要提醒模型标签只是分轨标记')
})

test('四、纪要人：模型没写就补真实作者与时间，已写就不覆盖', () => {
  const at = '2026-11-11 11:00'
  const missing = finalizeMinutes('# 会议纪要\n\n## 三、会议内容\n- 说了 A', { author: '李亚峰', at })
  assert.match(missing, /## 四、纪要人/)
  assert.match(missing, /整理：李亚峰/)
  assert.match(missing, new RegExp('时间：' + at))

  const written = finalizeMinutes('# 会议纪要\n\n## 四、纪要人\n- 整理：小王\n- 时间：2026-11-11 12:00', { author: '李亚峰', at })
  assert.match(written, /整理：小王/, '模型已经写了就不覆盖')
  assert.doesNotMatch(written, /整理：李亚峰/)

  const empty = finalizeMinutes('# 会议纪要\n\n## 四、纪要人\n- 整理：\n- 时间：', { author: '李亚峰', at })
  assert.match(empty, /整理：李亚峰/, '占位符要补上')
})

test('会议信息只写确定的事实：没有作者时标自动整理，时间用本机时区', () => {
  const m = minutesMeta({ meta: { startedAt: '2026-11-11T02:00:00.000Z', endedAt: '2026-11-11T03:00:00.000Z' }, cfg: {} })
  assert.match(m.author, /SoulMirror|自动整理/)
  assert.match(m.place, /采集/)
  // 本机时区（+08）下应为 10:00 而不是 02:00
  assert.match(m.startedAt, /^2026-11-11 10:00$/)
  assert.match(m.endedAt, /^2026-11-11 11:00$/)
})

test('localStamp 不依赖 UTC', () => {
  const t = Date.parse('2026-01-02T03:04:00.000Z')
  const s = localStamp(t)
  const d = new Date(t)
  assert.equal(s, d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') +
    ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'))
})

test('三条生成路径都指向同一份格式（不再各写一套提示词）', () => {
  const index = readFileSync(new URL('../index.js', import.meta.url), 'utf8')
  const task = readFileSync(new URL('../lib/minutes-task.js', import.meta.url), 'utf8')
  const offline = readFileSync(new URL('../lib/offline-asr.js', import.meta.url), 'utf8')
  assert.match(index, /buildMinutesSystemPrompt\(\)/)
  assert.match(index, /finalizeMinutes\(raw/)
  assert.match(task, /MINUTES_SYSTEM_PROMPT = buildMinutesSystemPrompt\(\)/)
  assert.match(offline, /buildMinutesSystemPrompt\(\)/)
  // 旧的"决议/风险/未决问题"结构必须已经不存在
  for (const src of [index, task, offline]) {
    assert.doesNotMatch(src, /## 决议 \/ ## 待办/, '旧的自由结构还留在提示词里')
  }
})

test('开头必须有 ≤300 字摘要，且模型没给时用正文句子抽（不编造）', () => {
  const src = '# 会议纪要\n\n## 一、会议基本信息\n- 时间：2026-11-13 09:25\n\n## 三、会议内容\n### 1、围绕主题说了什么，问题是什么\n- 决定把生图改成效果优先；张三周五前给对比数据\n- 李四负责补一版日志\n'
  const out = finalizeMinutes(src, { author: '李亚峰', at: '2026-11-13 09:40' })
  assert.match(out, /## 摘要/, '缺摘要时必须补')
  const brief = (/## 摘要\n([\s\S]*?)\n## /.exec(out) || [, ''])[1].trim()
  assert.ok(brief.length > 0, '摘要不能为空')
  assert.ok(brief.length <= SUMMARY_MAX_CHARS, '摘要必须 ≤300 字，实际 ' + brief.length)
  assert.ok(out.indexOf('## 摘要') < out.indexOf('## 一、'), '摘要必须排在基本信息之前')
})

test('混进正文的思考/英文推理段会被剥掉（真实事故回归）', () => {
  const dirty = [
    'This is a second (continuation) meeting transcript, quite garbled. Need to produce Chinese Markdown minutes with decisions.',
    'Let me parse carefully.',
    '',
    '# 会议纪要',
    '',
    '## 一、会议基本信息',
    '- 时间：2026-11-13 09:25',
    '',
    '## 三、会议内容',
    '### 1、围绕主题说了什么，问题是什么',
    '- 决定把生图改成效果优先',
  ].join('\n')
  const out = finalizeMinutes(dirty, { author: '李亚峰', at: '2026-11-13 09:40' })
  assert.equal(/garbled|Let me parse/i.test(out), false, '英文推理段必须被剥掉')
  assert.match(out, /决定把生图改成效果优先/, '正文不能被误删')
  assert.match(out, /## 摘要/, '剥完后仍要有摘要')
})

test('纪要提示词：带上知识库参考与词典，且明确"只用于理解、不照抄成结论"', () => {
  const out = buildMinutesUserPrompt({
    transcript: '说话人1：那个继续做上周的方案',
    meta: { title: '周会' },
    historyBlock: '【历史】上周定了三件事',
    knowledgeBlock: '【知识库参考】站会纪要：周五交付',
    dictionaryBlock: '【词典】飞书：不是飞轮',
  })
  assert.match(out, /知识库参考/, '必须带知识库片段')
  assert.match(out, /不要照抄成结论/, '必须防止模型把参考当结论')
  assert.match(out, /本机词典/, '必须带词典统一写法')
  assert.match(out, /历史/, '历史连续性不能丢')
  assert.match(out, /会议转写/, '转写仍然在最后')
  // 顺序：知识/词典/历史 在转写之前
  assert.ok(out.indexOf('知识库参考') < out.indexOf('会议转写'))
  assert.ok(out.indexOf('本机词典') < out.indexOf('会议转写'))
})

test('重复摘要只留第一段；纯英文脚手架行（Count/Section）必须剥掉', () => {
  const dirty = [
    '# 会议纪要', '', '## 摘要', '本次为任务状态跟进会。', '',
    'Count ~ 250ish. Fine.', '',
    'Section 1: 围绕主题说了什么，问题…', '',
    '## 摘要', '本次会议跟进任务状态与客户端显示问题。', '',
    '## 一、会议基本信息', '- 时间：2026-11-24', '',
    '## 四、纪要人', '- 整理：李亚峰',
  ].join('\n')
  const out = finalizeMinutes(dirty, { author: '李亚峰', at: '2026-11-24 16:31' })
  assert.equal((out.match(/## 摘要/g) || []).length, 1, '摘要只能有一段')
  assert.match(out, /本次为任务状态跟进会/, '保留第一段摘要')
  assert.equal(/Count ~/.test(out), false, '英文脚手架不能进纪要')
  assert.equal(/Section 1:/.test(out), false, 'Section 脚手架不能进纪要')
  assert.match(out, /## 一、会议基本信息/, '正文不能被误删')
})
