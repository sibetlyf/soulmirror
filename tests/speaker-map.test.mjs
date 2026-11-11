import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  normalizeLabel, sanitizeName, loadSpeakerMap, saveSpeakerMap,
  listSpeakers, applySpeakerMap, loadPeople, rememberPeople, attendeesFromMap,
} from '../lib/speaker-map.js'

/**
 * P1：说话人名册。
 *
 * 现场事实（用户确认）：阿里云识别能分人，但只返回"说话人1/2/3"，
 * 不返回可复用的声纹。所以第一步只能做"这一场会谁是谁"的映射：
 *   · 编号要归一化（说话人1 / SPEAKER_01 / 1 都是同一个人）
 *   · 未命名就保持匿名，绝不编造姓名
 *   · 映射先落盘再生效，写失败要报错
 */

function dir() {
  const d = mkdtempSync(join(tmpdir(), 'sm-spk-'))
  return { d, done: () => rmSync(d, { recursive: true, force: true }) }
}

test('编号归一：中文、英文、纯数字都指同一个说话人', () => {
  assert.equal(normalizeLabel('说话人1'), '说话人1')
  assert.equal(normalizeLabel('说话人 01'), '说话人1')
  assert.equal(normalizeLabel('SPEAKER_01'), '说话人1')
  assert.equal(normalizeLabel('speaker_2'), '说话人2')
  assert.equal(normalizeLabel('2'), '说话人2')
  assert.equal(normalizeLabel(''), '')
})

test('姓名清洗：换行压成空格，超长截断，空串表示取消', () => {
  assert.equal(sanitizeName('  李 亚 峰 '), '李 亚 峰')
  assert.equal(sanitizeName('张三\n李四'), '张三 李四')
  assert.equal(sanitizeName('x'.repeat(80)).length, 40)
  assert.equal(sanitizeName(''), '')
})

test('保存后能读回，并且编号被归一化', () => {
  const { d, done } = dir()
  try {
    const saved = saveSpeakerMap(d, { '说话人 1': '李亚峰', SPEAKER_02: '王工', 说话人3: '  ' })
    assert.equal(saved.byLabel['说话人1'], '李亚峰')
    assert.equal(saved.byLabel['说话人2'], '王工')
    assert.equal(saved.byLabel['说话人3'], undefined, '空名字不该写进去')

    const back = loadSpeakerMap(d)
    assert.deepEqual(back.byLabel, { 说话人1: '李亚峰', 说话人2: '王工' })
    assert.ok(back.at, '要留保存时间')
    // 落盘内容可读，不是内存幻觉
    const raw = JSON.parse(readFileSync(join(d, 'speaker-map.json'), 'utf8'))
    assert.equal(raw.byLabel['说话人1'], '李亚峰')
  } finally { done() }
})

test('坏文件不崩：读不到就当没有映射', () => {
  const { d, done } = dir()
  try {
    writeFileSync(join(d, 'speaker-map.json'), '{ 坏 json', 'utf8')
    assert.deepEqual(loadSpeakerMap(d).byLabel, {})
    assert.deepEqual(loadSpeakerMap(join(d, '不存在')).byLabel, {})
  } finally { done() }
})

test('写失败要抛出来（不能假装保存成功）', () => {
  assert.throws(() => saveSpeakerMap('', { 说话人1: '某人' }), /没有会议目录/)
})

test('列说话人：按发言时长排序，跳过空行/断点/助手播报', () => {
  const lines = [
    { speaker: '说话人1', text: '先说一句', begin: 0, end: 2000, t: '2026-11-11T02:00:00Z' },
    { speaker: '说话人2', text: '我说得多一点', begin: 2000, end: 9000, t: '2026-11-11T02:00:05Z' },
    { speaker: '说话人2', text: '再补一句', begin: 9000, end: 12000, t: '2026-11-11T02:00:09Z' },
    { speaker: '', text: '没有归属的一句' },
    { speaker: '说话人1', text: '（识别中断）', src: 'gap' },
    { speaker: '说话人1', text: '会议纪要已写入知识库：…', role: 'assistant' },
  ]
  const list = listSpeakers(lines)
  assert.equal(list.length, 2)
  assert.equal(list[0].label, '说话人2', '说得多的排前面')
  assert.equal(list[0].sentences, 2)
  assert.ok(Math.abs(list[0].seconds - 10) < 0.001, '时长按 begin/end 毫秒换算')
  assert.equal(list[1].sentences, 1)
  assert.equal(list[0].firstAt, '2026-11-11T02:00:05Z')
})

test('应用映射：命名的换成姓名并保留原标签，未命名的保持匿名', () => {
  const lines = [
    { speaker: '说话人1', text: 'A' },
    { speaker: '说话人2', text: 'B' },
    { speaker: '', text: 'C' },
  ]
  const out = applySpeakerMap(lines, { 说话人1: '李亚峰' })
  assert.equal(out[0].speaker, '李亚峰')
  assert.equal(out[0].speakerLabel, '说话人1', '原标签要留着，排查还要用')
  assert.equal(out[1].speaker, '说话人2', '没命名就不能编')
  assert.equal(out[1].speakerLabel, '说话人2')
  assert.equal(out[2].speaker, '', '本来就没有标签的不能被编一个')
  // 不改入参（同样输入永远同样输出）
  assert.equal(lines[0].speaker, '说话人1')
})

test('全局人名清单：去重、限量、坏文件不崩（且不含声纹）', () => {
  const { d, done } = dir()
  try {
    assert.deepEqual(loadPeople(d), [])
    assert.equal(rememberPeople(d, ['李亚峰', '李亚峰', '王工']), true)
    assert.deepEqual(loadPeople(d).sort(), ['李亚峰', '王工'].sort())
    const raw = JSON.parse(readFileSync(join(d, 'speakers', 'people.json'), 'utf8'))
    assert.ok(Array.isArray(raw.names))
    assert.equal(JSON.stringify(raw).includes('embedding'), false, '这里只能存名字，不能存任何向量')
    mkdirSync(join(d, 'speakers'), { recursive: true })
    writeFileSync(join(d, 'speakers', 'people.json'), 'x', 'utf8')
    assert.deepEqual(loadPeople(d), [])
  } finally { done() }
})

test('与会人员只取已经命名的人，不拿编号充数', () => {
  assert.deepEqual(attendeesFromMap([{ label: '说话人1', name: '李亚峰' }, { label: '说话人2', name: '' }, { label: '说话人3' }]), ['李亚峰'])
})

test('纪要链路：命名后正文用姓名，未命名不编造（接线检查）', () => {
  const host = readFileSync(new URL('../index.js', import.meta.url), 'utf8')
  const client = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
  // 生成纪要时先读名册，再应用到转写
  assert.match(host, /const speakerMap = loadSpeakerMap\(task\.dir\)/)
  assert.match(host, /const named = applySpeakerMap\(offline, speakerMap\.byLabel\)/)
  assert.match(host, /named\.map\(x => \(x\.speaker/)
  // 与会人员来自已命名的人
  assert.match(host, /known\.attendees = Array\.from\(new Set/)
  // 接口：读/写名册
  assert.match(host, /if \(sub === 'speakers'\)/)
  assert.match(host, /sub === 'speakers'/)
  assert.match(host, /saveSpeakerMap\(dirS, next\)/)
  // 目录必须在数据目录内，不能变成任意路径写入器
  assert.match(host, /if \(!dirS \|\| !dirS\.startsWith\(CONFIG_DIR\)\) return json\(400/)
  // 界面有名册卡
  assert.match(client, /function SpeakersCard\(props\)/)
  assert.match(client, /谁在说话/)
  assert.match(client, /\/api\/soulmirror\/speakers/)
  assert.match(client, /不会说明这是谁，也不返回声纹/, '要如实说明云端没有声纹')
})
