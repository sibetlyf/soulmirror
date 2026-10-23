# SoulMirror

接到会议里，听人说话，该开口时开口，该干活时去干活。跑在 DeepSeek Harness 上。

## 🕯️ 设计哲学

存下来的东西在变多，被想起的东西在变少。

大多数助手把对话写成日志：越写越厚，最后没人再打开。这里换个做法，给数据加上时间。

### 🌱 记忆会呼吸

每段记忆带着一点活力，刚记下时有 0.8。按三天一个半衰期往下掉，掉到 0.15 以下就沉睡了。
下次有人提起，它会加回 0.3，重新醒过来。

所以它不是什么都记得，是记得住还活着的那些。被反复说起的越来越清楚，
没人再提的慢慢淡下去——这不是缺陷，是取舍本该有的样子。

### 🌳 信念会进化

一句话可以是一颗种子。被印证一次，它发芽；再印证，成小树；反复印证，长成大树。
被推翻一次，它会掉一截；掉到 0.02，就算死了。

死掉的信念不删，留在那里当墓碑。回头看，能知道它是怎么长起来、又是怎么被推倒的。

### 🗺️ 情绪成地形

喜悦、低落、愤怒、担忧、平静，按一天半的半衰期慢慢淡，再铺到一张 8×8 的网格上。
谁占得多，那一格就是谁的地貌：光原、幽谷、火山、迷雾、静湖。

活着的信念立在这片地形里，就是建筑。高度是它的强度。

于是"此刻的我"有了形状：一片湖，几棵树，边上还有座没熄的火山。

### ⏳ 过去、现在、未来

不是三个抽屉，是一条线。

过去是称过重量的：说过的每句话、冒出来的每种情绪，都带着时间戳和衰减系数。
现在是编织出来的：活的信念、情绪的议会、心像的地形，都是此刻算出来的，不是存下来的。
未来是预演出来的：分身带着这个形状去试——先去查，先去做，先替你说一遍。

**过去构建现在，现在投射未来。**

### 🧘 禅落在代码里

禅在这里不是气质的点缀，是几条工程纪律：

- **无常** —— 什么都带衰减系数。记忆、情绪、信念都会变，没有"永久有效"的缓存。
- **无住** —— 不赌一次就对。纠错器每句都跑，说错了下一句改回来。
- **无我** —— 分身不假装是人。它是工具，"我是谁"写在随时可改的 `IDENTITY.md` 里。
- **留白** —— 没人应答不硬等。五秒后自己往下走，别把整轮卡死在一张卡片上。
- **诚实** —— 拿不到结果就说没拿到。宁可说"任务没跑成"，不编一个成功出来。

所以这个仓库里没有"AI 记忆宫殿"这种说法。
只有三个 JSON、两个半衰期参数，和一条随时能 `soul_world { breathe: true }` 看一眼的曲线。

---

## 🔧 装起来

```bash
dsh plugin --profile web add "github:sibetlyf/soulmirror#main"
```

重启 `dsh web`，再跑一次 `soul_setup { action: "auto" }`。Windows 会用系统自带 `csc`
把 `tools/mbridge.exe` 编译出来，macOS / Linux 只做依赖检查。

> PowerShell 会把 `#` 当注释，上面那个 ref 的引号不能省。

## 🚦 两级权限：只听 vs 动手

插件装好是**待命**状态。为了不让你专心做事时它乱点鼠标，把能力分成两级：

| 动作 | 是否需要开启 | 为什么 |
|---|---|---|
| 检测会议窗口 | 不用 | 只读窗口列表 |
| **采集 + 转写** | **不用**（`autoCapture: true`） | 只读音频，不碰你的桌面 |
| 本地纪要落盘 | 不用 | 写自己的目录 |
| 建 DSH 会话 | 要 | 会消耗模型、产生会话 |
| 自动入会 / 标定坐标 | 要 | 会点你的客户端 |
| 发言（切麦、开口） | 要 | 会占用麦克风 |
| 知识库回写 | 要 | 对外产生文档 |

开启方式：面板顶部开关，或 `meeting_agent_start`。关掉后立刻停止采集，也不再有任何自动动作。

这么分是因为：转写只是"听"，出问题的概率极低；而点客户端、抢麦克风才是我之前踩过的坑
（调试期间它把「加入会议」点成了「预定会议」，还真的开了一场会）。

如果你连"听"都不想自动，把 `autoCapture` 关掉即可。

---

1776## 🎙️ 一场会议里它做什么

会议开始，插件自己发现窗口，把采集打开。说的每句话先经阿里云实时识别，再过一遍大模型纠正
同音错字——"大峰""杨峰"这类错听会被改回正确的人名，然后才进判断。

判断交给模型，不是关键词表。它能分清"这个方案你怎么看"是在问人，还是该自己接话。
被叫到、被问、被交代事情，它才会出声。

出声的方式是：把系统默认麦克风临时切到虚拟声卡，按住空格把流式语音送进去，说完松开，
再把麦克风切回来。中间会确认会议客户端真的跟着切了，没跟上就不播。

被交代了任务，它先说一句"我去查"，然后在后台跑，不占着会议。跑完不急着说——
等会议安静两秒半，再用两三句话把结论讲完。

会议结束后，纪要存本地，写进知识库，顺手把这一场里关于你的偏好和前情更新到人格文件里。

## ✨ 能力一览

| | |
|---|---|
| 采集 | WASAPI 环回，只采会议客户端所在设备 |
| 识别 | 百炼 `paraformer-realtime-v2`，中间结果、标点、ITN、顺滑、VAD 断句、时间戳 |
| 纠错 | 每句过一遍同音字纠正，词表来自 `userName` + 唤醒词 + 会议背景 |
| 判断 | 完整上文交给模型，决定要不要接话、要不要干活 |
| 发言 | 切虚拟麦 → 长按空格 → 流式 TTS → 松开 → 切回 |
| 干活 | 起 DSH 任务，结果压成一两句汇报 |
| 沉淀 | 会后写知识库、更新 `USER.md` / `STATE.md` |

## 🧩 会议软件

内置这些，进程名可多个候选：

| 软件 | 进程 | 状态 |
|---|---|---|
| 腾讯会议 | `wemeetapp` / `TencentMeeting` | 主用，采集/转写/发言/入会全链路验证过 |
| 移动会议（云视讯） | `CloudVideo` / `ydmeeting` | 首页与入会弹窗已适配，未做完整链路 |
| 飞书会议 | `Feishu` / `Lark` | 预设就绪，未实测 |
| 钉钉会议 | `DingTalk` | 预设就绪，未实测 |
| Zoom / Teams | `Zoom` / `ms-teams` | 预设就绪 |

识别打分：进程精确 100，进程相似 80，标题命中 60，专用类名 40。`BaseDialog` 这种谁都在用的
类名不算证据，否则会把 GameViewer 误认成会议软件。

面板「抓取」是个下拉：自动跟随，或者钉死某个客户端。也可以命令行来：

```
meeting_apps                    # 谁在跑、当前抓谁、还能接哪些
meeting_app_select { name }     # 钉死；传空串回到自动跟随
```

接入新软件只需要加一条预设（进程名 + 标题/类名提示），或者直接在 `apps` 里写一行：

```yaml
autoAppSelect: true
activeApp: 腾讯会议     # 写了就钉死，自动跟随不再覆盖
apps:
  - { name: 腾讯会议, proc: wemeetapp }
  - { name: 自定义会议, proc: MyMeeting }
```

### 入会：优先走链接，实在不行才碰界面

屏幕坐标定位的东西换台机器就废，所以按可靠性排三层：

**① 入会链接（零屏幕操作）**

腾讯会议客户端能直接打开邀请链接入会。给 `url`，或者把整段邀请文案贴进 `code`，
它会自己把链接抠出来：

```
meeting_join { url: "https://meeting.tencent.com/dm/AbCdEf12", confirm: true }
meeting_join { code: "点击链接入会：https://meeting.tencent.com/dm/AbCdEf12 会议号 206-275-219", confirm: true }
```

插件调系统默认处理器打开链接，然后盯窗口标题——不再是软件名就说明进去了。
这条路不点任何界面，也不依赖窗口大小、DPI、布局。

邀请链接从哪来：腾讯会议官方接口（`get_meeting`、受邀人相关接口）都会返回 `join_url`；
手动用就是从「邀请」里复制一段。会议号本身推不出链接，那是服务端生成的。

**② 界面元素（UIA）**

拿不到链接、只能凭会议号时，才走界面。好消息是入会对话框里的控件全都有名字：

| 控件 | 名字 |
|---|---|
| 会议号 | `请输入会议号` / `meeting_code` |
| 昵称 | `请输入您的名字` / `nick_name` |
| 自动连接音频 | `auto_audio`（会自动勾上，否则采到静音） |
| 加入按钮 | `加入会议` / `join_meeting_btn` |

填号和点加入都是按名字找元素，不涉及坐标。

**③ 坐标标定（只有一步需要）**

唯一躲不掉光标的是「打开入会对话框」——首页那排按钮是 Qt 画上去的，
UIA 里只有 `home_meeting_list` 这类内部名，没有可点的按钮元素。
所以这一步做成首次使用标定一次：

```
meeting_calibrate { action: "join" }        # 截图并给出现有坐标
meeting_set_ui_map { app: "腾讯会议", action: "join", px: 399, py: 186, w: 1226, h: 786 }
```

坐标存成相对客户区的比例（`~/.dsh/soulmirror/uimap.json`），和窗口大小无关，换机器重新标一次即可。
点完会验证对话框是否真的出现；没出现就在附近 2% 范围内试几个偏移，成功了顺手把修正值存回去。
截图用 `PrintWindow` 渲染，窗口被挡住也能截到。

没标定过就直接告诉你“去标定”，不会盲点——盲点可能点到「预定会议」甚至「共享屏幕」。

---
### 自愈标定：让 computer-use 去试（配合 copylee/dsh-computer-use）

坐标这种东西猜一次就够了，猜错不该一直错。所以标定交给有屏幕能力的 agent 去做，出错时自动重学：

**首次安装**

插件起来 8 秒后检查：这个客户端有没有标定过入会按钮？没有的话，开一条会话「SoulMirror · 界面标定」，
让 computer-use 自己动手：打开客户端 → 看截图 → 点「加入会议」→ 确认弹出对话框 → 把比例存进坐标表。
会话里能看见它每一步，想插手随时插。

**入会失败时**

点完按钮没弹出对话框 → 记一次失败；连续失败到 `recalibrateThreshold`（默认 2）次，
自动再开一次标定会话，让它重新试。修好之后失败计数清零。

```yaml
autoCalibrate: true        # 自动标定/重学
recalibrateThreshold: 2    # 连续失败几次触发重学
```

手动来一次：

```
meeting_recalibrate { action: "join" }          # 现在就重学，等它跑完
meeting_calibrate   { action: "join" }          # 只截图 + 报当前坐标，不跑会话
meeting_set_ui_map  { app: "腾讯会议", action: "join", px: 399, py: 186, w: 1226, h: 786 }
```

这说明一下：computer-use 端的 `computer` 工具支持按控件**名字**点，但那排按钮是画上去的、没有名字，
所以最后还是落在坐标上——区别是**坐标由 agent 现场试出来并记住**，而不是我拍一个写死在代码里。
实测这台机器上「加入会议」在客户区约 `(0.325, 0.237)`，跟最初拍的 `(0.18, 0.28)` 差了很远。

### 会话里收到会议链接就自动入会

开会时有人往 DSH 会话里贴一条「点击链接入会：https://meeting.tencent.com/dm/xxx」，或者在聊天里发了会议号，
插件会从事件里把它认出来，直接进会：

```yaml
autoJoin:
  enabled: true
  urlOnly: false      # true = 只认链接，不自动入会议号
  cooldownMs: 300000  # 同一场会 5 分钟内不重复入
```

认法有讲究，避免误报：

- 有链接就认链接（最可靠）
- 没链接时，只认带「会议号 / 会议 ID」字样的号，或 9 位分组写法（`206-275-219`）
- 手机号、金额这类纯数字不认
- 助手自己发出去的消息不触发（只听进来的）

---

## 🧵 会话与会议身份

一场会议对应一条 DSH 会话，会话会在界面里出现，端侧能翻每一轮模型输出。

判定"同一场会"的顺序：显式会议号 → 窗口标题里的会议号 → 窗口标题 → 时间戳。
映射存在 `~/.dsh/soulmirror/sessions.json`，所以中途退出再进、甚至重启 DSH，
只要身份一样就续上原来那条会话。

```
soul_session { setMeetingId: "206-275-219" }
```

腾讯会议把会议号画在画布上，读不到标题里，所以自动识别会扫窗口控件文本、再退回剪贴板；
实在没有就手填一次，之后记住。

## 🌿 活数据：参数与工具

哲学在上面，这里只放能调的旋钮。全部在 `lib/living.js`，纯本地 JSON。

| | 半衰期 | 关键阈值 | 文件 |
|---|---|---|---|
| 记忆 | 3 天 | 0.15 沉睡 · 想起 +0.3 | `living/memory-living.json` |
| 信念 | 30 天不强化开始退化 | 0.35 发芽 · 0.6 小树 · 0.85 大树 · 0.02 死亡 | `living/beliefs.json` |
| 情绪 | 1.5 天 | 8×8 网格，主导情绪决定地貌 | `living/emotions.json` |

```
soul_world   { breathe? }    # 看形状；breathe 走一次衰减
soul_belief  { action }      # list / seed / reinforce / weaken / evolve
soul_goal    { action }      # add / list / run
```

`/status` 的 `world` 字段会带回同一份快照，面板和端侧都能看。

## 🌙 无人值守

半夜在跑任务时，DSH 弹一张确认卡片，人不在，这轮就停在那儿。所以拦一下 `approval/request`：
卡片照常弹，你在五秒内点了就用你的答案；五秒没人理，就按推荐项自己选一个，agent 接着干。
没有推荐标记时，审批默认放行一次，问句取第一个选项。

```yaml
autoAnswer: { enabled: true, timeoutMs: 5000 }
```

## 🧰 工具

```
meeting_*  ×21   采集、转写、纪要、发言、窗口与入会控制
soul_task        交给 DSH 执行，可当场汇报
soul_say         主动发言，不依赖唤醒词
soul_status      在线状态、唤醒词、最近任务
soul_session     本场会议的工作区与会话
soul_persona     读/写四层人格（soul / identity / user / state）
soul_memory      长期记忆：查看、补记、蒸馏
soul_setup       环境体检：check / build / auto / deps / install-deps / links
soul_world       内在宇宙
soul_belief      信念树
soul_goal        目标驱动
```

## ⚙️ 配置

面板里改，或编辑 `~/.dsh/soulmirror/config.json`：

```yaml
userName: 你的名字        # 唤醒词自动派生：全名 / 去掉姓 / DSH / 助手
policy: auto              # observe | suggest | auto
asr:  { provider: dashscope, llmCorrect: true }
tts:  { provider: dashscope, model: cosyvoice-v2, voice: longxiaochun_v2 }
twin: { enabled: true, autoDelegate: true, reportSpeak: true }
knowledge:
  mode: host              # host 直连宿主知识库 | agent 交给会话 | headless | off
brain:
  gate: llm               # 每句都交给模型判断；rules 退回关键词
```

## 🔑 密钥从哪来

顺序是：`config.json` 里的 `apiKey` → 同名环境变量 → **Windows 用户级环境变量**（注册表 `HKCU\Environment`）。

最后这一层是为了一类很常见的翻车：把密钥设成用户环境变量后，只有**之后新启动**的进程才继承得到。
DSH 常常活得比变量久，或者从没有该变量的父进程启动，于是重启后就报「缺少密钥」，语音识别直接哑掉。
现在即使进程环境里没有，也会去注册表里捞一次（30 秒缓存，`reg.exe`，不需要管理员）。

```
soul_setup { action: "check" }     # 打印每个密钥的实际来源
```

| 用途 | 默认变量名 | 说明 |
|---|---|---|
| 语音识别 / 合成 | `DASHSCOPE_API_KEY` | 阿里云百炼 |
| 判定 / 纠错 / 总结 | `BRAIN_API_KEY`，可回退 `ARK_API_KEY`、`OPENAI_API_KEY` | 任意 OpenAI 兼容 |

---

## 🔌 依赖

运行需要三样东西：虚拟声卡（发言通道）、百炼 Key（识别与合成）、一个 OpenAI 兼容模型
（判断、纠错、总结）。虚拟声卡是唯一需要手动装的：

| 平台 | 方案 | 自动 |
|---|---|---|
| Windows | VB-CABLE | 内核驱动，手动装 |
| macOS | BlackHole | brew 需要 sudo |
| Linux | 不需要驱动 | `pactl` 加载 null-sink，全自动 |

`soul_setup { action: "deps" }` 会告诉你现在有没有、缺的话去哪装。

## 🤝 和别的插件

**知识库**：默认 `mode: host`，直接调宿主里 `dsh-knowledge` 的本地 API 写纪要，
不需要额外安装；检测不到就跳过，纪要照旧落本地。

**computer-use**：两个都会发键盘事件，同时操作桌面会抢焦点。发言前会把会议窗口置前，
所以极端情况是你正在用 computer-use 操作别的应用，被它抢一下。

体检：`soul_setup { action: "links" }`。

## 📁 目录

```
~/.dsh/soulmirror/
├── config.json
├── persona/{SOUL,IDENTITY,USER,STATE}.md   改完即时生效
├── memory.json                             长期记忆 + 蒸馏结果
├── living/{memory-living,beliefs,emotions}.json
├── sessions.json                           会议身份 → DSH 会话
└── workspace/<会议>/                        每场会一个工作区
```

## ⚠️ 已知限制

- 飞书、钉钉、Zoom 只有预设，没在真机上跑过。接入前建议先 `meeting_apps` 看一眼，再 `meeting_mic_status` 确认麦克风行为
- 入会靠 UI 自动化（首页要按坐标点），客户端改版就会失效；找不到入口时它会把可见控件名列出来
- macOS / Linux 的采集链路（ffmpeg + BlackHole/PulseAudio）只是设计好了，没实机验证
- 腾讯会议把会议号画在画布上，自动识别会扫界面文本兜底，读不到时手填一次即可
- 记忆与情绪的衰减参数是拍出来的，用久了该调

## ✅ 测试

```
npm test        # 75 个用例
```

覆盖活数据三条曲线、会议身份与复用、人格读写去重、长期记忆与蒸馏、大脑触发与模型决策、
纠错器、宿主内会话驱动（含"旧轮次不提前结算"）、知识库检测与回写、自动应答三种情形、
会议软件识别打分，以及插件整体启动：31 个工具注册、配置 API 不回显密钥、各 `soul_*` 工具读写。

## 🙏 参考与致谢

宿主是 [DeepSeek Harness](https://github.com/deepseek-ai/dsh)，插件模型来自
[cordis](https://github.com/deepseek-ai/cordis)。

四个直接参考过的插件：

| 项目 | 借了什么 |
|---|---|
| [sibetlyf/dsh-knowledge](https://github.com/sibetlyf/dsh-knowledge) | 写知识库走它的本地管理 API 与同源身份 |
| [sibetlyf/dsh-plugin-gateway](https://github.com/sibetlyf/dsh-plugin-gateway) | 宿主内建会话：`sessionController` 的 create/prompt 与 `session/event`。没有它，分会话只能起子进程，界面上看不见 |
| [yuhui-sama/dsh-agentsoul](https://github.com/yuhui-sama/dsh-agentsoul) | 四层人格文件、记忆蒸馏的三分类、只补种子不覆盖 |
| [AK-blank/dsh-plugin-auto-answer](https://github.com/AK-blank/dsh-plugin-auto-answer) | 超时按推荐项应答的思路；这里补了人工优先与多种选项形状 |

云与本地：[阿里云百炼](https://help.aliyun.com/zh/model-studio/)（识别/合成）、
[火山 Ark](https://www.volcengine.com/product/ark)（判断/纠错）、
[VB-CABLE](https://vb-audio.com/Cable/)、[whisper.cpp](https://github.com/ggerganov/whisper.cpp)（可选本地识别）、
[OpenCC](https://github.com/BYVoid/OpenCC)（繁简字符表）、系统 WASAPI 与 UIAutomation。

"记忆会呼吸 / 信念会进化 / 情绪成地形"这套提法来自需求方，这里只是把它落成了可计算的东西。

腾讯会议、飞书、钉钉、Zoom、Teams 的商标归各自所有者，本项目与这些公司没有关联。
用于会议录音转录时，请自行确认符合所在组织的合规要求。

MIT。第三方各自遵循其许可：DSH / cordis 为 Apache-2.0 系，whisper.cpp 为 MIT，OpenCC 为 Apache-2.0，
VB-CABLE 为捐赠版免费（商用看其条款）。
