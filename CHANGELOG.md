# 变更记录

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)，本项目的具体含义见
[docs/versioning.md](docs/versioning.md)。

## [1.0.0] · 2026-11-06

第一个"人格管线完整"的正式版。相比 0.2.1，主要变化如下。

### 新增 · 人格与记忆

- **灵魂卡**（`lib/soul-card.js`）：用户只填四个空（名字/性格/沟通风格/其他），
  认知架构由插件垫底注入。借鉴 [dsh-linghun](https://github.com/syyr1987/dsh-linghun) 的两层设计。
- **五层画像**（`lib/persona-growth.js`）：identity / style / stance / facts / state，
  每条带置信度、出现次数、历史值。同义强化、冲突取代、state 有 TTL。
- **四层记忆**（`lib/memory-layers.js`）：暖态 → 冷储 / 归档，另有只追加的流水。
  跨会议反复出现的条目才晋升冷储，并注入人格块。
- **三分法本体**（`lib/tripartite.js`）：技术知识 / 项目记忆 / 经验规则分开存，
  因为寿命与用途完全不同。
- **画像写独立知识库**（`lib/persona-kb.js`）：同一篇文档反复更新，
  不与会议纪要混在一起。真机验证：建库 → 写入 → 二次同步为 v2 更新。
- **越用越像可度量**：`convergence()` 给出 0~1 的相似程度与分档标签，
  在 `soul_world` 与 `/status` 可见。

### 新增 · 会议记录

- **账本回放**（`lib/transcript-log.js`）：写入只增不改，读取按 `replaces` 折叠，
  容忍强杀留下的半行 JSON。
- **未整理会议回收**（`lib/recovery.js`）：启动后只 stat 不读内容地扫描，
  面板一键从账本补出纪要。实测 75 个目录 7.2ms。
- **会议目录命名**（`lib/meeting-name.js`）：`腾讯会议 · 2026-11-05 16-07 · 周会`；
  同一场会在窗口期内复用同一目录。

### 新增 · 可靠性

- **内存守卫**：堆用到上限 80% 时优雅停止采集，不再等 V8 抛 `FATAL ERROR`。
- **录音写入改为常开写流 + 积压上限**：原来每块 `appendFile` 且 Promise 链无上限，
  磁盘一慢就堆到几 GB。
- **所有停止路径都会生成纪要**：`meeting_capture_stop` / `meeting_agent_stop` /
  `meeting_leave` 以前只停不整理。
- **模型联通性测试**：面板「测模型」真的连一次 ASR 与 TTS，
  错误翻译成"该做什么"（401/403/404/429/网络/缺 Key）。
- **保存配置失败不再谎报成功**：写盘后回读校验，失败回滚内存并给出路径。

### 修复

- 语音识别连接被重置（`ECONNRESET`）不再打崩宿主（socket `error` 未监听）。
- `spawn` 找不到 `mbridge.exe`（`ENOENT`）不再打崩宿主；
  且 `mbridge.exe` **随包分发**，装完即可用，不依赖 `csc`。
- 离线重转写成功后必然抛 `ReferenceError`（`speakers` 在声明前使用）。
- 知识库永远判"没装"：profiles 路径与宿主 profile 名都曾被写死。

### 移除

- **定时任务轮询纪要**：旧的"每 10 分钟取一次纪要"会拉起常驻会话、重复计费。
  改为事件驱动（散会即整理）。定时任务现在只用于一次性到点参会。

### 存储

- 存储格式版本 `STORAGE_VERSION = 1`（首次正式定义）。
  涉及 `PROFILE.json` / `USER-CARD.md` / `memory/*` / `ontology/*`。

---

## [0.2.1] 及更早

见 git 历史（`git log --oneline v0.2.1`）。
