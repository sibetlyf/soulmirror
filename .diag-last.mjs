import { readdirSync, statSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

const root = join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'soulmirror')
const dirs = readdirSync(root)
  .filter((d) => d !== 'persona' && d !== 'workspace')
  .map((d) => ({ d, path: join(root, d), m: (() => { try { return statSync(join(root, d)).mtimeMs } catch { return 0 } })() }))
  .filter((x) => existsSync(join(x.path, 'audio.wav')) || existsSync(join(x.path, 'transcript.jsonl')))
  .sort((a, b) => b.m - a.m)
  .slice(0, 3)

for (const x of dirs) {
  console.log('=== ' + x.d)
  for (const f of ['audio.wav', 'transcript.jsonl', 'transcript-offline.jsonl', 'minutes.md', 'meta.json', 'post-meeting.json']) {
    const p = join(x.path, f)
    if (!existsSync(p)) { console.log('  —  ' + f + ' 不存在'); continue }
    const st = statSync(p)
    console.log('  ✓  ' + f + '  ' + (st.size / 1024).toFixed(1) + 'KB  ' + new Date(st.mtimeMs).toLocaleString('zh-CN'))
  }
  // 账本行数
  try {
    const lines = readFileSync(join(x.path, 'transcript.jsonl'), 'utf8').split('\n').filter(Boolean)
    console.log('  账本行数: ' + lines.length)
  } catch { /* ignore */ }
  // meta 里的采集判定
  try {
    const m = JSON.parse(readFileSync(join(x.path, 'meta.json'), 'utf8'))
    console.log('  meta.capture: ' + JSON.stringify(m.capture || null))
  } catch { /* ignore */ }
  console.log('')
}
