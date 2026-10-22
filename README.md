# SoulMirror · DSH 数字分身

把 DSH 变成一个能"参会"的数字分身：它听会议、理解意图、能自己说话，还能把任务交给 DSH 执行完再回来汇报。

## 它做什么

| 能力 | 说明 |
|---|---|
| 听 | WASAPI 环回采集系统声音，只采会议客户端所在设备的音频 |
| 转 | 阿里云百炼实时 ASR（`paraformer-realtime-v2`），中间结果 + 标点 + ITN + 顺滑 + VAD 断句 + 时间戳 |
| 校 | 每句过一遍大模型同音字纠正（"大峰/杨峰" → "亚峰"），人名来自 `userName` + 唤醒词 |
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
userName: 李亚峰          # 唤醒词自动派生：李亚峰 / 亚峰 / DSH / 助手 …
activeApp: 腾讯会议       # 只盯这个会议软件
policy: auto              # observe | suggest | auto
asr:
  provider: dashscope
  llmCorrect: true        # 大模型纠正同音错字
  context: '产品周会，参会人：李亚峰。'
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

## 安装

```powershell
cd ~/.dsh/profiles/web
pnpm add link:plugins/soulmirror
# 在 profile package.json 的 dsh.profile.bundles 里加入 "soulmirror"
dsh web
```
