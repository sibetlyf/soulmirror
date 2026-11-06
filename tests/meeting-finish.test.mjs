import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/**
 * 「停止采集之后，纪要谁来生成？」
 *
 * 修复前的真实缺口：只有两条路径会生成纪要 ——
 *   ① 界面点「结束录音」（/auto action=stop）
 *   ② 会议窗口关闭（lifecycle.onExit）
 * 而这三个工具只停采集、不整理：
 *   · meeting_capture_stop
 *   · meeting_agent_stop
 *   · meeting_leave
 * 于是"停了但没纪要"，用户只能自己去 meeting_minutes 补。
 *
 * 现在统一走 stopAndOrganize()，且 finalizeMeeting 自身有 60 秒去抖 + 进行中互斥，
 * 重复调用安全。
 */

const src = readFileSync(new URL('../index.js', import.meta.url), 'utf8')

function toolSeg(name, len = 2200) {
  const i = src.indexOf("name: '" + name + "'")
  assert.ok(i > 0, '找不到工具 ' + name)
  return src.slice(i, i + len)
}

test('存在统一的"停止并整理"入口', () => {
  assert.match(src, /async function stopAndOrganize\(/, '缺少 stopAndOrganize')
  const at = src.indexOf('async function stopAndOrganize(')
  const seg = src.slice(at, at + 1400)
  assert.match(seg, /session\.stopCapture\(\)/, '应先停采集')
  assert.match(seg, /finalizeMeeting\(/, '应触发生成纪要')
  assert.match(seg, /wasCapturing/, '没在采集就不该整理（避免空会议生成空纪要）')
  assert.match(seg, /lastFinalizedAt < 60000 \|\| finalizing/, '应复用去抖，避免重复整理')
})

test('三个停止类工具都会触发生成纪要', () => {
  for (const [name, why] of [
    ['meeting_capture_stop', '手动停止采集'],
    ['meeting_agent_stop', '停止会议大脑'],
    ['meeting_leave', '离开会议'],
  ]) {
    const seg = toolSeg(name)
    assert.ok(seg.includes('stopAndOrganize'), name + ' 停止后没有整理（' + why + '）')
  }
})

test('界面「结束录音」路径仍会整理', () => {
  const at = src.indexOf("} else if (action === 'stop')")
  assert.ok(at > 0, '找不到 /auto 的 stop 分支')
  const seg = src.slice(at, at + 1200)
  assert.match(seg, /finalizeMeeting\(/, '界面停止应触发生成纪要')
  assert.match(seg, /setPostMeeting\(\{ phase: 'stopping'/, '应先把状态置为整理中')
})

test('窗口关闭（lifecycle.onExit）仍会整理，且只在采集过时触发', () => {
  const at = src.indexOf('onExit: async () =>')
  assert.ok(at > 0, '找不到 onExit')
  const seg = src.slice(at, at + 800)
  assert.match(seg, /wasCapturing/, '应判断是否采集过')
  assert.match(seg, /finalizeMeeting\(/, '窗口关闭应触发生成纪要')
})

test('纪要的生成链路按顺序：先纪要 → 再离线重转写 → 再写库', () => {
  const at = src.indexOf('async function finalizeMeeting(')
  const seg = src.slice(at, at + 4000)
  const iMinutes = seg.indexOf('await buildMinutes(')
  const iOffline = seg.indexOf('runOfflineInBackground(')
  const iKnow = seg.indexOf('writeViaHostApi(')
  assert.ok(iMinutes > 0, '应先 buildMinutes')
  assert.ok(iOffline > iMinutes, '离线重转写应在首次纪要之后（用录音补全）')
  assert.ok(iKnow > iOffline, '写知识库应在最后')
})
