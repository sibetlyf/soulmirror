const fs = require('node:fs')
const p = 'G:/dsh-test/soulmirror/index.js'
let t = fs.readFileSync(p, 'utf8')

const old = `    try { personaCache = personaBlock(loadPersona(personaDir)) } catch { personaCache = '' }`
const neu = `    try {
      // 四层 markdown（手写底色）+ 结构化画像（会后自动成长）
      personaCache = fullPersonaBlock(personaDir)
    } catch { personaCache = '' }`

if (!t.includes(old)) { console.log('MISS'); process.exit(1) }
t = t.replace(old, neu)
fs.writeFileSync(p, t, 'utf8')
console.log('currentPersona 已改用 fullPersonaBlock')
