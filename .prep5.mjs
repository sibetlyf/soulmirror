const base = 'http://127.0.0.1:3080/api/soulmirror'

async function post(path, body) {
  const res = await fetch(base + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  let json = null
  try { json = JSON.parse(text) } catch { /* ignore */ }
  return { status: res.status, json, text }
}

// ① 采集设备留空 = 启动时问系统"会议进程往哪个端点放声音"
const r1 = await post('/config', { devices: { capture: '' } })
console.log('① 采集设备改为跟随：HTTP ' + r1.status + '  capture=[' + (r1.json?.devices?.capture ?? '?') + ']')

// ② 打开总开关
const r2 = await post('/auto', { action: 'start' })
console.log('② 开启：HTTP ' + r2.status + '  enabled=' + r2.json?.enabled + '  armed=' + r2.json?.armed + '  auto=' + r2.json?.auto)

// ③ 复核
const st = await fetch(base + '/status').then((r) => r.json())
console.log('③ 复核：enabled=' + st.enabled + '  capturing=' + st.session?.capturing)
console.log('   配置 capture=[' + (st.config?.devices?.capture ?? '?') + ']  captureAuto=' + st.config?.devices?.captureAuto)
