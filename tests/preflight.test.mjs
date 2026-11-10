import { test } from 'node:test'
import assert from 'node:assert/strict'
import { check, summarize, buildPreflight } from '../lib/preflight.js'

/**
 * 采集自检。
 *
 * 动机：别人"模型和设备都配对了，会议开始却没有转录"，而我本地正常。
 * 这类失败静默且依赖机器差异（非 Windows / 桥接缺失 / 端点为空 / Key 无效 / 端点选错）。
 * 自检要能指出"卡在哪一环 + 怎么修"。
 */

const healthy = {
  platform: 'win32',
  bridgePresent: true,
  bridgeRuns: true,
  deviceCount: 3,
  deviceName: '扬声器 (Realtek)',
  meetingActive: true,
  asrProvider: 'dashscope',
  asrKey: 'sk-0123456789012345678901',
  asrKeySource: 'file',
}

test('健康环境：全部通过，结论明确', () => {
  const r = buildPreflight(healthy)
  assert.equal(r.ok, true)
  assert.equal(r.failed, 0)
  assert.equal(r.verdict, '采集链路就绪')
})

test('非 Windows：致命，且说明为什么（WASAPI/UIAutomation）', () => {
  const r = buildPreflight({ ...healthy, platform: 'darwin' })
  assert.equal(r.ok, false)
  assert.equal(r.blocked.id, 'platform')
  assert.match(r.verdict, /运行平台/)
  assert.match(r.blocked.fix, /Windows/)
})

test('桥接缺失：致命，并给出重装/重编的修法', () => {
  const r = buildPreflight({ ...healthy, bridgePresent: false })
  assert.equal(r.blocked.id, 'bridge')
  assert.match(r.blocked.fix, /重装|soul_setup/)
})

test('桥接跑不起来：指向 .NET Framework / 杀软', () => {
  const r = buildPreflight({ ...healthy, bridgeRuns: false })
  assert.equal(r.blocked.id, 'bridge-run')
  assert.match(r.blocked.fix, /NET Framework|杀软/)
})

test('没有可采集端点：说清是设备问题，不是模型问题', () => {
  const r = buildPreflight({ ...healthy, deviceCount: 0 })
  assert.equal(r.blocked.id, 'device')
  assert.match(r.blocked.fix, /播放设备|VB-CABLE/)
})

test('provider 不是 dashscope / 密钥为空：分别指出', () => {
  const a = buildPreflight({ ...healthy, asrProvider: 'openai' })
  assert.equal(a.blocked.id, 'asr-provider')

  const b = buildPreflight({ ...healthy, asrKey: '' })
  assert.equal(b.blocked.id, 'asr-key')
  assert.match(b.blocked.fix, /DASHSCOPE_API_KEY|百炼/)
})

test('网络不通是可选项：明确给出代理/白名单建议', () => {
  const r = buildPreflight({ ...healthy, asrReachable: false })
  assert.equal(r.ok, false)
  const net = r.checks.find((c) => c.id === 'asr-net')
  assert.equal(net.ok, false)
  assert.match(net.fix, /wss|代理|白名单/)
})

test('没测网络时不产生失败项（null 不算错）', () => {
  const r = buildPreflight({ ...healthy, asrReachable: null })
  assert.equal(r.ok, true)
  assert.equal(r.checks.some((c) => c.id === 'asr-net'), false)
})

test('没检测到会议窗口：不算致命，只说明"开始会议后会自动录音"', () => {
  const r = buildPreflight({ ...healthy, meetingActive: false })
  const m = r.checks.find((c) => c.id === 'meeting')
  assert.equal(m.ok, false)
  assert.equal(m.fatal, false)
})

test('上次采集错误会带进清单（便于远程排查）', () => {
  const r = buildPreflight({ ...healthy, lastCaptureError: 'spawn mbridge.exe ENOENT' })
  const e = r.checks.find((c) => c.id === 'last-error')
  assert.ok(e)
  assert.match(e.detail, /ENOENT/)
})

test('summarize 优先报致命项（而不是随便挑一个失败）', () => {
  const checks = [
    check('meeting', '会议窗口', false, { fix: 'x' }),
    check('platform', '运行平台', false, { detail: 'linux', fix: 'y', fatal: true }),
  ]
  const s = summarize(checks)
  assert.equal(s.blocked.id, 'platform', '应优先报致命问题')
  assert.match(s.verdict, /无法转录/)
})

test('check 会自动清空已通过项的修法文案', () => {
  const c = check('x', 'X', true, { fix: '不该显示' })
  assert.equal(c.ok, true)
  assert.equal(c.fix, '', '通过的项目不该带修法')
})
