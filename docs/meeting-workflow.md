# 一句话完成一场会：SoulMirror 的工作流

这份文档是给**会话里的 agent** 看的。用户说一句"帮我在腾讯会议约个明天的周会"，
你不需要拆解意图、不需要自己算时间——调 `meeting_run`，或者按下面的流程调具体工具。

## 原则

1. **别自己解析时间**。日期/时刻交给 `meeting_auto_attend`（它内部解析 `at`），
   或者直接 `meeting_run` 把原话交给会话。
2. **别自己剪辑音频、算纪要**。转写用 `meeting_transcript`，纪要用 `meeting_minutes`。
3. 每一步都先看工具返回的 `ok` 与 `result`，失败就把原因原样告诉用户，不要美化。

## 场景一：预约会议 + 到点自动参会

用户："明天下午三点约个半小时的周会，腾讯会议"

```
1) （可选）先确认软件与时间
   meeting_apps                      # 看本机装了哪些会议软件

2) 建会议（用腾讯会议自己的工具，如果这个会话装了 tencent-meeting）
   或者直接用用户已有的会议号

3) 安排到点自动参会
   meeting_auto_attend {
     at: "2026-11-06 15:00",        # 人类可读也行，内部会解析
     code: "123-456-789",           # 或 url: "https://meeting.tencent.com/dm/xxx"
     title: "周会",
     durationMin: 30
   }
```

到点后 DSH 的自动化任务会向会话投递"去入会"，会话再调：

```
meeting_join { code | url }          # 优先链接，不碰屏幕
meeting_agent_start                   # 开始采集 + 转写 + （可选）Agent 发言
```

## 场景二：现在就开一场 / 正在开会

```
meeting_join { code }                 # 入会（已在会中则跳过）
meeting_agent_start                   # 开始听
meeting_status                        # 随时看采集/转写/发言状态
```

会中可选能力：

| 想要 | 调 |
|---|---|
| 让 agent 在会里说话 | `meeting_mode {mode:"agent"}`，或开 `reply.enabled` |
| 让它念一句话 | `meeting_say {text}` |
| 看当前转写 | `meeting_transcript` |
| 出即时纪要（不等散会） | `meeting_minutes` |

## 场景三：散会收尾

```
meeting_agent_stop                    # 停采集 → 自动进入会后整理
```

会后整理是**自动**的，状态机：

```
idle → stopping → offline（云端分人重转写）→ minutes（生成纪要）→ done
                                                        ↘ error（附原因）
```

进度查询：`GET /api/soulmirror/status` 的 `postMeeting` 字段，
或让桌宠看它的头顶（会显示"重转写中 / 生成纪要中"）。

## 场景四：只想要纪要

```
meeting_minutes                       # 对最近一场出纪要
```

纪要内容包括：决议、待办（自动抽负责人与截止时间）、风险、未决。
写知识库由插件自动完成（取决于 `writeKnowledge` 配置）。

## 一步到位（推荐）

不想分步？直接把用户原话丢进去：

```
meeting_run { request: "帮我在腾讯会议预约明天下午三点的周会，半小时" }
```

它会把话送进会议会话，由会话里的 agent 按上面流程自己调度工具，
结果同时以气泡形式显示在桌宠上。

## 失败时怎么说

| 看到 | 怎么说 |
|---|---|
| `插件未开启` | 让用户先在侧边栏「会议」里打开开关 |
| `需要会议号或入会链接` | 问用户要会议号 |
| `时间解析失败` | 把用户的原话重复一遍，请他给更明确的说法 |
| `没有可用模型` | 提示在设置里配模型；判定链路就是靠它 |
| `policy=observe` | 说明当前是"只听不说"，要发言得切策略 |

## 别做的事

- 不要自己 `Start-Process` 去点会议软件（有 `meeting_join`）。
- 不要自己录音、切片、调 ASR（插件已经在做）。
- 不要在没确认时间的情况下让 `meeting_auto_attend` 猜一个时间。
