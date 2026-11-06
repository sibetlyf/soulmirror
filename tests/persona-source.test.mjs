import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  choosePersonaSource, enableHint,
  hasSpeaker, pickSpeakerLines, hasSpeakerLabels, renderSpeakerTranscript, whyNoPersona, isHerLine,
} from '../lib/persona-source.js'

/**
 * 用户定的规则：**没有说话人标注的会议转写，不许用来提取人格。**
 *
 * 理由不是洁癖：没有标注时转写里混着所有人的话，
 * 把同事的观点记成她的立场，比"没有画像"严重得多。
 */

const labeled = [
  { speaker: '张三', text: '这个方案风险太大' },
  { speaker: '李亚峰', text: '先小范围验证再全量' },
  { speaker: '李四', text: '我同意' },
]

const unlabeled = [
  { text: '这个方案风险太大' },
  { text: '先小范围验证再全量' },
]

test('识别单条是否带说话人', () => {
  assert.equal(hasSpeaker({ speaker: '张三' }), true)
  assert.equal(hasSpeaker({ speaker: '  ' }), false)
  assert.equal(hasSpeaker({}), false)
})

test('挑句子：剔除无标注、助手自己的话、断点标记、空文本', () => {
  const picked = pickSpeakerLines([
    { speaker: '张三', text: '有效' },
    { text: '没标注' },
    { speaker: '助手', text: '我自己说的', role: 'assistant' },
    { speaker: '语音识别', text: '〔断线约 3 秒〕', src: 'gap' },
    { speaker: '李四', text: '   ' },
  ])
  assert.equal(picked.length, 1)
  assert.equal(picked[0].text, '有效')
})

test('整场没有标注 → 判定不可提取', () => {
  assert.equal(hasSpeakerLabels(unlabeled), false)
  const why = whyNoPersona(unlabeled)
  assert.match(why, /没有说话人标注/)
  assert.match(why, /别人的观点记成你的立场/, '要说明为什么，而不是只写"跳过"')
})

test('整场没有内容 → 另一种说明', () => {
  assert.match(whyNoPersona([]), /没有可用的转写/)
})

test('有标注 → 可以提取（返回空串）', () => {
  assert.equal(whyNoPersona(labeled), '')
})

test('拼装：带说话人前缀，并列出说话人', () => {
  const r = renderSpeakerTranscript(labeled)
  assert.match(r.text, /张三：这个方案风险太大/)
  assert.deepEqual(r.speakers.sort(), ['张三', '李亚峰', '李四'].sort())
  assert.equal(r.omitted, 0)
})

test('超长时保留首尾并标注省略', () => {
  const many = Array.from({ length: 120 }, (_, i) => ({ speaker: i % 2 ? '张三' : '李亚峰', text: '第' + i + '句' }))
  const r = renderSpeakerTranscript(many, { headLines: 10, tailLines: 10 })
  assert.ok(r.omitted > 0)
  assert.match(r.text, /中间省略 \d+ 句/)
  assert.match(r.text, /第0句/)
  assert.match(r.text, /第119句/)
})

test('拼装总量受字数限制', () => {
  const many = Array.from({ length: 50 }, () => ({ speaker: '张三', text: '很'.repeat(200) }))
  const r = renderSpeakerTranscript(many, { maxChars: 400 })
  assert.ok(r.text.length <= 400, '实际 ' + r.text.length)
})

test('认人：说话人字段命中或文本里出现名字都算她', () => {
  const names = ['李亚峰', '亚峰']
  assert.equal(isHerLine({ speaker: '李亚峰', text: 'x' }, { names }), true)
  assert.equal(isHerLine({ speaker: '张三', text: '亚峰说的对' }, { names }), true)
  assert.equal(isHerLine({ speaker: '张三', text: '我同意' }, { names }), false)
})

test('认不出来时不猜（返回 false）', () => {
  assert.equal(isHerLine({ speaker: '', text: '随便一句' }, { names: ['李亚峰'] }), false)
  assert.equal(isHerLine({ speaker: '李亚峰', text: 'x' }, { names: [] }), false, '没有名字池就不认')
})

test('择优：优先会后重转写产物，其次实时转写', () => {
  const off = [{ speaker: '说话人1', text: '离线分离出的句子' }]
  const live = [{ speaker: '张三', text: '实时的一句' }]

  const a = choosePersonaSource({ offline: off, live })
  assert.equal(a.source, 'offline', '有离线产物时优先用它')
  assert.ok(a.lines.length >= 1)

  const b = choosePersonaSource({ offline: [], live })
  assert.equal(b.source, 'live')

  const c = choosePersonaSource({ offline: [], live: unlabeled })
  assert.equal(c.source, 'none', '都没有就没得提取')
  assert.equal(c.lines.length, 0)
})

test('跳过时给出开启方法（不能只说跳过）', () => {
  const h = enableHint()
  assert.match(h, /speakerDiarization/, '要告诉人打开哪个配置')
  assert.match(h, /会后重转写/, '或者说明用会后重转写的分离结果')
})
