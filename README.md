# SoulMirror · 会议助手

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

## 🕯️ 三源 · 一个会议助手的哲学

> 好的工具像水。
> 你不看它时，它在流；你伸手时，它已经在掌心里。

这个项目的取舍，来自三条思想脉络。**每一条都能对回一行代码。**

| 传统 | 洞见 | 落在哪 |
|---|---|---|
| **道家** | 上善若水，不争；相忘于江湖 | 默认 `observe` 只听不抢话；记忆半衰期 3 天，会忘 |
| **《易》** | 简易 / 变易 / 不易 | 人格四层，各自变化速率不同 |
| **王阳明** | 致良知、知行合一 | 写库失败就报失败；存配置失败回滚内存，绝不谎报 |
| **日本禅** | 間（分寸）、一期一会、侘寂、初心 | 情绪决定沉默；一场会一条记录；断线留缺口不掩饰；判定会话定期换新 |
| **海德格尔** | 上手状态：好工具不被注意到 | 不弹窗、不抢焦点，只是世界的一部分 |
| **德雷福斯** | 情境无法被规则穷举 | 判断交给模型，规则只留确定层（会议号、失败分类） |
| **达马西奥** | 情绪参与决策 | 情绪不进纪要，但决定分寸 |
| **塞尔** | 语法不是语义 | 明确声明：它没有意向性；但痕迹为真 |

### 魂：它凭什么算"有魂"

> 有魂，不是会抒情，而是**记得住、会变、有情绪、还知道分寸**。

| 机制 | 一句话 | 真实参数 |
|---|---|---|
| **四层人格** | SOUL 不易，STATE 变易 | `SOUL / IDENTITY / USER / STATE` 四份文件 |
| **记忆会呼吸** | 相忘于江湖，才是活着的证据 | 半衰期 3 天，强度按 `0.5^(dt/3d)` 衰减 |
| **信念会进化** | 反者道之动，弱才是可持续的 | `seed 0.3 → tree 0.85`，反驳扣 0.25，弱到 0.02 枯死 |
| **情绪成地形** | 情绪是气候，气候成地貌 | 六种情绪衰减后长成光原/湖/火山/雾/山谷/峰 |

```
会中  每句话落账 → 记忆 +1、情绪 +1（本地判定，不花钱）
      争执升级 → 地形变火山 → 它选择沉默
会后  纪要入知识库；USER / STATE 追加成长
      你点头时：soul_belief seed —— 某个判断被升格为信念
```

> 情绪不进入纪要，**情绪决定分寸**。

完整论述（含十七处三源对照）：[docs/philosophy.md](docs/philosophy.md)
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
| [docs/philosophy.md](docs/philosophy.md) | **三源哲学**：道家 / 易 / 王阳明 / 日本禅 / AI 哲学 |
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
