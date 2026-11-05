# 一句话完成一场会：SoulMirror 的工作流

SoulMirror 是 **DSH 的插件**，不是独立应用。所以它不提供自己的"应用入口"——
一切都在 DSH 的对话里发生：用户说一句话，会话里的 agent 调用本插件的工具完成。

## 原则

1. **对话就是入口**。用户直接在 DSH 对话框说「帮我在腾讯会议约个明天的周会」，
   或者让桌宠新建一个对话，都落到同一件事：**新建/进入一个会话，把话投进去**。
2. **别自己解析时间**。时间交给 `meeting_auto_attend`（内部解析 `at`）。
3. **别自己剪辑音频、算纪要**。转写用 `meeting_transcript`，纪要用 `meeting_minutes`。
4. 每一步先看返回的 `ok` 与 `result`，失败就把原因原样告诉用户，不要美化。

## 场景一：预约会议 + 到点自动参会

用户："明天下午三点约个半小时的周会，腾讯会议"

```
1) （可选）meeting_apps                 # 看本机装了哪些会议软件
2) 建会议（用 tencent-meeting 的工具，或用户已有会议号）
3) meeting_auto_attend {
     at: "2026-11-06 15:00",
     code: "123-456-789",               # 或 url
     title: "周会", durationMin: 30
   }
```

到点后 DSH 的自动化任务会向会话投递"去入会"，会话再调：

```
meeting_join { code | url }             # 优先级：链接 > 会议号 > 界面点击
meeting_agent_start                      # 开始采集 + 转写 +（可选）Agent 发言
```

## 场景二：现在就开始 / 正在开会

```
meeting_join { code }
meeting_agent_start
meeting_status                           # 采集/转写/发言状态
```

| 想要 | 调 |
|---|---|
| 让 agent 在会里说话 | `meeting_mode {mode:"agent"}` |
| 念一句话 | `meeting_say {text}` |
| 看当前转写 | `meeting_transcript` |
| 不等散会就要纪要 | `meeting_minutes` |

## 场景三：散会收尾

```
meeting_agent_stop                       # 停采集 → 自动进入会后整理
```

会后整理自动进行，状态机：

```
idle → stopping → offline（云端分人重转写）→ minutes（生成纪要）→ done
                                                        ↘ error（附原因）
```

进度看 `GET /api/soulmirror/status` 的 `postMeeting`，或看桌宠头顶。

## 场景四：一步到位

```
meeting_run { request: "帮我在腾讯会议预约明天下午三点的周会，半小时" }
```

它的行为是：**新建一个 DSH 对话**（cwd 与会议会话一致，能看到知识库），
把这句话作为第一句投进去，由那个会话里的 agent 自己调度工具。
结果同时上桌宠气泡。

## 给桌宠（fork 版）的接法

不要另造 HTTP 入口。正确的三条路，按推荐顺序：

1. **投递到当前 DSH 会话**：桌宠客户端拿不到宿主服务时，用 DSH 自己的输入框
   把话发出去即可（等价于用户自己打字）。
2. **让桌宠的宿主半边调宿主服务**：`ctx.get('sessionController')` 建会话 +
   `prompt`，与 `meeting_run` 完全同一条路径。
3. **调用本插件的工具** `meeting_run`（需要它在同一个 DSH 进程里）。

## 失败时怎么说

| 看到 | 怎么说 |
|---|---|
| `插件未开启` | 先在侧边栏「会议」里打开开关 |
| `需要会议号或入会链接` | 问用户要会议号 |
| `时间解析失败` | 重复用户原话，请他给更明确的说法 |
| `没有可用模型` | 提示在设置里配模型；判定链路靠它 |
| `policy=observe` | 说明当前是"只听不说" |

## 别做的事

- 不要 `Start-Process` 去点会议软件（有 `meeting_join`）。
- 不要自己录音、切片、调 ASR（插件已经在做）。
- 不要在没确认时间的情况下让 `meeting_auto_attend` 猜时间。
- 不要为"让桌宠能说话"再开一个 `/run` 之类的旁路接口——那是把插件当成应用做。
