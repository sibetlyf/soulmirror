import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/**
 * 用户要求：录音文件要能看到存在哪里，并且能点开。
 *
 * 这里守住三件事：
 *  ① 宿主 /status 给出录音/纪要/转写的真实路径与大小（stat 出来的，不猜）；
 *  ② 打开动作走宿主 openWorkspacePath，不自己拼 explorer 命令；
 *  ③ 只允许打开会议数据目录内的路径（不能变成任意路径执行器）。
 */

const host = readFileSync(new URL('../index.js', import.meta.url), 'utf8')
const client = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
const view = readFileSync(new URL('../lib/view-model.js', import.meta.url), 'utf8')

test('状态里带产物位置：录音/纪要/转写，含大小与时长', () => {
  assert.match(host, /__payload\.artifacts = \(\(\) => \{/)
  assert.match(host, /const audio = pick\('audio\.wav'\)/)
  assert.match(host, /pick\('minutes\.md'\)/)
  assert.match(host, /pick\('transcript-offline\.jsonl'\)/)
  assert.match(host, /audio\.seconds = Math\.max\(0, Math\.round\(\(audio\.bytes - 44\) \/ 32000\)\)/, '时长按 16k/16bit/单声道算')
  assert.match(view, /artifacts: runtime\.artifacts \|\| null/, '取景器模型要把它传给界面')
})

test('打开文件走宿主 API，并且限制在会议数据目录内', () => {
  assert.match(host, /async function openOnHost\(path, \{ reveal = false \} = \{\}\)/)
  assert.match(host, /if \(!target\.startsWith\(CONFIG_DIR\)\) return \{ ok: false, error: '只允许打开会议数据目录内的文件' \}/)
  assert.match(host, /sc\.openWorkspacePath\(\{ path: target, \.\.\.\(reveal \? \{ action: 'reveal' \} : \{\}\) \}\)/)
  assert.match(host, /sub === 'open-path'/)
  // 不允许自己拼系统命令去开文件
  assert.doesNotMatch(host.slice(host.indexOf('async function openOnHost'), host.indexOf('async function openMeetingClient')), /execFile|spawn\(/)
})

test('面板上有产物位置卡：路径可见，且有"在文件夹中显示/打开"', () => {
  assert.match(client, /function ArtifactsCard\(props\)/)
  assert.match(client, /产物位置/)
  assert.match(client, /'在文件夹中显示'/)
  assert.match(client, /'用播放器打开'/)
  assert.match(client, /'打开会议文件夹'/)
  assert.match(client, /fontFamily: 'ui-monospace/, '路径要用等宽字体，便于辨认')
  assert.match(client, /\/api\/soulmirror\/open-path/)
  assert.match(client, /h\(ArtifactsCard, \{ artifacts: v\.artifacts, view: v \}\)/, '纪要页要显示它')
})

test('没有会议目录时不说空话，明确告诉用户先生成什么', () => {
  assert.match(client, /还没有会议目录：开始录音后，录音与纪要的位置会显示在这里/)
})
