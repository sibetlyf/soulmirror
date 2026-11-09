import { defaultRenderDevice, listDevices } from 'file:///G:/dsh-test/soulmirror/lib/bridge.js'

const def = await defaultRenderDevice()
console.log('系统默认播放设备：', def ? def.name : '(读不到)')

const list = await listDevices()
const render = (Array.isArray(list) ? list : []).filter((d) => d.flow === 'RENDER')
console.log('\n全部渲染端点：')
for (const d of render) console.log('  ' + d.index + '  ' + d.name + (def && d.name === def.name ? '   ← 默认' : ''))
