# SoulMirror · DSH 数字分身

听会议、懂意图、能开口，还能把活交给 DSH 干完再回来汇报。

## 能力

| | |
|---|---|
| **听** | WASAPI 环回采集会议音频，只采会议客户端所在设备 |
| **转** | 阿里云百炼实时 ASR：中间结果、标点、ITN、顺滑、VAD 断句、时间戳 |
| **校** | 每句用大模型纠同音错字（"大峰/杨峰" → 正确人名），人名取自 `userName` + 唤醒词 |
| **懂** | 判定"是不是在叫我"，支持点名、提问、被交代事项 |
| **说** | 切虚拟麦 → 长按空格 → 流式 TTS → 松开 → 切回 |
| **干** | 被交代任务时自动起 DSH 任务，跑完把结果总结成一句话汇报 |
| **记** | 会后自动写知识库、沉淀人格（USER.md / STATE.md） |

## 安装

```bash
dsh plugin --profile web add "github:sibetlyf/soulmirror#main"
```

装完重启 `dsh web`，首次运行跑一次：

```
soul_setup { action: "auto" }
```

Windows 会自动用系统 `csc` 编译 `tools/mbridge.exe`；macOS / Linux 只做依赖检测。

> PowerShell 里 `#` 会被当注释，ref 必须带引号（上面已加）。

## 依赖

| 平台 | 虚拟声卡 | 自动部署 |
|---|---|---|
| Windows | VB-CABLE | ❌ 内核驱动，手动装 |
| macOS | BlackHole | ❌ brew 需要 sudo |
| Linux | 不用驱动 | ✅ `pactl` 加载 null-sink |

其它：阿里云百炼 Key（ASR/TTS）、任意 OpenAI 兼容模型（判定/纠错/回答）。

## 工具

```
meeting_*  ×21   采集、转写、纪要、发言、窗口控制
soul_task        交给 DSH headless 执行，可当场汇报
soul_say         主动发言
soul_status      分身状态
soul_session     本场会议的工作区与会话
soul_persona     读/写四层人格（soul / identity / user / state）
soul_memory      长期记忆：查看、补记、蒸馏
soul_setup       环境自检：check / build / auto / deps / install-deps / links
```

## 配置

面板里改，或编辑 `~/.dsh/soulmirror/config.json`：

```yaml
userName: 你的名字        # 唤醒词自动派生
activeApp: 腾讯会议
policy: auto              # observe | suggest | auto
asr:  { provider: dashscope, llmCorrect: true }
tts:  { provider: dashscope, model: cosyvoice-v2, voice: longxiaochun_v2 }
twin: { enabled: true, autoDelegate: true, reportSpeak: true }
knowledge:
  mode: host              # host 直连宿主知识库 | agent 交给会话 | headless | off
personaAutoUpdate: true
```

## 插件联动

- **知识库**：默认 `mode: host`，直接调宿主里 `dsh-knowledge` 的本地 API（`/knowledge-local/v1/entries`）写入纪要，**不需要额外安装**；检测不到就跳过，纪要仍落本地。
- **computer-use**：两者都会发键盘事件，同时操作桌面可能抢焦点；分身发言前会把会议窗口置前。
- 体检：`soul_setup { action: "links" }`。

## 目录

```
~/.dsh/soulmirror/
├── config.json
├── persona/{SOUL,IDENTITY,USER,STATE}.md   # 改完即时生效
├── memory.json                             # 长期记忆 + 蒸馏
└── workspace/<会议时间>/                    # 一场会议一个工作区（含 DSH 会话）
```

## 设计要点

- 只在"最终句 + 纠错完成"后才进大脑判定，中间结果只用于显示
- 播报期间按字数估算静音窗口，窗口内转写丢弃，避免自说自听
- 发言前轮询 `mic-usage` 确认会议真的切到虚拟麦，否则不播
- 分身说的每句话带 `role: 'assistant'` 写进转写，面板里高亮

## 自动建会话

会议一开始（检测到进入会议，或手动 `meeting_agent_start`）就会**自动创建一条 DSH 会话**：

```
ensureMeetingSession()  →  dsh --profile headless --json "会议开始…用一句话确认你已就位"
                        →  拿到 sessionId，存进当前会议工作区
```

- 实测约 4.8 秒、一次极短调用，会话立刻出现在 DSH 会话列表里，端侧可查看
- 之后这场会的所有任务（调研、整理、汇报）都续接这条会话
- 关掉：`twin.autoSession: false`

`soul_session` 会显示当前会议的会话 id；端侧打开 DSH 会话列表即可翻看模型每一轮输出。

## 会议身份与会话复用

**同一场会议 → 同一条 DSH 会话**。身份判定顺序：

1. 显式会议号（`soul_session { setMeetingId: "206-275-219" }`）
2. 窗口标题里出现的会议号（`206-275-219` / `206 275 219`）
3. 窗口标题本身（会议主题）
4. 时间戳（兜底）

映射持久化在 `~/.dsh/soulmirror/sessions.json`：

```json
{ "206275219": { "dshSessionId": "session-…", "title": "…", "lastSeen": "…" } }
```

所以退出会议再进去、甚至重启 DSH，只要会议身份一样，`soul_task` 都续接原来那条会话。
`soul_session` 会打印「会议身份 + 来源 + 映射表」。

## 支持的会议软件

| 软件 | 进程名 | 状态 |
|---|---|---|
| 腾讯会议 | `wemeetapp` | 已验证 |
| 移动会议（中移动云视讯） | `CloudVideo` | 进程名已确认，窗口/控件层未实测 |

配置里 `apps` 可加任意软件：

```yaml
apps:
  - { name: 腾讯会议, proc: wemeetapp,  title: 腾讯会议 }
  - { name: 移动会议, proc: CloudVideo, title: 移动会议 }
```

- 进程名比较**不区分大小写**
- `proc` 没填或对不上时，用窗口标题包含的软件名兜底，并自动把推断出的进程名写回配置
- 会议身份会带软件前缀（如 `腾讯会议:206275219`），避免不同软件同名会议撞到同一个会话


## 主动式服务

拿到指令后不是"回一句就完事"，而是：

1. **立刻表态**：「收到，我去查，稍后告诉你。」
2. **后台执行**：任务跑在会议会话里，不阻塞会议
3. **等安静再汇报**：轮询「上一次有人说话」的时间，安静 2.5 秒后才播报；有人正在说就等他说完（最多等 3 分钟）
4. **给简要总结**：用模型把结果压成 1-3 句，而不是念全文

## 让它决定要不要说话（不看关键字）

```yaml
brain:
  gate: llm    # 默认：每句转写都连同上文交给模型判断；rules = 退回关键词规则
```

实测同一段对话：

| 说话内容 | 判定 |
|---|---|
| 然后第二就是他要变成一个有灵魂的东西 | 不插话 |
| 你觉得应该先做日程还是先做记忆？ | 插话（给出观点） |
| 这个模块下周三上线，排期紧 | 不插话 |
| 亚峰帮我查一下今晚的交通 | 回复 + 派任务 |

