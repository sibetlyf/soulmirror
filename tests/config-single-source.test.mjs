import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/**
 * 大小页面必须是**同一份配置**。
 *
 * 用户反馈："大小页面为什么不是一个配置啊"。
 * 根因：大页面、设置向导、设备卡各自 fetch 一份 /config，各存各的 React state，
 * 所以在 A 处改了设置，B 处看不到（得刷新），看起来像两套配置。
 *
 * 现在：一个 cfgStore + 一组订阅者；任何保存都写回 store，所有界面立刻同步。
 */

const client = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')

test('只有一处发起 GET /config（共享 store 内部）', () => {
  const gets = [...client.matchAll(/fetch\('\/api\/soulmirror\/config'\)/g)]
  assert.equal(gets.length, 1, '不该再有组件各自去 GET 配置，实际 ' + gets.length + ' 处')
})

test('三个原本各自取配置的组件都改用 useConfig()', () => {
  // 大页面与设置向导
  for (const fn of ['function ConfigTab(']) {
    const at = client.indexOf(fn)
    assert.ok(at > 0, '找不到 ' + fn)
    const seg = client.slice(at, at + 3000)
    assert.match(seg, /useConfig\(\)/, fn + ' 应使用共享配置')
  }
  // 第三处（设备/设置卡）——按声明次数断言，避免依赖具体函数名
  const uses = [...client.matchAll(/useConfig\(\)/g)].length
  assert.ok(uses >= 2, '配置编辑器应使用唯一共享store，实际 ' + uses)
  assert.match(client, /function MeetingPage\(props\) \{ return React.createElement\(MeetingWorkspace/, '页面不再维护第二份配置，而是共用工作台')
  assert.match(client, /h\(ConfigTab\)/, '工作台复用同一个配置编辑器')
  assert.match(client, /v\.display\.width/, '显示配置来自服务端view而非独立本地配置')
})

test('保存后写回共享 store（另一页立刻同步）', () => {
  assert.match(client, /cfgStore\.set\(j\)/, '保存接口返回后要更新共享配置')
  assert.match(client, /set: function \(data\)/, 'store 要有 set')
  assert.match(client, /emit: function \(\)/, 'store 要通知订阅者')
})

test('store 自带防重复加载（多个组件同时挂载只请求一次）', () => {
  const at = client.indexOf('ensure: function (force)')
  const seg = client.slice(at, at + 400)
  assert.match(seg, /if \(cfgStore\.loading\) return/, '正在加载时不要重复请求')
  assert.match(seg, /if \(cfgStore\.data && !force\) return/, '已有数据就用缓存')
})
