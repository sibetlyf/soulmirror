import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/**
 * 两个"在界面上找不到"的问题：
 *
 *  ① 总开关只在设置页里，面板上只有一个录音按钮——
 *     用户打开侧栏后找不到"开会要不要自动检测"的开关。
 *  ② 想先打开会议软件再入会，面板上只有「入会」，没有「打开软件」。
 *
 * 这里守住：开关就在面板状态卡里（且带 role=switch），
 * 「打开软件」走与 meeting_open 工具同一个宿主实现，不是另一套。
 */

const client = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
const host = readFileSync(new URL('../index.js', import.meta.url), 'utf8')

test('面板状态卡里就有总开关，且是无障碍的 switch', () => {
  assert.match(client, /function toggleEnabled\(currentlyOn\)/, '应有统一的开关动作')
  assert.match(client, /role: 'switch'/, '开关要有 role=switch（不能只是一个彩色按钮）')
  assert.match(client, /'aria-checked': v\.enabled/, '开关要如实反映当前状态')
  assert.match(client, /toggleEnabled\(v\.enabled\)/, '点击要按当前状态切换')
  assert.match(client, /会议助手：开|会议助手：关/, '开关上要写字，不能只有颜色')
  assert.match(client, /action: want \? 'start' : 'off'/, '关闭走 off、开启走 start')
  // 连点与延迟：必须有请求序号丢弃旧响应，并用服务端已落盘的 enabled 立即对齐
  assert.match(client, /var toggleSeq = 0/, '开关请求要有序号')
  assert.match(client, /if \(seq !== toggleSeq\) return/, '旧响应不能覆盖新状态')
  assert.match(client, /live\.set\(\{ view: view, enabled: nowOn \}\)/, '要用已确认的值立即更新界面')
})

test('关掉时要说清后果：不自动检测、不录音', () => {
  assert.match(client, /不会自动检测，也不会录音/)
  assert.match(client, /检测到会议自动录音（不自动入会）/, '开启时也要说明不会自动入会')
})

test('「打开软件」：面板按钮与 meeting_open 工具共用同一个宿主实现', () => {
  assert.match(client, /\/api\/soulmirror\/open/, '面板要能请求启动会议软件')
  assert.match(client, /'打开软件'/, '按钮上要写清楚')
  assert.match(host, /async function openMeetingClient\(appName = ''\)/, '宿主应有一个共享实现')
  assert.match(host, /execute: wrap\('meeting_open', async \(a\) => openMeetingClient\(a\.app\)\)/, '工具要复用它')
  assert.match(host, /sub === 'open'/, '面板要有对应路由')
  // 不能存在第二份"打开软件"的汇报逻辑（入会流程里启动客户端是另一件事）
  const copies = (host.match(/'已启动：' : '已运行：'/g) || []).length
  assert.equal(copies, 1, '打开软件的实现只应有一处，实际 ' + copies)
})

test('启动软件不会顺手入会（两者是不同操作）', () => {
  const at = host.indexOf('async function openMeetingClient')
  const seg = host.slice(at, at + 700)
  assert.doesNotMatch(seg, /joinTool|meeting_join|confirm: true/, '打开软件不能自动入会')
})
