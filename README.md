# SoulMirror · DSH 数字分身

把 DSH 变成一个能"参会"的数字分身：它听会议、理解意图、能自己说话，还能把任务交给 DSH 执行完再回来汇报。

## 它做什么

| 能力 | 说明 |
|---|---|
| 听 | WASAPI 环回采集系统声音，只采会议客户端所在设备的音频 |
| 转 | 阿里云百炼实时 ASR（`paraformer-realtime-v2`），中间结果 + 标点 + ITN + 顺滑 + VAD 断句 + 时间戳 |
| 校 | 每句过一遍大模型同音字纠正（识别误差 → 正确人名），人名来自 `userName` + 唤醒词 |
| 懂 | 大模型判定"是在叫我吗、要不要接话"，支持点名、提问、被交代事项 |
| 说 | 切默认麦克风到虚拟声卡 → 按住空格 → 流式 TTS → 松开 → 切回 |
| 干 | `soul_task` 把任务交给 `dsh --profile headless` 执行，结果可以当场汇报 |
| 报 | 任务完成、待办提醒、主动开场，都能自己开口（`soul_say`） |

## 工具

会议侧（沿用原命名，保持兼容）：

```
meeting_auto / meeting_agent_start / meeting_agent_stop / meeting_agent_status
meeting_capture_start / meeting_capture_stop / meeting_transcript / meeting_minutes
meeting_status / meeting_devices / meeting_levels / meeting_probe_audio / meeting_mic_status
meeting_ui / meeting_open / meeting_join / meeting_leave / meeting_set_mute / meeting_say / meeting_apps / meeting_selftest
```

分身侧：

```
soul_task    { prompt, speak?, timeoutMs? }   # 交给 DSH 执行，可选当场播报
soul_say     { text, remember? }              # 主动发言，不依赖唤醒词
soul_status  {}                               # 在线状态 / 唤醒词 / 最近任务
```

## 配置要点

```yaml
userName: 你的名字        # 唤醒词自动派生：全名 / 去掉姓 / DSH / 助手 …
activeApp: 腾讯会议       # 只盯这个会议软件
policy: auto              # observe | suggest | auto
asr:
  provider: dashscope
  llmCorrect: true        # 大模型纠正同音错字
  context: '团队周会，涉及排期与预算。'
  sentenceSilenceMs: 800
tts:
  provider: dashscope
  model: cosyvoice-v2
  voice: longxiaochun_v2
twin:
  enabled: true
  profile: headless       # soul_task 调用的 DSH profile
  timeoutMs: 180000
```

## 关键设计

- **只在"最终句 + 纠错完成"之后**才交给大脑判定，中间结果只用于显示，避免拿半句话去回复
- **防自说自听**：播报期间按字数估算静音窗口，窗口内的转写直接丢弃
- **发言前校验设备**：切默认麦克风后轮询 `mic-usage`，确认会议真的跟过去了才播
- **分身发言可追溯**：AI 的每句话都带 `role: 'assistant'` 写进 `transcript.jsonl`，面板里高亮显示

## 依赖

- Windows（WASAPI / UIAutomation）
- VB-CABLE 虚拟声卡
- `tools/mbridge.exe`（C# 编译的音频桥）、`tools/ui.ps1`、`tools/hold.ps1`
- 阿里云百炼 API Key（ASR + TTS）
- 任意 OpenAI 兼容模型（意图判定、纠错、回答）

## 安装（dsh 方式）

```bash
# 跟踪 main
dsh plugin --profile web add "github:sibetlyf/soulmirror#main"

# 或固定到某个提交
dsh plugin --profile web add "github:sibetlyf/soulmirror#<commit>"
```

装完重启一次 `dsh web`，启动日志里会看到 `[soulmirror] 环境自检：…`。

> Windows PowerShell 里 `#` 会被当成注释，ref 必须用引号包住（上面已加）。
> 安装时会跑 `postinstall` 编译 mbridge；DSH 若提示允许构建脚本，选允许。

## 环境自动配置

装完先跑一次：

```
soul_setup { action: "auto" }
```

| 平台 | 自动处理 | 需要手动 |
|---|---|---|
| Windows | 用系统自带 `csc` 从 `tools/meeting-bridge.cs` 编译 `mbridge.exe` | .NET Framework 4.x（Win10/11 自带）；VB-CABLE 虚拟声卡 |
| macOS | 检测 `ffmpeg` / `say` | `brew install ffmpeg`；BlackHole 做环回 |
| Linux | 检测 `ffmpeg` / `parec` / `espeak-ng` | `sudo apt install ffmpeg pulseaudio-utils espeak-ng` |

```
soul_setup { action: "check" }   # 只看当前缺什么
soul_setup { action: "build" }   # 强制重编 mbridge（Windows）
soul_setup { action: "auto" }    # 能做的都做
```

密钥与模型都在「SoulMirror → 配置」里填，不用改代码。

## 虚拟声卡（注入通道）

分身要把声音当成"会议麦克风"送进去，需要一个虚拟录音设备。检测与安装：

```
soul_setup { action: "deps" }         # 检测当前有没有可用虚拟声卡
soul_setup { action: "install-deps" } # 尝试安装（仅 Linux 能全自动）
```

| 平台 | 驱动 | 能否自动 |
|---|---|---|
| Windows | VB-CABLE | ❌ 内核驱动，需管理员 + 重启 |
| macOS | BlackHole | ❌ brew 需要 sudo |
| Linux | 不需要驱动 | ✅ `pactl` 加载 null-sink，无需 root |

Linux 上会自动执行：

```bash
pactl load-module module-null-sink sink_name=SoulMirrorSink …
pactl load-module module-remap-source master=SoulMirrorSink.monitor source_name=SoulMirrorMic …
```

不装也能用：`devices.speak` 留空，分身改为扬声器外放（音质差、可能有回声），采集与转写不受影响。

## 会上自动执行任务

会上有人说"帮我调研 X / 整理一下 / 查一下"，分身会：

1. 立刻用一句话回应（"我现在就去做"），**不会说"会后给你"**
2. 同时在后台起一个 DSH 任务（`dsh --profile headless --json`），跑在当前会议的工作区里
3. 任务完成后，把结果前 120 字直接说进会议，并写进转写（标 `任务汇报`）

```yaml
twin:
  autoDelegate: true    # 被交代任务时自动执行
  reportSpeak: true     # 完成后在会议里播报
```

并发上限 2 个任务，超出会跳过并在日志里说明；面板顶部会显示"任务：执行中 / 完成 / 失败"。
