const fs = require('node:fs')
const p = 'G:/dsh-test/soulmirror/index.js'
let t = fs.readFileSync(p, 'utf8')
let n = 0

// ① 导入
if (!t.includes("from './lib/persona.js'")) {
  console.log('WARN: persona 导入行未匹配')
} else if (!t.includes('fullPersonaBlock')) {
  t = t.replace(/import \{([^}]*)\} from '\.\/lib\/persona\.js'/, (m, inner) => {
    return 'import {' + inner.replace(/\s*$/, '') + ', loadProfile, saveProfile, fullPersonaBlock } from \'./lib/persona.js\''
  })
  n++
}
if (!t.includes("from './lib/persona-growth.js'")) {
  t = t.replace(
    "import { readLogText, linesToText } from './lib/transcript-log.js'",
    "import { readLogText, linesToText } from './lib/transcript-log.js'\n" +
    "import { mergeProfile, renderProfile, emptyProfile } from './lib/persona-growth.js'",
  )
  n++
}

// ② 会后提取：改结构化五层
const oldExtract = `        const out = await completer([
          {
            role: 'system',
            content: '从会议纪要里抽取值得长期记住的两类信息，只输出 JSON：'
              + '{"user":["关于参会者/用户本人的稳定事实或偏好"],"state":["当前项目进展/下一步"]}。'
              + '没有就给空数组；每条不超过 40 字；不要编造。',
          },
          { role: 'user', content: md.slice(0, 6000) },
        ])
        const jsonText = String(out).replace(/^\`\`\`(?:json)?|\`\`\`$/g, '').trim()
        const j = JSON.parse(jsonText)
        const r1 = appendPersonaSection(personaDir, 'user', j.user, { stamp })
        const r2 = appendPersonaSection(personaDir, 'state', j.state, { stamp })
        results.personaDetail = '新增 user ' + r1.added + ' 条、state ' + r2.added + ' 条（重复跳过 ' + (r1.skipped + r2.skipped) + '）'
        personaAt = 0
        results.persona = (j.user || []).length + (j.state || []).length + ' 条'`

const newExtract = `        // 结构化提取：不只记"事实"，还要记"她怎么说话、站哪边、怎么判断"
        const existing = loadProfile(personaDir)
        const knownText = existing ? renderProfile(existing, { maxChars: 1500 }) : ''
        const out = await completer([
          {
            role: 'system',
            content: [
              '你在帮一个会议助理"长成用户本人"。从这场会议里抽取**关于用户本人**的信息，只输出 JSON。',
              '',
              '五个分区（section 取值只能用它）：',
              '- identity：长期不变的身份（职位、团队、负责的项目、汇报关系）',
              '- style：她怎么说话（语气、句长、常用词/口头禅、忌讳的说法）',
              '- stance：她的立场与偏好（优先级、判断标准、红线、明确反对什么）',
              '- facts：关于她的稳定事实（习惯、工具、协作对象）',
              '- state：当前阶段的项目进展/下一步（会过期）',
              '',
              '输出格式：{"items":[{"section":"stance","key":"上线节奏","value":"先小范围验证再全量","confidence":0.8}]}',
              '规则：',
              '1. key 用 2~8 个字概括主题（同一主题以后会用来判重/取代，请保持稳定）',
              '2. value 一句话、不超过 40 字、必须是她本人的事（不是会议内容摘要）',
              '3. confidence 0~1：她明确表达/反复强调给高分，推断给低分',
              '4. 只写会议里**能证实**的；不确定就不写，宁缺勿编',
              '5. 已经有的事实不要重复列举；若有变化，用同一个 key 写新值',
            ].join('\\n'),
          },
          ...(knownText ? [{ role: 'user', content: '已知画像（避免重复）：\\n' + knownText }] : []),
          { role: 'user', content: '本场会议纪要：\\n' + md.slice(0, 6000) },
        ])
        const jsonText = String(out).replace(/^\`\`\`(?:json)?|\`\`\`$/gm, '').trim()
        const parsed = JSON.parse(jsonText)
        const items = Array.isArray(parsed) ? parsed : (parsed.items || [])
        const merged = mergeProfile(existing || emptyProfile(), items)
        saveProfile(personaDir, merged.profile)
        // 人类可读的 markdown 也同步追加一份（便于直接翻看）
        const bySection = (s) => items.filter((x) => x && x.section === s).map((x) => x.value)
        const r1 = appendPersonaSection(personaDir, 'user', [...bySection('identity'), ...bySection('facts')], { stamp })
        const r2 = appendPersonaSection(personaDir, 'state', bySection('state'), { stamp })
        results.personaDetail = '画像：新增 ' + merged.stats.added + ' 条、强化 ' + merged.stats.reinforced +
          ' 条、取代 ' + merged.stats.superseded + ' 条、过期 ' + merged.stats.expired +
          ' 条（markdown 追加 ' + (r1.added + r2.added) + ' 条）'
        personaAt = 0
        results.persona = items.length + ' 条'`

if (t.includes(oldExtract)) { t = t.replace(oldExtract, newExtract); n++ }
else console.log('WARN: 提取块未匹配')

fs.writeFileSync(p, t, 'utf8')
console.log('会后提取已升级，改', n, '处')
