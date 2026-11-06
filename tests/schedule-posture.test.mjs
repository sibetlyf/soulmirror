import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/**
 * 定时任务的使用姿势。
 *
 * 事故：另一个「会议助手」bot 的指令里写着
 *   「每次在会议开始后，根据会议时长设置定时任务，自动获取全部会议转写和会议纪要」
 * 于是每场会都会拉起一个每十分钟轮询取纪要的任务：
 *   · 会话常驻、反复加载
 *   · 会议没结束就轮询，取不到还要重试
 *   · 每轮都是真实 token 消耗
 *
 * 结论：纪要必须**事件驱动**（散会即整理），不能用定时轮询。
 * 定时任务只允许一种用途：一次性「到点入会」。
 */

const src = readFileSync(new URL('../index.js', import.meta.url), 'utf8')

test('定时任务只用于"到点参会"，不得用于轮询纪要', () => {
  const svc = src.indexOf('function scheduleService()')
  assert.ok(svc > 0, '找不到 schedule 服务封装')

  // 全仓库创建任务的地方只应有一处（auto-attend）
  const creates = [...src.matchAll(/svc\.(create|add)\(/g)]
  assert.ok(creates.length <= 1, '创建定时任务的地方超过一处，容易引入轮询：' + creates.length)

  // 不许出现"定期取纪要"式提示词
  assert.equal(/每\s*\d+\s*分钟[^\n]{0,20}(纪要|转写)/.test(src), false, '不应存在"每 N 分钟取纪要"的定时逻辑')
})

test('到点参会的提示词是一次性的，不包含"循环/每隔"', () => {
  const at = src.indexOf('function buildAttendPrompt(')
  assert.ok(at > 0, '找不到 buildAttendPrompt')
  const seg = src.slice(at, at + 900)
  assert.equal(/每隔|循环|cron|every/i.test(seg), false, '入会提示词不该是周期性的')
})

test('纪要入口是显式调用，而不是后台自动轮询', () => {
  // meeting_minutes / meeting_offline_pass 是"要的时候才跑"
  assert.match(src, /name: 'meeting_minutes'/, '缺少按需纪要工具')
  assert.match(src, /name: 'meeting_offline_pass'/, '缺少按需重转写工具')
})
