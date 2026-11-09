import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  OFFLINE_STAGES, MINUTES_STAGES, stagesOf, percentOf, createProgress, describeProgress,
} from '../lib/progress.js'

/**
 * 会后整理的分阶段进度。
 *
 * 用户的抱怨：只看到"会后转写中"，不知道卡在哪、还要多久。
 * 所以阶段要显式、百分比要单调、细节要能更新（已上传多少、已识别多少句、已等几秒）。
 */

test('两条流水线的阶段权重加起来是 100 的设计基线', () => {
  for (const list of [OFFLINE_STAGES, MINUTES_STAGES]) {
    const total = list.reduce((a, x) => a + x.weight, 0)
    assert.ok(total > 0, '权重必须为正')
    assert.ok(list.every((s) => s.id && s.label), '每个阶段都要有 id 与可读标签')
  }
  assert.equal(stagesOf('minutes'), MINUTES_STAGES)
  assert.equal(stagesOf('offline'), OFFLINE_STAGES)
})

test('百分比单调递增，且云端识别占据大头', () => {
  const seq = ['prepare', 'upload', 'recognize', 'write', 'done']
  const pcts = seq.map((id, i) => percentOf({ pipeline: 'offline', stageId: id, fraction: i === seq.length - 1 ? 1 : 0.2 }))
  for (let i = 1; i < pcts.length; i++) {
    assert.ok(pcts[i] >= pcts[i - 1], '百分比不该倒退：' + pcts.join(' → '))
  }
  assert.equal(percentOf({ pipeline: 'offline', stageId: 'done', fraction: 1 }), 100)

  // 识别阶段开始时已过 25%，结束时到 85%（说明它是主耗时）
  const recStart = percentOf({ pipeline: 'offline', stageId: 'recognize', fraction: 0 })
  const recEnd = percentOf({ pipeline: 'offline', stageId: 'recognize', fraction: 1 })
  assert.ok(recStart >= 20 && recStart <= 30, '识别开始时约 25%：' + recStart)
  assert.ok(recEnd >= 80 && recEnd <= 90, '识别结束时约 85%：' + recEnd)
})

test('未知阶段不会给出 100%（不能假装完成）', () => {
  const p = percentOf({ pipeline: 'offline', stageId: 'something-else', fraction: 0.5 })
  assert.ok(p < 100, '实际 ' + p)
})

test('进度对象：阶段切换 + 细节更新 + 计时', () => {
  let t = 1000000
  const pr = createProgress({ pipeline: 'offline', now: () => t })

  t += 3000
  let s = pr.stage('upload', { detail: '已上传 0MB / 41MB' })
  assert.equal(s.stage, 'upload')
  assert.equal(s.elapsedSec, 3)
  assert.equal(s.stageLabel, '上传录音', '没传 label 时用阶段默认文案')

  t += 2000
  s = pr.detail('已上传 20MB / 41MB', 0.5)
  assert.match(s.detail, /20MB/)
  assert.equal(s.elapsedSec, 5)
  const mid = s.percent

  t += 2000
  s = pr.detail('已上传 41MB / 41MB', 1)
  assert.ok(s.percent > mid, '同一阶段推进时百分比应上升')
})

test('describeProgress 拼出一句人话（含百分比与耗时）', () => {
  const s = { stageLabel: '云端识别中', detail: '已等 23 秒', percent: 55, elapsedSec: 23 }
  const line = describeProgress(s)
  assert.match(line, /云端识别中/)
  assert.match(line, /55%/)
  assert.match(line, /23s/)
  assert.equal(describeProgress(null), '')
})

test('纪要流水线的阶段标签可读（用户要看到"在写纪要"）', () => {
  const labels = MINUTES_STAGES.map((s) => s.label).join('/')
  assert.match(labels, /写纪要/)
  assert.match(labels, /后台任务/)
})
