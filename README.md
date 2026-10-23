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
| 移动会议（中移动云视讯） | `CloudVideo` | 已验证首页/加入弹窗，支持 `meeting_join` |

配置里 `apps` 可加任意软件：

```yaml
activeApp: 移动会议
apps:
  - { name: 腾讯会议, proc: wemeetapp, title: 腾讯会议,
      classes: "VideoMainWindow|FloatSpeakingWnd|MeetingMainWindow|MeetingView|BaseDialog",
      path: "E:/Tencent/Meeting/WeMeet/wemeetapp.exe" }
  - { name: 移动会议, proc: CloudVideo, title: 移动会议,
      classes: "FrameWorkWnd|MainWindow|ParticipantWnd|VideoCellWnd",
      path: "E:/CloudVideo/CloudVideo.exe" }
```

- 进程名比较**不区分大小写**
- `proc` 没填或对不上时，用窗口标题包含的软件名兜底，并自动把推断出的进程名写回配置
- 会议身份会带软件前缀（如 `腾讯会议:206275219`），避免不同软件同名会议撞到同一个会话
- `activeApp` 决定 `meeting_status` / `meeting_join` / `meeting_leave` 默认操作哪个软件；也可给这些工具传 `app: 移动会议` 临时指定

### 自动识别与自动加入

- `meeting_status` 会扫描所有已配置的会议软件，输出 `[会议中] / [运行中] / [未运行]`，并按 `activeApp` 自动选中当前要操作的软件。`app` 参数可显式覆盖。
- `meeting_auto_join { confirm: true }` 一次完成三件事：
  1. 识别正在运行的会议软件；
  2. 从**剪贴板**或**窗口标题**里提取会议号（支持 `375 509 620`、`375-509-620`、会议链接里的 `会议号：xxx`）；
  3. 调用对应软件的加入流程。
- 传 `code` 时跳过识别：`meeting_auto_join { code: "375509620", confirm: true }`。
- 已在会中会直接拒绝，提示先 `meeting_leave`。

### 移动会议（CloudVideo）加入流程

`meeting_join` 对移动会议会走专用控件：

1. 聚焦 `移动会议` 主窗口；
2. 点首页「加入会议」；
3. 在弹窗的 `lineEditLeft` 填会议号；
4. 点弹窗 `MeetJoinClass.widget.pushButton`；
5. 读取 `TipsDlg`：`会议已结束 / HY20013` 这类会原样返回，不会误报成功。

移动会议的在会界面是自绘窗口，UIA 读不到「离开」按钮；`meeting_leave` 找不到按钮时会用 `Alt+F4` 关闭窗口作为离开。加入前务必确认会议号，界面改版后先用 `meeting_ui dump app=移动会议` 看控件。


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

## 活数据（Living Data）

数据不是死的：记忆会呼吸、信念会进化、情绪聚成心像地形。

### 记忆会呼吸

每条记忆有 `vitality`（0~1），按半衰期指数衰减（默认 3 天）：

```
刚记下  → bloom（绽放）
>0.15   → awake（清醒）
<0.15   → sleep（沉睡）
被想起  → vitality +0.3，沉睡的会重新绽放
```

### 信念会进化

```
seed(0.3) → sprout(0.35) → sapling(0.6) → tree(0.85) → dead(≤0.02)
```

反复强化会长成参天大树，长期被反驳会枯萎死亡（保留墓碑，不删除）。

### 情绪成地形

情绪事件按 1.5 天半衰期聚合，8×8 网格按主导情绪着色，形成心像地图：

| 情绪 | 地形 |
|---|---|
| joy | 光原 |
| sadness | 幽谷 |
| anger | 火山 |
| fear | 迷雾 |
| calm | 静湖 |
| surprise | 风原 |

「情绪议会」是最近 24 小时各情绪的加权票数。活的信念在快照里呈现为建筑。

### 工具

```
soul_world   { breathe? }         # 看内在宇宙；breathe 触发一次衰减/退化
soul_belief  { action, ... }      # list | seed | reinforce | weaken | evolve
soul_goal    { action, ... }      # add | list | run（目标驱动任务代理）
```

数据目录：`~/.dsh/soulmirror/living/`（`memory-living.json` / `beliefs.json` / `emotions.json`），
`/status` 的 `world` 字段也会带回快照，端侧可看。

## 无人值守（自动应答 / 自动继续）

分身半夜开会、跑任务时，DSH 会弹「需要你确认」的卡片。人不在电脑前，这轮就卡死了。

```yaml
autoAnswer:
  enabled: true
  timeoutMs: 5000      # 5 秒没人答，自动按推荐项回答
```

行为：

1. 拦截 `approval/request`，先正常弹出卡片
2. 你在 5 秒内回答 → 用你的答案，插件不插手
3. 5 秒没人答 → 按「推荐项」自动回答（标签里的 `(Recommended)` / `（推荐）`；没有推荐标记时，审批默认 `allowed-once`、问句取第一个选项）
4. agent 继续跑，任务不会停

日志会写：`无人应答，自动选择（recommended-label）：继续 (Recommended) tool · 原因 [session-…]`。

## 测试

```bash
npm test          # 60 个单元 + 集成用例
```

覆盖：活数据（记忆呼吸/信念进化/情绪地形）、会议身份与会话复用、人格读写与去重、长期记忆与蒸馏、
大脑触发与 LLM 决策、纠错器、宿主内会话驱动（含旧 turn 不提前结算）、知识库检测与回写、
环境自检、虚拟声卡方案、自动应答（超时/人工优先/禁用），以及插件整体启动：31 个工具注册、
配置 API（密钥不回显）、各 soul_* 工具的读写行为。
