# docs/ 文档索引

主 [README](../README.md) 只放理念、功能与要求；细节都在这里。

## 使用

| 文档 | 什么时候看 |
|---|---|
| [quickstart.md](quickstart.md) | 第一次跑通 |
| [install.md](install.md) | 从零装起来 |
| [upgrade.md](upgrade.md) | 升级：增量、不同安装方式 |
| [ui.md](ui.md) | 找不到按钮、小窗大页面区别 |
| [config.md](config.md) | 三个开关、密钥、配置项 |
| [meeting-apps.md](meeting-apps.md) | 识别不到会议软件、入会失败 |
| [audio.md](audio.md) | 采不到声音、要发言 |
| [unattended.md](unattended.md) | 预约、到点自动参会 |
| [troubleshooting.md](troubleshooting.md) | 出问题了 |

## 深入

| 文档 | 内容 |
|---|---|
| [philosophy.md](philosophy.md) | 禅 · 与魂（完整版） |
| [linghun-reference.md](linghun-reference.md) | 借鉴 dsh-linghun：两层身份 + 三分法本体 |
| [soul-architecture.md](soul-architecture.md) | **魂的实现**：四层人格 / 记忆 / 信念 / 情绪 + 工具 |
| [architecture.md](architecture.md) | 分层、会话身份、目录结构 |
| [features.md](features.md) | 能力与活数据（记忆/信念/情绪） |
| [tools.md](tools.md) | 工具清单 |
| [requirements.md](requirements.md) | 依赖与可选插件 |
| [pet.md](pet.md) | 桌面宠物对接 |
| [meeting-workflow.md](meeting-workflow.md) | 一场会议的完整生命周期（状态机） |
| [fork-pet-integration.md](fork-pet-integration.md) | 与 dsh-pet fork 的协议细节 |

## 存档

| 文档 | 说明 |
|---|---|
| [design-history.md](design-history.md) | v2 / v3 / v4 设计演进摘要，保留当时的取舍 |
| [archive/](archive/README.md) | 三份原始设计文档全文（存档，描述当时状态） |

| [versioning.md](versioning.md) | 版本策略：插件版本 / 存储格式版本 / 升级回退 |
| [release.md](release.md) | 验证矩阵：哪些真机验过、哪些只有单测 |

## 代码级文档

- [../lib/README.md](../lib/README.md) — 模块地图（谁负责什么）
- [../tests/README.md](../tests/README.md) — 测试怎么组织
- [../tools/README.md](../tools/README.md) — 运行时组件与调试脚本
- [../scripts/README.md](../scripts/README.md) — 安装脚本

## 维护约定

1. **主 README 不写细节**：只留理念、功能、要求，其余链接过来。
2. **一份文档只讲一件事**：宁可多一个文件，也不要一篇 700 行的长文。
3. **写清限制**：做不到的地方明说，不粉饰（见 troubleshooting）。
