import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  buildMinutesTaskPrompt, writeMinutesSource, readMinutesResult, resetMinutesOutput,
  shouldUseBackgroundTask, TASK_FILES,
} from '../lib/minutes-task.js'

/**
 * 纪要走 DSH 后台任务。
 *
 * 背景：纪要原来在主会话里写，和逐句判定共用闸门（maxPending=2、合并、120s 超时），
 * 被合并/超时后静默退化成"原文节选"——用户看到的就是"纪要啥都没有"。
 * 现在改成：转写落文件 → 起 headless 后台任务读文件、写纪要 → 主进程只读结果。
 */

const dir = () => mkdtempSync(join(tmpdir(), 'sm-minutes-task-'))

test('提示词要求"只读指定文件、只写指定文件、不要提问"', () => {
  const p = buildMinutesTaskPrompt({
    transcriptPath: 'C:/m/source.txt',
    outputPath: 'C:/m/out.md',
    title: '周会',
  })
  assert.match(p, /不要提问/)
  assert.match(p, /读取转写文件：C:\/m\/source\.txt/)
  assert.match(p, /写到文件：C:\/m\/out\.md/)
  assert.match(p, /除了这个文件，不要创建或修改任何其它文件/)
  assert.match(p, /只依据转写文件内容，不要编造/)
  assert.match(p, /会议标题：周会/)
  // 结构要齐全：决议/待办/风险/未决
  for (const sec of ['## 一句话结论', '## 决议', '## 待办', '## 风险与阻塞', '## 未决问题']) {
    assert.ok(p.includes(sec), '缺少小节：' + sec)
  }
})

test('转写写进文件（避免命令行长度限制）', () => {
  const d = dir()
  try {
    const r = writeMinutesSource({ dir: d, lines: ['说话人1：第一句', '  ', '说话人2：第二句'] })
    assert.equal(r.sentences, 2, '空行应被剔除')
    const text = readFileSync(join(d, TASK_FILES.transcript), 'utf8')
    assert.match(text, /第一句/)
    assert.equal(existsSync(join(d, TASK_FILES.transcript)), true)
    assert.ok(r.chars > 0)
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('读结果：没有文件 → 明确失败', () => {
  const d = dir()
  try {
    const r = readMinutesResult({ dir: d })
    assert.equal(r.ok, false)
    assert.match(r.error, /没有产出/)
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('读结果：空文件 / 过短 → 仍算失败（不许当成功）', () => {
  const d = dir()
  try {
    writeFileSync(join(d, TASK_FILES.output), '   ', 'utf8')
    assert.equal(readMinutesResult({ dir: d }).ok, false)

    writeFileSync(join(d, TASK_FILES.output), '## 决议\n无\n', 'utf8')
    const short = readMinutesResult({ dir: d, minChars: 80 })
    assert.equal(short.ok, false)
    assert.match(short.error, /过短/)
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('读结果：正常纪要 → 通过，并剥掉代码围栏', () => {
  const d = dir()
  try {
    const body = '## 一句话结论\n这次会确认了三条\n\n## 决议\n- 先做 A\n\n## 待办（负责人 · 时间）\n- 张三 · 出原型 · 周四\n\n## 风险与阻塞\n无\n\n## 未决问题\n- 预算还没定，需要再确认一次才能推进下一步'
    writeFileSync(join(d, TASK_FILES.output), '```markdown\n' + body + '\n```\n', 'utf8')
    const r = readMinutesResult({ dir: d })
    assert.equal(r.ok, true)
    assert.match(r.markdown, /^## 一句话结论/)
    assert.equal(r.markdown.includes('```'), false, '应剥掉围栏')
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('清掉旧产物：避免把上一次的纪要当成这次结果', () => {
  const d = dir()
  try {
    writeFileSync(join(d, TASK_FILES.output), '旧纪要内容', 'utf8')
    resetMinutesOutput(d)
    assert.equal(readMinutesResult({ dir: d }).ok, false, '清掉后应读不到内容')
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('开关：默认走后台任务，可显式关闭（没有 dsh 可执行文件时也不走）', () => {
  assert.equal(shouldUseBackgroundTask({}), true)
  assert.equal(shouldUseBackgroundTask({ minutesViaDsh: false }), false)
  assert.equal(shouldUseBackgroundTask({ dshBin: false }), false)
})
