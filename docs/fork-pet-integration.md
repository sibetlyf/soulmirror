# 让桌宠的对话落到 DSH 会话（fork 改动指南）

目标：对桌宠说「帮我在腾讯会议约个明天的周会」时，**不**让桌宠用自己的模型闲聊，
而是**新建一个 DSH 会话**把这句话投进去，由那个会话里的 agent 用插件完成。

对应 fork：`https://github.com/sibetlyf/dsh-pet.git`
核查结论：该 fork 当前与上游一致（HEAD `1684a81`），下面是要加的东西。

## 现状（为什么现在接不上）

| 环节 | 位置 | 现在做什么 |
|---|---|---|
| 用户说话 | `POST /dsh-pet-7340/chat` | 进 `src/host/routes/chat.ts` |
| 生成回复 | `src/host/chat.ts` `generateChat()` | **桌宠自己调模型**，写它自己的记忆 |
| 结果 | `pets.<id>.say` | 只进气泡，不经过 DSH 会话 |

所以它是一条**闭环**：用户 → 桌宠模型 → 气泡。DSH 完全不知道用户说了什么。

## 改动一：宿主可用的服务里加上会话能力

`dsh-pet/src/host/index.ts` 第 32 行：

```ts
// 现在
export const inject = ['webServer', 'agentDefaultModel', 'credentials', 'llm', 'commands', 'connection']

// 改成（追加 sessionController）
export const inject = ['webServer', 'agentDefaultModel', 'credentials', 'llm', 'commands', 'connection', 'sessionController']
```

> 注意：`sessionController` 是 DSH 宿主服务；如果这个 fork 跑在**独立模式**
> （`lib/standalone.js`，脱离 DSH）下会拿不到，需要判空降级——见改动四。

## 改动二：`/chat` 分流——命中"要我干活"的话就走 DSH 会话

`dsh-pet/src/host/routes/chat.ts` 的真实接点是 **`postChat()` 里的 `deps.chatWithPet`**
（第 119–132 行；不是 `generateChat`，那是被 `chatWithPet` 内部调用的）：

```ts
// 现在（L132）
return okResult(await deps.chatWithPet(petId, text, admitted.ref))
```

在它之前插入分流：

```ts
// 新增：把"交给 DSH 干活"和"跟桌宠闲聊"分开
const delegate = decideDelegate(o.text)          // 见改动三
if (delegate.type === 'session') {
  const r = await deps.runInDshSession(delegate.text, { petId })
  return okResult({ ok: r.ok, delegated: true, sessionId: r.sessionId, text: r.text ?? '', error: r.error })
}
```

`deps.chatWithPet` 的实现由 `createHostSetup` 注入（找 `chatWithPet:` 的定义），
它内部才调 `generateChat()`。所以分流放路由层最省事——不用改 generateChat 的签名。

`delegated: true` 这一条很重要：客户端拿到它可以显示"已在新对话里处理"，
而不是等着桌宠用自己的口吻编一句。

## 改动三：分流规则（放在 `src/host/chat-action.ts` 旁边新建 `delegate.ts`）

```ts
/** 命中这些动词就认为"用户要办事"，不是闲聊。 */
const TASK_CUE = /(预约|约个会|约一个会|订个会|安排.{0,4}会|开始听|开始录音|结束录音|散会|纪要|整理一下|帮我在|帮我查|提醒我)/

export function decideDelegate(text: string): { type: 'chat' | 'session'; text: string } {
  const t = String(text ?? '').trim()
  if (!t) return { type: 'chat', text: t }
  if (TASK_CUE.test(t)) return { type: 'session', text: t }
  return { type: 'chat', text: t }
}
```

**宁可少判**：只有明确要办事才转；闲聊继续用桌宠自己的人设，
否则每句话都开新会话，用户会被一堆会话淹没。

## 改动四：新建会话并投递（放 `src/host/routes/chat.ts` 的 deps 实现里）

```ts
async function runInDshSession(text: string, { petId }: { petId: string }) {
  const controller = ctx.get?.('sessionController')
  if (!controller) return { ok: false, error: '当前模式没有 DSH 会话（独立模式）', sessionId: '' }
  try {
    const created = await controller.create({})                  // 新对话
    const sessionId = created?.sessionId
    if (!sessionId) return { ok: false, error: 'create 没有返回 sessionId', sessionId: '' }
    await controller.rename({ sessionId, title: '桌宠 · ' + text.slice(0, 18) }).catch(() => {})
    // 投递并等这一轮结束；超时可以用 120s
    const r = await promptAndWait(controller, sessionId, text, 120_000)
    return { ok: r.ok, sessionId, text: r.text, error: r.error }
  } catch (e: any) {
    return { ok: false, error: String(e?.message ?? e), sessionId: '' }
  }
}
```

`promptAndWait` 的最小实现（订阅会话事件，等到 `turn/end`）：

```ts
function promptAndWait(controller: any, sessionId: string, text: string, timeoutMs: number) {
  return new Promise<{ ok: boolean; text: string; error: string }>((resolve) => {
    let out = ''
    let failed = ''
    const off = ctx.on('session/event', (ev: any) => {
      if (ev?.sessionId !== sessionId) return
      if (ev.type === 'text-delta' && ev.text) out += ev.text
    })
    const timer = setTimeout(() => { off?.(); resolve({ ok: false, text: out, error: 'timeout' }) }, timeoutMs)
    controller.prompt({ requestId: crypto.randomUUID(), sessionId, mode: 'queue', content: [{ type: 'text', text }] })
      .then(() => {
        // 需要按实际事件名等待结束；这里给出形状，具体事件名以 DSH 版本为准
      })
      .catch((e: any) => { clearTimeout(timer); off?.(); resolve({ ok: false, text: out, error: String(e?.message ?? e) }) })
  })
}
```

> 这一段的**事件名与结束条件必须以你 fork 里实际可用的 DSH 版本为准**。
> soulmirror 侧已经有一份可用实现，可直接抄：
> `soulmirror/lib/dsh-session.js` 的 `promptSession()` —— 它是跑通过的（等 `turn/end`、
> 收集 `text-delta`、超时与错误都处理了）。

## 改动五：配置开关（可选但建议）

在 `src/host/config/merge.ts` 的宠物布尔字段区加：

```ts
delegateToDsh: petBool(p.delegateToDsh, base.delegateToDsh, label, 'delegateToDsh', id),
```

默认 `false`。打开后 `/chat` 才做分流，避免 fork 默认行为与上游不一致。

## 改完的链路

```
用户对桌宠说话
  → POST /chat
  → decideDelegate()
       ├─ 闲聊 → generateChat()（原样，桌宠口吻）
       └─ 要办事 → controller.create() 建新对话
                   → prompt(text)
                   → 会话里的 agent 调 soulmirror 的工具
                     （meeting_auto_attend / meeting_join / meeting_agent_start …）
                   → 结果回写气泡 + 返回 { delegated:true, sessionId }
```

## soulmirror 这边不用改

- 状态/气泡/菜单三条线已就绪（`lib/pet-dsh.js`、`lib/pet-display.js`）。
- 工具齐全（35 个 `meeting_*`），`meeting_run` 也走"新建 DSH 对话"。
- **不要再为桌宠加 `/run` 之类的旁路接口**——插件不是应用。
