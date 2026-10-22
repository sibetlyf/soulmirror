// 繁转简自检
import { toSimplified } from '../lib/t2s.js'

const cases = [
  ['我們討論一下進度和預算', '我们讨论一下进度和预算'],
  ['謝謝大家，會議結束', '谢谢大家，会议结束'],
]
let ok = true
for (const [input, want] of cases) {
  const got = toSimplified(input)
  const pass = got === want
  if (!pass) ok = false
  console.log((pass ? 'PASS ' : 'FAIL ') + input + ' -> ' + got)
}
process.exit(ok ? 0 : 1)
