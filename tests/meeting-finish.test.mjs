import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/**
 * 会后整理的入口完整性。
 *
 * 说明：停止入口已统一收敛到 stopAndOrganize（它内部调 finalizeMeeting），
 * 所以这里的断言是"仍然会整理"，而不是"必须直接出现 finalizeMeeting"。
 * 具体行为见 transcript-pipeline / minutes-save-behavior 的行为测试。
 */

const src = readFileSync(new URL('../index.js', import.meta.url), 'utf8')

const ORGANIZER = /(finalizeMeeting\(|stopAndOrganize\()/

function toolSeg(name) {
  const at = src.indexOf(`name: '${name}'`)
  const end = src.indexOf('ctx.tools.register(', at + 10)
  return src.slice(at, end > 0 ? end : at + 2000)
}

test('所有停止工具都会进入整理', () => {
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
  assert.match(seg, ORGANIZER, '界面停止应触发生成纪要')
  assert.match(seg, /wasCapturing: hadAudio/, '应把"进来前还在采集"告诉整理入口')
})

test('窗口关闭（lifecycle.onExit）仍会整理，且只在采集过时触发', () => {
  const at = src.indexOf('onExit: async () =>')
  assert.ok(at > 0, '找不到 onExit')
  const seg = src.slice(at, at + 800)
  assert.match(seg, /wasCapturing/, '应判断是否采集过')
  assert.match(seg, ORGANIZER, '窗口关闭应触发生成纪要')
})

test('纪要链路顺序：先非流式转写 → 再生成纪要 → 再写库', () => {
  // 2026-11-09 用户纠正：纪要必须等"会议结束后的非流式转写结果"返回后再写。
  // 实时流式转写是边说边猜的草稿，用它写纪要质量必然差。
  const at = src.indexOf('async function finalizeMeeting(')
  const seg = src.slice(at, at + 30000)
  const iOffline = seg.indexOf('runOfflinePass(')
  const iMinutes = seg.indexOf("persistMinutesFile(join(runDir, 'minutes.md')")
  const iKnow = seg.indexOf('writeViaHostApi(')
  assert.ok(iOffline > 0, '应先跑离线（非流式）重转写')
  assert.ok(iMinutes > iOffline, '纪要应在非流式结果之后才落盘')
  assert.ok(iKnow > iMinutes, '写知识库应在最后')
})
