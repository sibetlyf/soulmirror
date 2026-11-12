import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  INSTALL_PHASES, IN_PROGRESS_PHASES, emptyInstallState,
  normalizeInstallState, mergeInstallState,
} from '../lib/voiceprint/install-state.js'

/**
 * 一键安装状态投影（lib/voiceprint/install-state.js）的纯单测。
 *
 * 为什么单独测它：
 *   · "重启后 install.json 里的进行中阶段必须归一化"是界面不卡在假进度的根因；
 *   · 状态归一是纯函数，能直接喂 raw JSON，不必起 DSH host / 不碰用户数据目录；
 *   · mergeInstallState 的语义是**盲合并**（不强制终态 running=false、不做单调校验），
 *     这些不变量靠 index.js 的调用方显式写入，所以这里同时用源码字符串交叉断言锁住。
 *
 * 注意：本文件按**真实实现**断言（先读代码再写），不按需求描述猜。
 */

const HOST_SRC = readFileSync(new URL('../index.js', import.meta.url), 'utf8')
const CLIENT_SRC = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')

/** 收集 index.js 里所有 saveInstallState({...}) patch 中的 phase 字面量（含三元表达式两侧） */
function hostPatchPhases() {
  const phases = new Set()
  for (const call of HOST_SRC.matchAll(/saveInstallState\(\{[\s\S]*?\}\)/g)) {
    // `phase: 'x'` 或 `phase: cond ? 'a' : 'b'`
    for (const m of call[0].matchAll(/phase:\s*(?:[^?}]*\?\s*)?'([a-z-]+)'(?:\s*:\s*'([a-z-]+)')?/g)) {
      phases.add(m[1])
      if (m[2]) phases.add(m[2])
    }
  }
  return phases
}

/** client.js 的 installLabel 文案表键集合 */
function clientLabelPhases() {
  const start = CLIENT_SRC.indexOf('var installLabel = {')
  const end = CLIENT_SRC.indexOf('}[install.phase]', start)
  assert.ok(start >= 0 && end > start, 'client.js 里必须存在 installLabel 映射表')
  const block = CLIENT_SRC.slice(start, end)
  return new Set([...block.matchAll(/'([a-z-]+)':\s*'/g)].map((m) => m[1]))
}

test('阶段集合：冻结、无重复，进行中阶段是 INSTALL_PHASES 的真子集（不含 idle/终态）', () => {
  assert.ok(Array.isArray(INSTALL_PHASES), 'INSTALL_PHASES 必须是数组')
  assert.ok(Array.isArray(IN_PROGRESS_PHASES), 'IN_PROGRESS_PHASES 必须是数组')
  assert.equal(Object.isFrozen(INSTALL_PHASES), true, '阶段表必须冻结，防止运行时被改')
  assert.equal(Object.isFrozen(IN_PROGRESS_PHASES), true)

  assert.equal(new Set(INSTALL_PHASES).size, INSTALL_PHASES.length, '阶段名不能重复（否则 UI 映射会出现两个同名阶段）')
  assert.equal(new Set(IN_PROGRESS_PHASES).size, IN_PROGRESS_PHASES.length)
  for (const p of INSTALL_PHASES) assert.match(p, /^[a-z]+(-[a-z]+)*$/, '阶段名必须是 kebab-case 字面量：' + p)

  // 终态 + 空闲
  for (const terminal of ['idle', 'done', 'failed']) {
    assert.ok(INSTALL_PHASES.includes(terminal), '缺少终态/空闲阶段：' + terminal)
    assert.equal(IN_PROGRESS_PHASES.includes(terminal), false, terminal + ' 不能被当成"进行中"（重启后会误报安装未完成）')
  }
  for (const p of IN_PROGRESS_PHASES) {
    assert.ok(INSTALL_PHASES.includes(p), '进行中阶段必须也在 INSTALL_PHASES 里：' + p)
  }
  assert.ok(IN_PROGRESS_PHASES.length > 0 && IN_PROGRESS_PHASES.length < INSTALL_PHASES.length, '进行中阶段应是 INSTALL_PHASES 的真子集')
})

test('emptyInstallState：默认投影是 idle / 未运行 / 零进度，且每次返回新对象', () => {
  const a = emptyInstallState()
  const b = emptyInstallState()
  assert.notEqual(a, b, '不能共享同一个对象（否则一处修改会污染别处投影）')
  assert.equal(a.phase, 'idle')
  assert.equal(a.running, false)
  assert.equal(a.canceling, false)
  assert.equal(a.percent, 0)
  assert.equal(a.received, 0)
  assert.equal(a.total, 0)
  assert.equal(a.step, 0)
  assert.equal(a.stepsTotal, 0)
  assert.equal(a.stepLabel, '')
  assert.equal(a.message, '')
  assert.equal(a.error, '')
  assert.equal(a.hint, '')
  assert.equal(a.modelId, '')
  assert.equal(a.at, '')
})

test('normalizeInstallState：null / 非对象输入 → 返回空投影（重启读到空 install.json 不能崩）', () => {
  for (const raw of [null, undefined, 'garbage', 42, []]) {
    const s = normalizeInstallState(raw)
    assert.deepEqual(s, emptyInstallState(), '非对象输入应归一化成空投影：' + String(raw))
  }
  const a = normalizeInstallState(null)
  const b = normalizeInstallState(null)
  assert.notEqual(a, b, '每次归一化都要返回新对象')
})

test('normalizeInstallState：running:true 一律归为 failed + 可重试（优先级高于 phase，含矛盾状态）', () => {
  const raw = {
    phase: 'download-model', running: true, canceling: true,
    message: '正在下载模型 37%', percent: 37, received: 123, total: 999,
    step: 1, stepsTotal: 2, stepLabel: '模型', modelId: 'wespeaker-resnet34-zh',
    error: '', hint: '', at: '2026-11-11T00:00:00.000Z',
  }
  const snapshot = JSON.stringify(raw)
  const s = normalizeInstallState(raw)

  assert.equal(s.phase, 'failed', '上次进程被杀/重启，绝不能保留"下载中"这种假进行中状态')
  assert.equal(s.running, false, '重启后 running 必须为 false，界面不能永久卡在"正在安装…"')
  assert.equal(s.canceling, false)
  assert.equal(s.percent, 0, '中断的进度不能保留（否则进度条会停在一个假的百分比）')
  assert.equal(s.received, 0)
  assert.equal(s.total, 0)
  assert.equal(s.step, 0)
  assert.equal(s.message, '上次安装未完成')
  assert.match(s.error, /中断/, '要说明为什么（进程退出或重启），不能只给"失败"')
  assert.match(s.hint, /重新点「一键安装」/, '要给出可采取的动作')

  // 实现只重置进度字段，保留 stepsTotal/stepLabel/modelId/at（用来审计是谁、装到第几步挂的）
  assert.equal(s.stepsTotal, 2, '实现保留 stepsTotal（依据：归一化只重置 percent/received/total/step）')
  assert.equal(s.stepLabel, '模型')
  assert.equal(s.modelId, 'wespeaker-resnet34-zh')
  assert.equal(s.at, raw.at)
  assert.equal(JSON.stringify(raw), snapshot, '归一化不能修改传入的 raw（它来自 JSON.parse，改掉会让调用方看不到原值）')

  // 矛盾状态：phase 已经是 done 却还 running:true —— 保守判为中断（以代码为准）
  const doneButRunning = normalizeInstallState({ phase: 'done', running: true, percent: 100 })
  assert.equal(doneButRunning.phase, 'failed', '实现里 raw.running===true 优先于 phase；done+running 的矛盾状态按中断处理')
  assert.equal(doneButRunning.running, false)
})

test('normalizeInstallState：每个 IN_PROGRESS_PHASES 且 running:false 都判为"上次没做完"', () => {
  for (const phase of IN_PROGRESS_PHASES) {
    const s = normalizeInstallState({ phase, running: false, percent: 55, step: 1, stepsTotal: 2 })
    assert.equal(s.phase, 'failed', '停在中间阶段 ' + phase + ' 的 install.json，重启后必须归一化为 failed')
    assert.equal(s.running, false, phase + '：归一化后 running 必须 false')
    assert.equal(s.canceling, false)
    assert.equal(s.percent, 0, phase + '：中断进度必须清零')
    assert.equal(s.step, 0)
    assert.match(s.error, /中断/)
    assert.match(s.hint, /重新点「一键安装」/)
  }
})

test('normalizeInstallState：未知阶段 → idle 并清空脏文案（真实实现不是 failed）', () => {
  // 与需求描述不同：代码对"不认识的阶段"是 idle（清文案），不是 failed。
  // 依据：install-state.js 的 `if (!INSTALL_PHASES.includes(state.phase)) → phase:'idle', message/error/hint:''`。
  const s = normalizeInstallState({
    phase: 'bogus-old-version', running: false, canceling: true,
    message: '旧版本留下的文案', error: '旧错误', hint: '旧提示',
    percent: 37, step: 2, stepsTotal: 3, stepLabel: '旧步骤', modelId: 'm1',
  })
  assert.equal(s.phase, 'idle', '未知阶段必须回落 idle，不能原样显示一个界面文案表里没有的阶段')
  assert.equal(s.running, false)
  assert.equal(s.canceling, false)
  assert.equal(s.message, '', '未知阶段的脏文案必须清掉，不能继续显示')
  assert.equal(s.error, '')
  assert.equal(s.hint, '')
  // 实现只清文案和状态标志，数值字段随 `{...empty, ...raw}` 保留（无害，idle 不展示进度条）
  assert.equal(s.percent, 37, '依据实现：未知阶段分支没有重置 percent/step，只清 phase/文案/canceling')
  assert.equal(s.step, 2)
  assert.equal(s.modelId, 'm1')
})

test('normalizeInstallState：done / failed / idle 保留原 phase，running/canceling 一律 false', () => {
  const done = normalizeInstallState({
    phase: 'done', running: false, canceling: true, percent: 100, received: 99, total: 99,
    step: 2, stepsTotal: 2, stepLabel: '完成', message: '安装完成，自检通过',
    error: '', hint: '可以开始录声纹了', modelId: 'wespeaker-resnet34-zh', at: '2026-11-11T01:00:00.000Z',
  })
  assert.equal(done.phase, 'done', '完成的投影必须保留 done，重启后界面应显示"完成"')
  assert.equal(done.running, false)
  assert.equal(done.canceling, false, '即便 raw 里 canceling:true，归一化也必须清掉')
  assert.equal(done.percent, 100)
  assert.equal(done.step, 2)
  assert.equal(done.stepsTotal, 2)
  assert.equal(done.message, '安装完成，自检通过', '终态文案要保留，方便用户回来确认结果')
  assert.equal(done.error, '')

  const failed = normalizeInstallState({
    phase: 'failed', running: false, error: '运行库校验失败', hint: '重试安装', percent: 0,
  })
  assert.equal(failed.phase, 'failed', '失败投影必须保留 failed')
  assert.equal(failed.running, false)
  assert.equal(failed.error, '运行库校验失败', '失败原因必须保留，重启后用户还能看到为什么失败')
  assert.equal(failed.hint, '重试安装')

  const idle = normalizeInstallState({ phase: 'idle', running: false, message: '已取消', hint: '临时文件已清理' })
  assert.equal(idle.phase, 'idle', '取消后的 idle 投影必须保留')
  assert.equal(idle.running, false)
  assert.equal(idle.message, '已取消', 'idle 的取消文案要保留（客户端靠它显示"已取消"而不是失败）')
  assert.equal(idle.hint, '临时文件已清理')
})

test('mergeInstallState：盲合并 + 新时间戳 + 不改入参（不做 phase 校验）', () => {
  const prev = {
    phase: 'download-model', running: true, canceling: false,
    percent: 42, received: 100, total: 500, step: 1, stepsTotal: 2, stepLabel: '模型',
    modelId: 'wespeaker-resnet34-zh', at: '2000-01-01T00:00:00.000Z',
  }
  const snapshot = JSON.stringify(prev)
  const merged = mergeInstallState(prev, { phase: 'verify-model', message: '正在校验' })

  assert.notEqual(merged, prev, 'merge 必须返回新对象（界面不能读到半更新/被原地修改的投影）')
  assert.equal(merged.phase, 'verify-model')
  assert.equal(merged.message, '正在校验')
  // 盲合并：patch 没写的字段全保留（这是实现语义，不是"重置"）
  assert.equal(merged.running, true, '依据实现：merge 不修正 running，patch 没写就保留 prev')
  assert.equal(merged.percent, 42)
  assert.equal(merged.step, 1)
  assert.equal(merged.modelId, 'wespeaker-resnet34-zh')
  assert.equal(JSON.stringify(prev), snapshot, 'merge 不能改入参 prev（否则其它读者会看到脏状态）')

  assert.match(merged.at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/, 'at 必须是 ISO 时间戳')
  assert.equal(new Date(merged.at).toISOString(), merged.at)
  assert.notEqual(merged.at, prev.at, '每次迁移都要更新 at（用于审计最后一次状态变化时间）')

  // prev 为空：以 emptyInstallState 为底
  const fromNull = mergeInstallState(null, { phase: 'resolving', running: true })
  assert.equal(fromNull.phase, 'resolving')
  assert.equal(fromNull.running, true)
  assert.equal(fromNull.percent, 0, '空 prev 应带上 emptyInstallState 的默认字段')

  // merge 不做 phase 合法性校验（未知阶段会原样合并，靠重启时的 normalize 兜底）
  const bogus = mergeInstallState(emptyInstallState(), { phase: 'bogus-phase' })
  assert.equal(bogus.phase, 'bogus-phase', '依据实现：merge 是纯合并，不校验阶段；非法阶段在下次启动 normalizeInstallState 时回落 idle')
})

test('mergeInstallState：不自动修正 running/canceling/percent —— 终态与单调性由调用方显式保证', () => {
  // 1) 终态 patch 若漏写 running:false，merge 不会补 —— 所以 index.js 必须显式写
  const missingRunning = mergeInstallState({ phase: 'download-model', running: true, canceling: true }, { phase: 'done', percent: 100 })
  assert.equal(missingRunning.phase, 'done')
  assert.equal(missingRunning.running, true, '依据实现：merge 不把终态自动置 running=false（若调用方漏写，界面会卡在"正在安装…"）')
  assert.equal(missingRunning.canceling, true, '依据实现：merge 不会自动清 canceling，调用方必须显式传 false')

  // 2) 调用方显式写 false 才能落地终态不变量
  const explicit = mergeInstallState({ phase: 'download-model', running: true, canceling: true }, { phase: 'done', running: false, canceling: false, percent: 100 })
  assert.equal(explicit.running, false)
  assert.equal(explicit.canceling, false)

  // 3) percent/step 没有单调回退保护：merge 允许倒退，单调性靠调用方只喂累计字节
  const regressed = mergeInstallState({ percent: 90, step: 2 }, { percent: 10, step: 1 })
  assert.equal(regressed.percent, 10, '依据实现：merge 不做单调校验；进度单调性由 index.js 的 overall（累计字节/totalBytes）保证')
  assert.equal(regressed.step, 1)
})

test('调用方不变量（源码交叉）：index.js 的终态 patch 必须显式 running:false/canceling:false，并负责进度单调', () => {
  // 成功终态（含自检失败）
  assert.match(HOST_SRC, /phase: probe\.ok \? 'done' : 'failed', running: false, canceling: false/, '安装成功/自检失败必须显式复位 running/canceling')
  // 取消终态必须是 idle，并且显式 running:false
  assert.match(HOST_SRC, /phase: 'idle', running: false, message: '已取消', canceling: false/, '取消终态必须是 idle + running:false + canceling:false（不能显示成失败）')
  // 失败热路径（模型失败、运行库失败、异常兜底）
  const failedWithFlags = (HOST_SRC.match(/phase: 'failed', running: false, canceling: false/g) || []).length
  assert.ok(failedWithFlags >= 3, '失败热路径（模型/运行库/异常）必须显式 running:false + canceling:false，实际只有 ' + failedWithFlags + ' 处')
  // 「清单里没有这个模型」的早期失败也必须复位 running/canceling
  // （旧实现漏了 canceling:false；新一轮 UX 修复已补齐，锁住新形状）
  assert.match(HOST_SRC, /phase: 'failed', running: false, canceling: false, error: '清单里没有这个模型/, '早期失败也要 running:false + canceling:false')
  // finally 兜底
  assert.match(HOST_SRC, /if \(installState\.running\) saveInstallState\(\{ running: false, canceling: false \}\)/, 'finally 必须兜底复位 running/canceling')
  // 进度单调依据：整体 percent 用累计字节 / totalBytes（只增不减）
  assert.match(HOST_SRC, /const overall = totalBytes \? Math\.min\(100, Math\.floor\(\(p\.received \/ totalBytes\) \* 100\)\) : 0/, '模型进度按累计字节算（只增）')
  assert.match(HOST_SRC, /const overall = totalBytes \? Math\.min\(100, Math\.floor\(\(doneBytes \/ totalBytes\) \* 100\)\) : 0/, '运行库进度叠加模型字节（只增）')
})

test('阶段字面量交叉一致：index.js 用到的 phase、client 文案表与 install-state 阶段集合完全对齐', () => {
  const hostPhases = hostPatchPhases()
  assert.ok(hostPhases.size > 0, '未能从 index.js 提取到安装 phase 字面量，测试本身失效')

  for (const p of hostPhases) {
    assert.ok(INSTALL_PHASES.includes(p), 'index.js 写入了未登记阶段 "' + p + '"：normalizeInstallState 会把它当未知阶段 → 重启后变 idle，进度丢失')
  }
  for (const p of INSTALL_PHASES) {
    assert.ok(hostPhases.has(p), 'install-state 声明了阶段 "' + p + '" 但 index.js 从未写入：阶段表与宿主实现漂移')
  }
  for (const p of IN_PROGRESS_PHASES) {
    assert.ok(hostPhases.has(p), '进行中阶段 "' + p + '" 在 index.js 里没有写入点，重启归一化会永远用不上它')
  }

  // 客户端文案表必须有全部阶段的文案：新增阶段却忘了加文案，界面会显示原始英文阶段名
  const clientPhases = clientLabelPhases()
  assert.deepEqual([...clientPhases].sort(), [...INSTALL_PHASES].sort(), 'client installLabel 阶段集合必须与 INSTALL_PHASES 完全一致')
})
