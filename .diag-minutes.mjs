import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

const dir = join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'soulmirror', '2026-11-09T08-58-06-auto')

console.log('=== minutes.md（全文）')
console.log(readFileSync(join(dir, 'minutes.md'), 'utf8'))

console.log('\n=== 账本前 8 句')
const lines = readFileSync(join(dir, 'transcript.jsonl'), 'utf8').split('\n').filter(Boolean)
for (const l of lines.slice(0, 8)) {
  try {
    const j = JSON.parse(l)
    console.log('  [' + (j.speaker || '无标注') + '] ' + String(j.text || '').slice(0, 60) + (j.replaces ? '  ←replaces' : ''))
  } catch { console.log('  (坏行)') }
}

console.log('\n=== 账本后 5 句')
for (const l of lines.slice(-5)) {
  try {
    const j = JSON.parse(l)
    console.log('  [' + (j.speaker || '无标注') + '] ' + String(j.text || '').slice(0, 60))
  } catch { /* ignore */ }
}

console.log('\n=== 说话人标注统计')
let withSpk = 0
const speakers = new Set()
for (const l of lines) {
  try {
    const j = JSON.parse(l)
    if (j.speaker) { withSpk++; speakers.add(j.speaker) }
  } catch { /* ignore */ }
}
console.log('  ' + withSpk + '/' + lines.length + ' 句有说话人；说话人：' + Array.from(speakers).join('、'))
