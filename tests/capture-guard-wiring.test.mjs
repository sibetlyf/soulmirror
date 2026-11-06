import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/**
 * 采集设备必然性检查的接线。
 *
 * 用户连续两次追问点破了我的判断错误：
 *   ① "整段上传转写，为啥还会有全空音频" → 空的是录音本身，不是上传
 *   ② "采集设备不是当前会议用的输出设备吗，咋还有虚拟声卡"
 *      → CABLE Input 确实是渲染端点，会议只要也播到它就能内录；关键是**两端一致**
 *
 * 所以代码里要留住这两层：静态提示（虚拟端点有前提条件）+ 实测校验（谁在出声）。
 */

const src = readFileSync(new URL('../index.js', import.meta.url), 'utf8')
const sess = readFileSync(new URL('../lib/session.js', import.meta.url), 'utf8')

test('采集启动时做实测校验：当场测谁在出声，与采集设备比对', () => {
  const at = sess.indexOf('实测校验：当场测')
  assert.ok(at > 0, '找不到实测校验')
  const seg = sess.slice(at, at + 1400)
  assert.match(seg, /loudestRenderDevice\(/, '应测电平')
  assert.match(seg, /compareCaptureWithLoud\(/, '应做一致性比对')
  assert.match(seg, /this\.lastError = cmp\.reason/, '不一致要报出来')
})

test('自动纠正是可选的，且 listDevices 用扁平数组形状', () => {
  const at = sess.indexOf('实测校验：当场测')
  const seg = sess.slice(at, at + 1600)
  assert.match(seg, /captureAuto !== false/, '自动跟随要受配置约束')
  assert.match(seg, /flow === 'RENDER'/, 'listDevices 返回扁平数组，要按 flow 过滤')
  assert.equal(/d\.render \|\| \[\]/.test(seg), false, '不该再用 {render,capture} 形状')
})

test('运行中每 30 秒巡检一次（ASR 对静音会幻听，不能只看有没有转写）', () => {
  const at = sess.indexOf('设备巡检')
  assert.ok(at > 0, '找不到巡检')
  const seg = sess.slice(at, at + 1800)
  assert.match(seg, /30000/, '应每 30 秒一次')
  assert.match(seg, /\(this\.silentSec \|\| 0\) >= 8/, '连续静音 8 秒才值得测')
  assert.match(seg, /loudestRenderDevice\(/, '巡检要测电平')
})

test('停止时把采集信息写进 meta（事后可追查）', () => {
  const at = src.indexOf('采集信息写进 meta')
  assert.ok(at > 0, '找不到 captureInfo')
  const seg = src.slice(at, at + 1200)
  assert.match(seg, /captureVerdict\(/, '应做静音判定')
  assert.match(seg, /device: session\.deviceLabel/, '应记设备')
  assert.match(seg, /silentRatio/, '应记静音占比')
  assert.match(seg, /capture: captureInfo/, '应落进 meta')
})

test('有声音后允许再次报警（不会一次就永久沉默）', () => {
  assert.match(sess, /this\._silenceWarned = false/, '恢复有声后应复位告警')
})
