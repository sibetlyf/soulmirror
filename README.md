# SoulMirror · 会议助手

当前版本 **1.0.0**（存储格式 v1）· 变更见 [CHANGELOG.md](CHANGELOG.md) · 策略见 [docs/versioning.md](docs/versioning.md)

> 一个会**听**、会**记**、偶尔**说话**的会议伙伴。
> 它是 DSH 的插件，不是独立应用。

```
开着会，它安静地听。
散会时，纪要已经写进知识库。
你不在场，它也能替你到点进会。
```

不装任何会议软件也能先跑一遍：内置演练模式，30 秒走完整条链路
（播放样例音频 → 逐句转写 → 生成纪要），顶部会标注「演练中 · 不会发言」。

---

## 🕯️ 名字就是设计

> **Soul** 与 **Mirror**——一半是照见，一半是心动。
> 镜照人，魂生念。

一面镜子不该有主张：照出什么就是什么。
一个魂不该没有主张：否则它只是回声。

这两件事同时做才有麻烦——**镜子太像人会编，魂太像镜会空。**
项目里几乎所有取舍，都在这个拉扯里定下来。

### 镜的一侧（照见，不参与）

| 功能 | 禅意 | 落到代码 |
|---|---|---|
| 环回采集 | 映，不是搜 | 只采声音，不录屏不录人 |
| 实时转写 | 影随形，不先于形 | 半句与整句只留一行（`replaces`） |
| 账本 | 改也要留痕 | `transcript.jsonl` 只增不改 |
| 去重与回声 | 镜不照镜 | 回声防护，避免无限反射 |
| 断线缺口 | 缺而不掩 | `〔断线约 3 秒〕`，不假装没发生 |
| 演练模式 | 镜中花 | 不连真实会议也能跑全链路 |
| 未整理恢复 | 续影 | 账本还在，就能补出纪要 |

### 魂的一侧（心动，有分寸）

| 功能 | 禅意 | 落到代码 |
|---|---|---|
| 四层人格 | 魂有层 | `SOUL / IDENTITY / USER / STATE`，变化速率不同 |
| 记忆 | 会忘 | 半衰期 3 天，`0.5^(dt/3d)` |
| 信念 | 能生也能死 | `seed 0.3 → tree 0.85`，反驳 −0.25，弱到 0.02 枯死 |
| 情绪 | 成地貌 | 六情绪 → 光原/湖/火山/雾/山谷/峰 |
| 沉默 | 間 | 只在被叫、值得追问、明确要求时开口 |
| 一场会一条记录 | 一期一会 | 同键 + 未结束 + 45 分钟内复用目录 |
| 判定会话轮换 | 初心 | 每 200 轮或 45 分钟换新，避免被历史锚住 |
| 预约与到点参会 | 守时即在场 | 自己进会、自己记、自己写库 |

### 两半之间的一条硬线

| 层 | 谁负责 | 规则 |
|---|---|---|
| **事实层** | 镜 | 必须确定：账本、时间戳、音频、回执 |
| **判断层** | 魂 | 允许模糊：建议、追问、要不要说话 |

**判断可以模糊，事实不能模糊。** 反过来就是灾难。

> 镜照人，魂生念；照而不改，念而不夺。
> 在场，而不侵入。

完整论述（含功能对照表）：[docs/philosophy.md](docs/philosophy.md)
实现细节（哪些自动、哪些要点头）：[docs/soul-architecture.md](docs/soul-architecture.md)

---

## ✨ 它做什么

- **听**：环回采集会议声音 → 实时转写 → 逐句去重与断句修正
- **记**：会后重转写（可带说话人）→ 生成纪要 → 写进知识库
- **说**：需要时用自己的声音发言（支持克隆音色），或把结论播报给会议
- **做**：识别到"帮我查/整理/发"这类任务，交给 DSH 会话执行
- **到点参会**：预约一场会，时间到了自己进会、自己记、自己写库

一句话就能拉起来：

```
帮我在腾讯会议预约明天下午三点的周会
```

能力细节：[docs/features.md](docs/features.md) · 工具清单：[docs/tools.md](docs/tools.md)

---

## 📦 运行所需

### 必需

| 项目 | 说明 |
|---|---|
| **DSH** | 本插件是 DSH 插件，由 Cordis 加载 |
| **Windows** | 音频环回与桌面自动化依赖 Windows；`mbridge.exe` 随包分发，装完即可用 |
| **DashScope Key** | 语音识别与合成（阿里百炼），也可填兼容服务 |
| **一个模型** | 判断 / 纠错 / 总结需要 OpenAI 兼容接口 |
| **虚拟声卡** | 只有"发言"需要（如 VB-CABLE）；只开会不发言可以不装 |

### 可选插件

| 插件 | 给了什么 | 没有会怎样 |
|---|---|---|
| `dsh-knowledge` | 纪要用知识库持久化 | 只落本地 `minutes.md` |
| `dsh-pet` | 桌面上的那个小家伙 | 没有宠物，主功能不受影响 |
| `dsh-computer-use` | 入会坐标自愈标定 | 入会失败只报错，不自动重试 |

**可选插件没装时，对应功能会明确拒绝并提示安装，不会静默降级。**
面板「安装体检」里可以一键安装缺失的插件。

### 环境要求

- Node.js 20+（跟随 DSH 版本要求）
- 零第三方原生依赖：`mbridge.exe` 由系统自带 `csc` 编译，**已随包分发**
- 配置与记录只写在 DSH 实例目录下，不污染用户其它位置

完整清单：[docs/requirements.md](docs/requirements.md)

---

## 🚀 上手

```bash
dsh plugin --profile <你的 profile> add <本插件>
# 重启 dsh web → 侧栏底部「会议」→ 打开小窗
```

然后：填 Key → 点「测模型」确认连通 → 开会。

安装细节：[docs/install.md](docs/install.md) · 最短路径：[docs/quickstart.md](docs/quickstart.md)

---

## 🗺 文档地图

> 完整索引与维护约定见 [docs/README.md](docs/README.md)。

### 使用

| 文档 | 内容 |
|---|---|
| [docs/quickstart.md](docs/quickstart.md) | 最短路径跑通一场会 |
| [docs/ui.md](docs/ui.md) | 小窗与大页面 |
| [docs/config.md](docs/config.md) | 三个开关、配置项、密钥来源 |
| [docs/meeting-apps.md](docs/meeting-apps.md) | 会议软件识别与入会 |
| [docs/audio.md](docs/audio.md) | 采集设备怎么选 |
| [docs/unattended.md](docs/unattended.md) | 无人值守、预约与自动参会 |
| [docs/troubleshooting.md](docs/troubleshooting.md) | 健康状态、断线、预算、已知限制 |

### 深入

| 文档 | 内容 |
|---|---|
| [docs/philosophy.md](docs/philosophy.md) | **从名字出发**：Soul + Mirror 与每个功能的关系 |
| [docs/soul-architecture.md](docs/soul-architecture.md) | **魂的实现**：四层人格 / 记忆 / 信念 / 情绪 |
| [docs/architecture.md](docs/architecture.md) | 分层、会话身份、目录结构 |
| [docs/features.md](docs/features.md) | 能力与活数据 |
| [docs/tools.md](docs/tools.md) | `meeting_*` / `soul_*` 工具清单 |
| [docs/requirements.md](docs/requirements.md) | 依赖、可选插件、一键安装 |
| [docs/pet.md](docs/pet.md) | 桌面宠物对接 |

### 开发

| 文档 | 内容 |
|---|---|
| [docs/development.md](docs/development.md) | 测试与参考致谢 |
| [lib/README.md](lib/README.md) | **模块地图**：每个文件负责什么 |
| [tests/README.md](tests/README.md) | 测试怎么组织、怎么跑 |
| [tools/README.md](tools/README.md) | 构建与调试工具 |
| [scripts/README.md](scripts/README.md) | 安装 / 构建脚本 |

### 流程与存档

| 文档 | 内容 |
|---|---|
| [docs/meeting-workflow.md](docs/meeting-workflow.md) | 一场会议的完整生命周期 |
| [docs/fork-pet-integration.md](docs/fork-pet-integration.md) | 与 dsh-pet fork 的协议对接 |
| [docs/design-history.md](docs/design-history.md) | v2 / v3 / v4 设计演进（存档） |

---

## ⚠️ 两条必须知道的限制

1. **电脑休眠 / DSH 退出时，到点自动参会不会触发**——固有限制，不是 bug。
2. **会议软件改版可能让自动化失效**：入会、静音等依赖控件定位，
   失效时快速报错而不是卡死，可用 `meeting_ui` 手动兜底。

其余限制写在 [docs/troubleshooting.md](docs/troubleshooting.md)，不粉饰。

---

## 🙏 致谢

dsh-pet（桌面宠物协议）、dsh-knowledge（知识库）、
DashScope / paraformer / cosyvoice。

第三方许可见 [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)。
