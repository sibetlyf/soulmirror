const fs = require('node:fs')
const p = 'G:/dsh-test/soulmirror/tests/soul.test.mjs'
let t = fs.readFileSync(p, 'utf8')

t = t.replace(
  `  const seg = src.slice(at, at + 1200)`,
  `  // 会后更新块变长了（结构化提取 + markdown 追加），窗口要足够大
  const seg = src.slice(at, at + 4000)`,
)

fs.writeFileSync(p, t, 'utf8')
console.log('soul.test 窗口已放宽到 4000')
