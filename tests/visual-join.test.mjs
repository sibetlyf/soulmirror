/**
 * 看屏入会（visual join）的单元测试。
 *
 * 只测纯逻辑：提示词里是否写死了"不许乱点"的约束、是否给出会议号、
 * 以及子会话输出如何判定成功/抽取结论。不碰真实桌面、不联网、不录音。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildVisualJoinPrompt, visualJoined, visualVerdict } from '../lib/visual-join.js'

test('提示词：带上会议号、要求先截图再点、禁止乱点', () => {
  const p = buildVisualJoinPrompt({ app: '腾讯会议', code: '969861763', winHint: '腾讯会议' })
  assert.match(p, /969861763/, '必须带上会议号')
  assert.match(p, /腾讯会议/, '必须指明目标客户端')
  assert.match(p, /computer screenshot/, '必须要求先截图')
  assert.match(p, /不许凭经验猜坐标/, '必须禁止猜坐标')
  assert.match(p, /不要点/, '必须禁止点无关按钮')
  assert.match(p, /最多 8 次点击/, '必须有点击上限，避免乱点')
  assert.match(p, /RESULT: joined\|failed/, '必须要求明确结论格式')
})

test('提示词：有链接时提示优先用链接', () => {
  const p = buildVisualJoinPrompt({ app: '腾讯会议', code: '123456789', link: 'https://meeting.tencent.com/dm/abc' })
  assert.match(p, /https:\/\/meeting\.tencent\.com\/dm\/abc/)
  assert.match(p, /优先用/)
})

test('判定：RESULT: joined 算成功；失败/未进入不算', () => {
  assert.equal(visualJoined('RESULT: joined\nDETAIL: 已进入会议'), true)
  assert.equal(visualJoined('RESULT: failed\nDETAIL: 找不到加入按钮'), false)
  assert.equal(visualJoined('已进入会议，正在连接音频'), true)
  assert.equal(visualJoined('尚未确认进入会议'), false)
  assert.equal(visualJoined(''), false)
})

test('结论抽取：优先 DETAIL/EVIDENCE，缺失时截断原文', () => {
  const v = visualVerdict('RESULT: joined\nDETAIL: 点「加入」后进入\nEVIDENCE: 亚峰-init 会议 00:12')
  assert.match(v, /点「加入」后进入/)
  assert.match(v, /界面：亚峰-init 会议/)
  assert.equal(visualVerdict(''), '（子会话没有返回内容）')
})
