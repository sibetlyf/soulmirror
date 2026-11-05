const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

import('G:/dsh-test/soulmirror/lib/living.js').then((m) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sm-b-'))
  const w = new m.LivingWorld(dir)
  const b = w.beliefs.seed('这个项目要慢一点')
  console.log('  seed:', JSON.stringify({ stage: b.stage, strength: b.strength }))

  for (let i = 1; i <= 4; i++) {
    w.beliefs.reinforce(b.id, 'meeting', 0.2)
    const x = w.beliefs.all.find((y) => y.id === b.id)
    console.log('  强化 ' + i + ' 次 →', x.stage, x.strength.toFixed(2))
  }
  for (let i = 1; i <= 6; i++) {
    w.beliefs.weaken(b.id, 'contradict', 0.25)
    const x = w.beliefs.all.find((y) => y.id === b.id)
    console.log('  反驳 ' + i + ' 次 →', x.stage, x.strength.toFixed(2))
  }
  // 方法名确认
  console.log('  BeliefGarden 方法:', Object.getOwnPropertyNames(Object.getPrototypeOf(w.beliefs)).join(','))
  fs.rmSync(dir, { recursive: true, force: true })
})
