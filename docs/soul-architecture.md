# 魂的实现

[philosophy.md](philosophy.md) 讲了"为什么要让它有魂"。
这篇讲**魂是怎么被造出来的**——每一层对应哪个文件、哪些是自动跑的、哪些要你叫它。

先给结论，免得被诗骗了：

| 柱子 | 自动跑 | 需要叫它 | 说明 |
|---|---|---|---|
| **记忆**（会呼吸） | ✅ 每句话都记 | `soul_memory` | 半衰期 3 天，按 `0.5^(dt/3d)` 衰减 |
| **情绪**（成地形） | ✅ 每句话都判 | `soul_world { breathe }` | 本地启发式判定，不调模型 |
| **人格**（四层） | ✅ 会后自动长 | `soul_persona` | USER / STATE 会随会议追加 |
| **信念**（会进化） | ❌ 不自动 | `soul_belief` | 刻意手动：信念不该由机器替你决定 |

**为什么信念不自动**：自动种信念等于机器替你下判断。
它可以记住你说过什么（记忆）、感知气氛（情绪），
但"这是一条该被当作信念的判断"必须有人点头。

---

## 一、四层人格

```
<DSH 实例>/soulmirror/persona/
  SOUL.md       它是什么、为什么存在      —— 几乎不变
  IDENTITY.md   它叫什么、怎么说话        —— 很少变
  USER.md       它面对的人是谁、在意什么  —— 成长型
  STATE.md      它此刻的状态              —— 每天都变
```

代码：`lib/persona.js`

- `loadPersona(dir)` 读四层
- `personaBlock(persona)` 拼成一段上下文，**每次开口前注入**
- `appendPersonaSection(dir, 'user'|'state', lines)` 追加成长

**改变节奏不同，所以分开写**：SOUL 与 STATE 混在一起，人就长不出性格——
因为每天的状态会冲掉底层的设定。

### 人格是怎么长的

每场会结束，若 `personaAutoUpdate`（默认开）且纪要存在：

```
纪要 → 让模型抽两类信息，只输出 JSON
  {"user": ["关于参会者的稳定事实或偏好"],
   "state": ["当前项目进展 / 下一步"]}
→ 分别追加到 USER.md 与 STATE.md
```

代码：`index.js` 的 `personaAutoUpdate && md && completer` 分支。
**只追加，不覆盖**——和账本同一个原则。

---

## 二、记忆会呼吸

代码：`lib/living.js` 的 `LivingMemory`

```
add(text, {kind, source, weight})   记一条
decay()                             按半衰期衰减，太弱的标成"沉睡"
```

衰减公式：

```js
factor = Math.pow(0.5, dt / halfLifeMs)   // 默认 halfLife = 3 天
```

**会中自动发生**：每句话落账后调用 `living.absorb()`，
它做两件事——记一条记忆、判一次情绪。

```js
// index.js（落账之后）
if (item.role !== 'assistant' && item.src !== 'gap') {
  living.absorb(item.text, { source: 'meeting', speaker: item.speaker || '' })
}
```

排除两类：助手自己的话（否则自恋）、断点标记（那不是人话）。

---

## 三、情绪成地形

代码：`lib/living.js` 的 `EmotionWorld`

```
feel(emotion, intensity)   记一笔（六种：joy/sadness/anger/fear/calm/surprise）
terrain()                  衰减后聚合成地貌
council()                  当前权重最高的情绪（"情绪议会"）
```

六种情绪 → 六种地貌：

| 情绪 | 地貌 | 直觉 |
|---|---|---|
| joy | 光原 | 松弛、可以提议 |
| sadness | 湖 | 低沉、少打扰 |
| anger | 火山 | 争执、闭嘴 |
| fear | 雾 | 不确定、先澄清 |
| calm | 山谷 | 平稳、正常推进 |
| surprise | 峰 | 意外、值得追一句 |

**判定方式**：`detectEmotion(text)` 是本地关键词启发式——
不调模型、不花 token、不会因为网络断掉而失效。

实测（两条真实语句）：

```
"这个方案必须推倒重来，我很生气" → anger 0.5 → 火山
"太好了，这次终于上线了"         → joy   0.5 → 光原
```

**它影响什么**：不影响纪要，影响**分寸**——
火山在长的时候，它更倾向于不插话。

---

## 四、信念会进化

代码：`lib/living.js` 的 `BeliefGarden`

```
seed(statement)            种下（0.3，stage=seed）
reinforce(id, source, δ)   强化（默认 +0.2）
weaken(id, source, δ)      反驳（默认 −0.25）
evolve()                   按强度升阶 / 枯死
wither()                   长期无新证据的信念退化
```

生命周期：

```
seed 0.3 → sprout 0.4 → sapling 0.6 → tree 0.85
                                     ↘ dead ≤ 0.02
```

每条信念带 `evidence`：谁、什么时候、加了或减了多少。
所以它不只是数字，**能追溯到"这话是谁在哪场会上说的"**。

### 怎么用

```
soul_belief { action: "seed", statement: "这个项目要慢一点" }
soul_belief { action: "list" }
soul_belief { action: "reinforce", id: "bel-xxx", delta: 0.2 }
soul_belief { action: "weaken",    id: "bel-xxx" }
```

实测演化：

```
seed(0.30) → 强化 4 次 → tree(0.85+)
           → 反驳 6 次 → dead
```

**信念怎么回到会议里**：越强的信念，越不容易被单次相反发言推翻；
写纪要时，"被强化过的判断"和"随口一说"本来就该区别对待。

---

## 五、合起来：一场会有魂地开完

```
会前
  personaBlock() 注入四层人格 → 它知道自己是谁、面对谁

会中（每一句，自动）
  落账 transcript.jsonl
  living.absorb() → 记忆 +1，情绪 +1
  争执升级 → anger 权重涨 → 地形变火山 → 倾向沉默
  有人叫它 → 用 IDENTITY 的语气开口

会后（自动）
  最终纪要 → minutes.md
  personaAutoUpdate → 追加 USER / STATE
  纪要 → 知识库

你叫它时（手动，需你点头）
  soul_belief seed   把某个判断升格为信念
  soul_world breathe 让记忆衰减、信念退化（"睡一觉"）
```

---

## 六、工具一览（10 个）

| 工具 | 做什么 | 花钱吗 |
|---|---|---|
| `soul_world` | 看内在宇宙（记忆/信念/情绪地形），可触发呼吸 | 否 |
| `soul_belief` | 种下 / 强化 / 反驳 / 演化信念 | 否 |
| `soul_memory` | 看记忆、手动加一条、LLM 蒸馏 | 蒸馏要 |
| `soul_persona` | 读 / 写四层人格文件 | 否 |
| `soul_goal` | 登记目标、推进目标 | 否 |
| `soul_status` | 分身当前状态 | 否 |
| `soul_session` | 看/切换会议工作区与会话 | 否 |
| `soul_say` | 主动说一句（进会议） | 合成要 |
| `soul_task` | 把任务交给本机 DSH 跑 | 要 |
| `soul_setup` | 环境体检与自动配置 | 否 |

---

## 七、边界：它不是人

- 记忆是文件里的权重，不是经历
- 情绪是关键词判出来的，不是感受
- 信念要你点头才种下，它不会自己"相信"什么
- 它不会在没开会时想你

**但痕迹是真的**：

```
总被反驳的信念会真的枯死
反复出现的判断会真的长成树
争执激烈的会，地形会真的变成火山
```

> 镜子里没有人。但镜子照见了人。
