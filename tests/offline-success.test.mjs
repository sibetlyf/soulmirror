import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/**
 * 让"会后重转写"真的跑成功。
 *
 * 真机诊断结论（2026-11-06）：
 *   ① 云端文件识别链路本身是好的 —— 真实 41MB 录音：识别 116 句、2 位说话人、21 秒
 *   ② 之前一直"0 场成功"的原因是执行策略：
 *      默认走独立 dsh 子进程，子进程要能调到本插件工具，卡住就白等 10 分钟超时
 *   ③ 另一个坑：整段静音的录音上传会返回 SUCCESS_WITH_NO_VALID_FRAGMENT
 *      （名字像成功，其实一个字没识别，还白花流量）
 *
 * 所以修的是策略与预处理，而不是识别本身。
 */

const src = readFileSync(new URL('../index.js', import.meta.url), 'utf8')

test('默认走内联执行，不再默认依赖子进程', () => {
  const at = src.indexOf('offline: async task =>')
  assert.ok(at > 0, '找不到 offline 步骤')
  const seg = src.slice(at, src.indexOf('minutes: async task =>',at))
  assert.match(seg, /await runOfflinePass\(task.dir/, '默认内联执行，目录来自任务快照')
  assert.match(seg, /isCancelled:task.isCancelled/, '超时取消令牌必须传到底层')
  assert.match(seg, /transcriptionOnly:true/, '转写与生成纪要是分离步骤')
})

test('上传前先体检：静音就跳过，有声区间才上传', () => {
  const at = src.indexOf('先看有没有人声')
  assert.ok(at > 0, '找不到录音体检')
  const seg = src.slice(at, at + 1600)
  assert.match(seg, /scanAudioLevels\(wav\)/, '应扫描电平')
  assert.match(seg, /planOfflineUpload\(scan\)/, '应做上传决策')
  assert.match(seg, /plan\.action === 'skip'/, '静音应跳过')
  assert.match(seg, /extractRangeToWav\(/, '需要时裁出有声区间')
  assert.match(seg, /uploadWav/, '上传应改用裁好的文件')
})

test('体检失败不能挡住重转写（按整段上传）', () => {
  const at = src.indexOf('先看有没有人声')
  const seg = src.slice(at, at + 2000)
  assert.match(seg, /catch \(e\)/, '体检要包 try/catch')
  assert.match(seg, /按整段上传/, '失败时回退整段')
})

test('云端错误翻译成人话，不只扔原始 JSON', () => {
  assert.match(src, /explainOfflineError\(e\.message\)/, '应翻译错误')
  assert.match(src, /throw new Error\('非流式文件识别失败：' \+ explainOfflineError\(e.message\)\)/, '错误必须翻译后抛出，由管线记录失败，不得静默继续')
})

test('上传用流式 openAsBlob（不整份读入内存）', () => {
  const at = src.indexOf('openAsBlob(uploadWav')
  assert.ok(at > 0, '应上传 uploadWav')
  const seg = src.slice(Math.max(0, at - 500), at + 100)
  assert.match(seg, /openAsBlob/, '应流式上传')
  assert.equal(/readFileSync\(wav\)/.test(seg), false, '不该整份读入')
})

test('重转写产物会落盘（供后续人格提取用）', () => {
  // 注意：文件里同时有"读"（人格提取用）与"写"（产出）两处，这里断言写的那处
  const at = src.indexOf("writeFile(join(dir, 'transcript-offline.jsonl')")
  assert.ok(at > 0, '应写 transcript-offline.jsonl')
  const seg = src.slice(at, at + 300)
  assert.match(seg, /lines\.map/, '应逐句写入')
  assert.match(seg, /JSON\.stringify/, '应写成 JSONL')
})
