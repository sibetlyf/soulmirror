/**
 * 自动停止规则的回归（真实事故）：
 *
 * 2026-11-24 临时会议 808401537：我们**已经真的入会**、双路采集也在跑，
 * 但腾讯会议把会中窗口标题设成了 "wemeetapp"（在 HOME_TITLES 里），
 * 窗口识别判成"不在会中" → 采集在开会第 2 分钟就被自动停掉，整场没有转写。
 *
 * 修法：加一条更硬的证据——**我们自己入的会 + 客户端窗口还在** → 不允许自动停。
 * 这条规则必须排在"静音/窗口识别"之前，且窗口真的消失后仍允许正常停止。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { shouldAutoStop } from '../lib/lifecycle.js'

const base = {
  capturing: true,
  meetingSeen: false,      // 窗口识别失败（事故现场）
  micHeld: false,
  peak: 0,                 // 会里暂时没人说话
  silentSec: 30,
  lastLineAgeSec: 38,
  capturingSec: 130,       // 已经录了 130 秒
  missTicks: 9,
  confirmTicks: 2,
  graceSec: 60,
}

test('事件复现：没有新证据时确实会误停（这是事故本身）', () => {
  const v = shouldAutoStop({ ...base })
  assert.equal(v.stop, true)
  assert.match(v.reason, /quiet|mic-held/)
})

test('我们自己入过会、客户端窗口还在 → 不许自动停', () => {
  const v = shouldAutoStop({ ...base, joinedByUs: true, clientAlive: true })
  assert.equal(v.stop, false, '入会是我们发起的、窗口还在，就不能停')
  assert.equal(v.reason, 'joined-by-us-client-alive')
  assert.equal(v.evidence.joinedByUs, true)
  assert.equal(v.evidence.clientAlive, true)
})

test('窗口真的消失了（clientAlive=false）→ 仍然允许正常停止', () => {
  const v = shouldAutoStop({ ...base, joinedByUs: true, clientAlive: false })
  assert.equal(v.stop, true, '不能因为"是我们入的会"就永远不停')
})

test('不是我们入的会 → 新证据不生效（保持原规则）', () => {
  const v = shouldAutoStop({ ...base, joinedByUs: false, clientAlive: true })
  assert.equal(v.stop, true, '别把"客户端开着"当成"还在开会"')
})
