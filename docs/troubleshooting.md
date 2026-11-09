# 排障与限制

健康状态、断线行为、预算、已知限制。

## 🩺 健康状态

```
GET /api/soulmirror/health
```

```json
{
  "ok": true,
  "problems": [],
  "capture": { "capturing": true, "device": "扬声器 (MIPI)", "bytes": 963840 },
  "asr": { "phase": "online", "online": true, "reconnects": 0, "droppedMs": 0 },
  "transcript": { "lines": 42, "lastAgeMs": 1200 },
  "budget": { "limitMinutes": 0, "usedMinutes": 12.4, "over": false }
}
```

不健康时 `problems` 直接写人话：`语音识别未连接` / `超过 2 分钟没有新转写` /
`断线累计丢失 6 秒音频` / `已超出本次会议识别预算 60 分钟`。

---

## 🔁 断线会怎样

```
断开 → 1/2/4/8/15 秒退避重连（最多 6 次）
     → 期间音频进环形缓冲，重连后补发
     → 只有被缓冲挤掉的部分才算真丢
     → 真丢 ≥1.5 秒，在转写里写「（此处中断约 N 秒）」
     → 6 次仍失败：停采集 + 明确提示（不静默）
```

---

## 💰 识别预算

`asr.hourlyBudgetMinutes`：`0` 不限（默认）；`>0` 时每场会议超过该分钟数自动停采集，
并在健康检查里说明原因。开会一小时也是在花钱，得有个闸。

---

## ⚠️ 已知限制（写清楚，不粉饰）

| 限制 | 原因 | 影响 |
|---|---|---|
| 没有说话人识别 | 第三方实时 ASR 不提供分离，我们拿到的是混音 | 多人会议"谁在说"不可知，Agent 只看内容，误触发随人数上升 |
| 依赖可用的播放设备 | 某些 HDMI 端点环回恒为静音 | 需把会议声音放在可采设备上 |
| 移动会议不暴露会议号 | 号码画在画布上，UIA 读不到 | 显示"未识别"，可手填 |
| 识别需联网 + key | 云端实时流式 | 断网降级为提示，不假装在听 |
| 只支持 Windows | 采集基于 WASAPI | macOS 需另做音频层 |

---

---

## ⚠️ 已知限制

- 飞书、钉钉、Zoom 只有预设，没在真机上跑过。接入前建议先 `meeting_apps` 看一眼，再 `meeting_mic_status` 确认麦克风行为
- 入会靠 UI 自动化（首页要按坐标点），客户端改版就会失效；找不到入口时它会把可见控件名列出来
- macOS / Linux 的采集链路（ffmpeg + BlackHole/PulseAudio）只是设计好了，没实机验证
- 腾讯会议把会议号画在画布上，自动识别会扫界面文本兜底，读不到时手填一次即可
- 记忆与情绪的衰减参数是拍出来的，用久了该调

---

## 症状：会议助手的会话一直在运行 / 反复出现纪要

**先别怀疑插件。** 按顺序看两处：

### 1. 是不是有定时任务在轮询

```
meeting_schedule_list        # 看有没有周期任务
```

周期性的"每 N 分钟取纪要"任务应当删掉（见 [config.md](config.md#不要用定时任务轮询纪要)）。
定时任务只该用于一次性到点入会。

存储位置：`<DSH 根>/storages/schedule.json`

### 2. 是不是某个 bot 的 instructions 让它这么干

检查 bot 配置里有没有类似句子：

```
每次在会议开始后，根据会议时长设置定时任务，自动获取全部会议转写和会议纪要
```

有就改成：纪要交给 SoulMirror（事件驱动），需要时问它要。

### 插件自身是事件驱动的

```
采集 → 转写落账 → 点「结束录音」→ 会后整理 → 写知识库
```

插件停着（`enabled=false`）时：不采集、不轮询、不建会话、不产纪要。
可以用 `/api/soulmirror/status` 确认：`enabled`、`session.capturing`、`mem`。

## 语音 Key「保存了，下次运行又是空的」

真实故障链（2026-11-09 修复，提交见 CHANGELOG）：

```
① 保存 Key → savePersisted 写进 config.json        ← 这一步一直是好的
② 下次启动 → loadPersisted 读到了                   ← 也没问题
③ 紧接着 ensureConfigFile(CONFIG_FILE, cfg) 发现缺了新默认键 → 合并回写
④ 回写时调用了 stripSecrets() → apikey 被删除      ← 真正的凶手
⑤ 于是下一轮启动文件里已是空
```

**独立环境更容易命中**：每个新版本/新 profile 都会补新键，每次都触发一次回写。

### 自查（不暴露密钥）

```bash
curl http://127.0.0.1:3080/api/soulmirror/status | jq .config
```

```json
{
  "dir": "C:\\Users\\you\\.dsh\\soulmirror",
  "file": "...\\config.json",
  "exists": true,
  "diskHasKey": { "asr": true, "tts": false, "apiKeyEnv": "DASHSCOPE_API_KEY" },
  "runtimeSource": "file",
  "dshHome": "C:\\Users\\you\\.dsh"
}
```

- `diskHasKey.asr=false` → 文件里确实没存进去（看下一步）
- `runtimeSource` ≠ `file` → 运行时用的是环境变量/注册表里的 Key，不是文件
- `file` 指向的目录不是你预期的 → 见下面「配置钉死」

### 配置钉死在固定目录（独立环境 / 便携版 / 多实例）

```
SOULMIRROR_HOME=D:\soulmirror-data
```

设置后所有配置、会议记录、人格数据都落在该目录，不随 `DSH_HOME` 或 profile 漂移。

### 已知不能自动做的事

Key 是你账号的资产，插件不会替你申请；写入失败时会在日志里打出**具体路径与原因**：

```
[soulmirror] 保存配置失败: <原因> → <config.json 路径>
```

## 密钥存在哪（与 DSH 官方一致）

SoulMirror 不再把明文 Key 写进 `config.json`，而是交给密钥存储：

| 情况 | 存到哪 | 说明 |
|---|---|---|
| 宿主有 `credentials` 服务 | DSH 的 `records`（`soulmirror/asr`、`soulmirror/tts`、`soulmirror/brain`） | 与 DSH 自身密钥同一套存储：`<DSH_HOME>/.credentials.yaml` |
| 宿主没有该服务 | 插件自己的 `credentials.json`（仅属主可读） | 位置：`<DSH_HOME>/soulmirror/credentials.json` |

`config.json` 里只保留 `asr.apiKeyEnv` 这类**名字**，不再留值。

### 读取顺序

```
① 密钥存储（DSH records / 命名引用 ref）
② credentials.json（回退）
③ 环境变量 / Windows 注册表（resolveDashScopeKey）
```

界面只报"是否已配置 + 来源"，**不回显值**（与 DSH 的 `describe` 语义一致）。

### 自查

```bash
curl http://127.0.0.1:3080/api/soulmirror/status | jq '.config | {keyStorage, keyStoragePath, keys, keySourceOf}'
```

```json
{
  "keyStorage": "dsh-credentials",
  "keyStoragePath": "(DSH 凭据存储)",
  "keys": { "asr": true, "tts": false, "brain": false },
  "keySourceOf": { "asr": "dsh-credentials:record", "tts": "none", "brain": "none" }
}
```

### 迁移

首次启动如果发现 `config.json` 里还有明文 `apiKey`，会自动：

1. 搬进密钥存储（已有值不覆盖）
2. 从 `config.json` 抹掉明文
3. 日志打印 `已把明文密钥迁进安全存储：asr`

失败时不会丢 Key，会退回到插件文件并打印原因。
