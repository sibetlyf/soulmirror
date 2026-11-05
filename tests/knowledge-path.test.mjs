import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { currentProfileName, hostHasKnowledge, detectKnowledge, isHostProfile } from '../lib/knowledge.js'

/**
 * "自动调用知识库"的路径问题。
 *
 * 三处都曾写死过，任何一处错都会导致：纪要生成了，但静默不写库。
 *   ① profiles 根目录（homedir()/.dsh/profiles）→ 已改为运行时推导
 *   ② 宿主 profile 名（写死 'web'）→ 本文件验证
 *   ③ 宿主端口（取不到就跳过）→ 现在有兜底与诊断
 */

const src = readFileSync(new URL('../index.js', import.meta.url), 'utf8')
const kb = readFileSync(new URL('../lib/knowledge.js', import.meta.url), 'utf8')

test('当前 profile 名能被解析出来（不返回空）', () => {
  const cur = currentProfileName()
  assert.ok(cur && cur.length > 0, '解析不出当前 profile 名，写库会判成"宿主没装"')
})

test('hostHasKnowledge 以当前 profile 优先，不再只认 web/tui', () => {
  assert.match(kb, /const cur = currentProfileName\(\)/, 'hostHasKnowledge 应先用当前 profile')
  assert.match(kb, /if \(cur\) order\.push\(cur\)/, '应当把当前 profile 排在最前')
})

test('isHostProfile 与当前 profile 比较', () => {
  const cur = currentProfileName()
  assert.equal(isHostProfile(cur), true, '当前 profile 应被认定为主机 profile')
  assert.equal(isHostProfile('definitely-not-this-profile'), false)
})

test('detectKnowledge 的候选里带上当前 profile，sameAsHost 是实际比较', () => {
  assert.match(kb, /const curProfile = currentProfileName\(\)/, '候选应包含当前 profile')
  assert.match(kb, /sameAsHost: !!pick && pick === currentProfileName\(\)/, 'sameAsHost 应为实际比较')
})

test('本机检测结果自洽：装了知识库且宿主就是它', () => {
  const k = detectKnowledge('')
  if (!k.installed) {
    // 没装知识库的环境也允许，但此时必须明确说"未安装"，不能含糊
    assert.match(k.reason, /未检测到/)
    return
  }
  assert.ok(k.host, '装了知识库但 host 为空，host 模式会走不通')
  assert.equal(k.sameAsHost, k.profile === currentProfileName())
})

test('宿主端口有多来源兜底，并把尝试情况留在 /status', () => {
  assert.match(src, /function resolveHostPort\(\)/, '缺少端口解析函数')
  const at = src.indexOf('function resolveHostPort()')
  const seg = src.slice(at, at + 900)
  assert.match(seg, /server\?\.address\?\.\(\)|server\.address/, '应尝试 server.address().port')
  assert.match(seg, /DSH_WEB_PORT|DASH_PORT|PORT/, '应有环境变量兜底')
  assert.match(src, /hostPort: hostPortInfo/, '/status 应暴露端口解析情况')
})

test('写库失败时带上实际请求地址与日志', () => {
  assert.match(src, /const origin = 'http:\/\/127\.0\.0\.1:' \+ port/, '应显式计算 origin')
  const at = src.indexOf('写入失败：')
  assert.ok(at > 0, '找不到失败分支')
  const seg = src.slice(at, at + 400)
  assert.match(seg, /knowledge-local\/v1\/entries/, '失败时应显示打的哪个 URL')
  assert.match(seg, /知识库写入失败/, '失败时应记日志')
})

test('不再有任何写死的 profiles 根目录', () => {
  assert.equal(/const PROFILES\s*=/.test(kb), false, 'knowledge.js 不应再有 PROFILES 常量')
})
