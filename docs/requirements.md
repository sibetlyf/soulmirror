# 依赖与要求

所需插件、环境要求、可选插件安装。

## 🔌 依赖

运行需要三样东西：虚拟声卡（发言通道）、百炼 Key（识别与合成）、一个 OpenAI 兼容模型
（判断、纠错、总结）。虚拟声卡是唯一需要手动装的：

| 平台 | 方案 | 自动 |
|---|---|---|
| Windows | VB-CABLE | 内核驱动，手动装 |
| macOS | BlackHole | brew 需要 sudo |
| Linux | 不需要驱动 | `pactl` 加载 null-sink，全自动 |

`soul_setup { action: "deps" }` 会告诉你现在有没有、缺的话去哪装。

此外还有**两个可选插件**（不装也能用，只是少对应能力）：

| 可选插件 | 提供什么 | 没装时 |
|---|---|---|
| `dsh-pet` | 桌宠形象、状态档位动画、气泡、右键菜单 | 状态联动与气泡跳过，面板显示原因 |
| `dsh-knowledge` | 会后纪要写回知识库 | 纪要照旧落本地文件 |

一键安装见上面的「📦 可选插件与一键安装」。**装会议助手不会顺带装这两个**——
它们是独立插件，故意不做强依赖（dsh-pet 含 50MB+ 动画素材，不该塞进会议插件）。

---

## 📦 可选插件与一键安装

两个能力依赖**可选插件**，没装就不启动对应功能：

| 能力 | 依赖 | 没装时 |
|---|---|---|
| 桌宠形象与气泡 | `dsh-pet` | 状态联动、气泡、菜单全部跳过 |
| 会后写知识库 | `dsh-knowledge` | 纪要照旧落本地，只是不入库 |

```
GET  /api/soulmirror/deps            → 装了没装
POST /api/soulmirror/deps  {"pkg":"dsh-pet"}   → 一键安装
```

安装走 DSH 自己的命令（`dsh plugin --profile <p> add <pkg>`），插件不碰 profile 的
`package.json`，也不自己调 pnpm。

---

## 🤝 和别的插件

**dsh-knowledge**：装了就写回纪要（`knowledge.enabled` 默认开，先做依赖体检）；
没装时明确跳过并记录原因，纪要照旧落本地。

**dsh-pet**：单向推状态 + 反向注册菜单，走它公开的第三方接口
（`/work-status`、`/broadcast`、`/menu/item`）。它挂了或没装，会议主流程完全不受影响。

**computer-use**：两个都会发键盘事件，同时操作桌面会抢焦点。发言前会把会议窗口置前，
所以极端情况是你正在用 computer-use 操作别的应用，被它抢一下。

体检：`soul_setup { action: "links" }`。
