# lib/ 模块地图

69 个模块，按**职责分层**排列。读代码时建议按这个顺序：
入口 → 会话 → 采集/识别 → 判断/发言 → 会后 → 界面与接入 → 基础设施。

> 只在这个文件写"谁负责什么"。具体行为细节看各模块顶部注释与
> [docs/architecture.md](../docs/architecture.md)。

---

## 1. 会议会话（核心）

| 模块 | 职责 |
|---|---|
| `session.js` | **会议会话本体**：采集循环、转写落账、去重合并、断线标记、音频写盘 |
| `asr-stream.js` | 把裸 ASR 包成"会重连、会记账、会标断点"的组件 |
| `asr-resilience.js` | 非网络逻辑：退避、断线环形缓冲、丢帧计数、gap 文案 |
| `asr.js` | 本地/离线转写（整段 WAV → 文本） |
| `asr-model.js` | ASR 模型名的唯一解析入口 |
| `meeting-id.js` | 会议身份：同一场会 → 同一个 session key |
| `meeting-name.js` | 会议目录命名（软件 · 时间 · 主题）+ "一场会一条记录"判定 |
| `meeting-record.js` | 会议记录的数据层（准备 / meta / 回看） |
| `meeting-code.js` | 从界面文本里提取会议号（含垃圾号码过滤） |
| `transcript-log.js` | **账本回放**：解析 JSONL、按 `replaces` 折叠、容忍坏行 |

## 2. 音频

| 模块 | 职责 |
|---|---|
| `bridge.js` | `mbridge.exe` 的路径、懒构建、能力封装（采集 / 播放 / UIA / 设备） |
| `session.js` | 音频写入（常开写流 + 积压上限，见其内部注释） |
| `offline-asr.js` | 会后重转写：只读 WAV 头、流式上传、快速重放 |
| `audio-pick.js` | "采哪个设备"的纯逻辑（解析电平表） |
| `audio-diag.js` | 音频路由诊断：一次说清"现在什么情况" |
| `resolve-device.js` | 配置里记的设备名 → 现在真实存在的设备 |
| `vcard.js` | 虚拟声卡（会议麦克风注入）的检测与安装 |

## 3. 识别与发言

| 模块 | 职责 |
|---|---|
| `dashscope.js` | 百炼实时 ASR（WebSocket 客户端，依赖 `ws.js`） |
| `dashscope-file.js` | 百炼录音文件识别 + 说话人分离 |
| `dashscope-tts.js` | 百炼语音合成（CosyVoice，流式） |
| `ws.js` | 极简 WebSocket 客户端（RFC6455），只依赖 `node:net/tls/crypto` |
| `tts.js` | 合成 + 播放 + 说话（含开麦/静音处理） |
| `t2s.js` | 繁体 → 简体（OpenCC 字符表，`lib/data/ts.txt`） |
| `dedupe.js` | 转写去重（同句短时重复只处理一次） |
| `segment-merge.js` | 碎片化转写的合并 |
| `echo-guard.js` | **自我回环防护**：挡掉模型自己的旁白与回声 |
| `typewriter.js` | 打字机效果（纯计算，便于测试） |

## 4. 判断与发言决策

| 模块 | 职责 |
|---|---|
| `trigger-rules.js` | "这句是不是在等我回应" |
| `advice.js` / `advice-trigger.js` | 会中建议（追问 / 回应）与自动触发规则 |
| `reply-candidates.js` | Agent 发言的候选词与"要不要开工"判定 |
| `action-items.js` | 从纪要里抽待办 |
| `brain.js` | 会议大脑：组装 prompt、纠错、决策 |
| `context-snapshot.js` | 把转写压成"给 Agent 看的上下文" |
| `model-probe.js` | 模型联通性测试与错误翻译 |
| `model-resolve.js` | "用哪个模型" |

## 5. 与 DSH 的边界

| 模块 | 职责 |
|---|---|
| `dsh-session.js` | 在宿主进程内创建 / 驱动 DSH 会话（`promptSession`） |
| `dsh-llm.js` | 用 DSH 自己的 `llm` 服务做补全 |
| `session-gate.js` | **会话闸门**：同时只让一个回合进会话，多余排队合并 |
| `twin.js` | 外部任务执行器：起独立 `dsh` 进程跑任务 |
| `profile-path.js` | 从插件自身位置反推 DSH 根 / profiles / 当前 profile |
| `workspace.js` | 会议会话应该在哪个目录里工作 |

## 6. 会后与持久化

| 模块 | 职责 |
|---|---|
| `minutes-file.js` | 纪要落盘唯一入口：防覆盖、防清空、可回溯 |
| `recovery.js` | 发现"未整理完"的会议（只 stat 不读内容） |
| `knowledge.js` | 与 `dsh-knowledge` 的联动与校验（装没装、往哪写） |
| `record-export.js` | 记录导出与搜索 |
| `living.js` | 活数据层：记忆 / 信念 / 情绪地形 |
| `memory.js` | 轻量长期记忆 + LLM 蒸馏 |
| `persona.js` | 四层人格文件（SOUL / IDENTITY / USER / STATE） |

## 7. 会议软件与桌面

| 模块 | 职责 |
|---|---|
| `apps.js` | 会议软件注册表（预设 + 自动识别 + 手动切换） |
| `app-detect.js` | "现在该抓哪个软件"（打分，不靠配置顺序） |
| `desktop.js` | 窗口枚举、控件转储、启动软件 |
| `lifecycle.js` | 会议开始 / 结束判定（窗口形态 + 音频能量） |
| `join-url.js` | 入会链接（非屏幕方案） |
| `join-guard.js` | 会议号校验与失败分类 |
| `auto-join.js` | 会话里出现链接/会议号时自动入会 |
| `auto-answer.js` | 无人值守时的自动应答 / 自动继续 |
| `calibrate-agent.js` | 让 computer-use 去"试"出界面坐标 |
| `uimap.js` | 界面坐标表（每软件、每动作一份） |

## 8. 桌面宠物

| 模块 | 职责 |
|---|---|
| `pet-dsh.js` | 接入 dsh-pet：状态、菜单、广播 |
| `pet-display.js` | 展示决策：什么时候让宠物说什么 |

## 9. 界面与接入层

| 模块 | 职责 |
|---|---|
| `client.js` | **客户端单文件**（React，手写在 Cordis 里不能用本地 import） |
| `setup-rows.js` | 安装体检项定义 |
| `setup.js` | 环境自检与自动配置（`csc` 编译桥接等） |
| `bootstrap.js` | 安装期自动化：能自动做的做掉，不能的给指引 |
| `deps-optional.js` | 可选插件体检与安装 |
| `demo.js` | 演练模式（不连真实会议也能跑全链路） |
| `sources.js` | 外部世界抽象（桌面信号 / 脚本信号），便于测试 |

## 10. 基础设施

| 模块 | 职责 |
|---|---|
| `env.js` | 环境变量兜底读取（进程 → 配置 → 用户级注册表） |
| `proc.js` | 子进程执行（统一错误处理） |
| `persona.js` / `memory.js` | 见"会后与持久化" |

---

## 约定

1. **纯逻辑与副作用分开**：判定、命名、回放等都在可测的纯函数模块里
   （`meeting-name`、`transcript-log`、`recovery`、`asr-resilience`、`join-guard`…）。
2. **规则只有一处实现**：账本写入只有 `session._appendTranscript`；
   纪要落盘只有 `minutes-file.saveMinutes`；profile 解析只有 `profile-path`。
3. **异步错误必须有人接**：子进程 `spawn`、socket、写流都挂 `error` 监听——
   曾经因为没挂，`ENOENT` / `ECONNRESET` 直接把宿主打崩。
4. **客户端不可拆模块**：Cordis 环境里 `client.js` 只能是单文件 IIFE，
   所以它偏长是**受限**而非偷懒。
