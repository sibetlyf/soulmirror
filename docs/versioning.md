# 版本策略

## 两个版本号，别搞混

| 版本 | 当前值 | 回答什么 |
|---|---|---|
| **插件版本**（`package.json` / `lib/version.js`） | `1.0.0` | 能力变了什么 |
| **存储格式版本**（`STORAGE_VERSION`） | `1` | 磁盘上的文件结构变没变 |

**为什么必须分开**：

```
1.0.0 → 1.1.0   加功能，旧数据照样能读        ← 无感升级
存储 1 → 2       文件结构变了，必须迁移        ← 升级前要备份
```

只用一个号时，这两种变化混在一起，用户既不知道"要不要迁移数据"，
也不知道"能不能回退"。

## 语义化版本（SemVer）在本项目的含义

### MAJOR（1.x.x → 2.x.x）

**破坏性变更**，出现任一项就要进位：

- 工具名或必填参数变化（`meeting_*` / `soul_*`）
- 配置键改名或语义变化（`cfg.*`）
- **存储格式不兼容**（必须同时 `STORAGE_VERSION + 1` 并提供迁移）
- 依赖的 DSH 服务接口变化，导致无法在旧宿主运行

### MINOR（1.0.x → 1.1.0）

**新增能力，向后兼容**：

- 新工具、新面板卡片、新配置项（有默认值，不填就行）
- 新存储层（旧文件仍可读，例如新增 `work` 层）
- 行为改进（例如收敛度算法调整），但产出文件仍可被旧版读

### PATCH（1.0.0 → 1.0.1）

**修复，不改接口、不改格式**：

- 崩溃/异常修复（ENOENT、ECONNRESET、OOM 之类）
- 路径、权限、编码类修复
- 文档与测试修正

### 预发布（`-beta.N`）

新能力在**真机上还没验证过**时先挂 beta：

```
1.1.0-beta.1  → 真机验过 → 1.1.0
```

> 约定：标了 beta 的功能，`docs/release.md` 的验证矩阵里必须是"未验证"。
> 反过来，矩阵里全绿的才配发正式版。

## 存储格式版本

`lib/version.js` 的 `STORAGE_VERSION`。**改结构就要 +1**。

涉及的文件：

```
<人格目录>/USER-CARD.md
<人格目录>/PROFILE.json
<人格目录>/memory/{warm,cold}.md
<人格目录>/memory/{episodic,journal}/*.md
<人格目录>/ontology/{knowledge,rules}.md
<配置目录>/config.json
<配置目录>/sessions.json
```

迁移的处理方式（`planStorageMigration`）：

| 磁盘版本 | 动作 |
|---|---|
| 等于当前 | `ok`，直接用 |
| 小于当前 | `migrate`，升级前先备份 |
| 大于当前 | `too-new`，**升级插件**而不是降级数据 |
| 缺失 / 0 | `unknown`，按首次运行处理 |

## 依赖要求

| 依赖 | 最低版本 | 依据 |
|---|---|---|
| Node | 20.18.0 | ESM、`fs/promises`、`node --test` |
| DSH | 0.9.0 | 用到 `sessionController` / `llm` / `schedule` / `webServer` / `tools` |

启动时会在日志里打印：

```
[soulmirror] 版本 1.0.0（存储格式 v1，Node 22.x.x）
```

不满足要求时打印 `⚠️` 与具体原因，并继续运行（不直接拒绝启动——
有些能力缺失时仍可用，例如没有 `schedule` 只是不能自动参会）。

## 怎么查当前版本

```bash
# 面板/接口
curl http://127.0.0.1:3080/api/soulmirror/status | jq .version
```

```json
{
  "version": "1.0.0",
  "storage": 1,
  "minDsh": "0.9.0",
  "minNode": "20.18.0",
  "node": "22.11.0",
  "compatible": true,
  "problems": []
}
```

## 升级与回退

```bash
# 升级（git 安装）
dsh plugin --profile web update soulmirror

# 回退到某个提交
dsh plugin --profile web add "github:sibetlyf/soulmirror#<commit>"
```

**升级前**：如果 `STORAGE_VERSION` 变大了，先备份人格目录：

```bash
cp -r ~/.dsh/soulmirror/persona ~/.dsh/soulmirror/persona.bak-$(date +%F)
```

**回退时**：若已用新格式写过数据，旧版本可能读不懂——
这正是 `STORAGE_VERSION` 存在的原因。

## 发布纪律

1. 改完跑测试：`node --test tests/*.test.mjs`（用显式文件列表）
2. 版本号同步：`package.json` 与 `lib/version.js` 的 `VERSION` 必须一致
   （测试 `tests/version.test.mjs` 会强制检查）
3. 若改了存储结构：`STORAGE_VERSION + 1`，并在 `docs/release.md` 写迁移说明
4. 更新 `CHANGELOG.md`
5. 打 tag：`git tag v1.0.0 && git push --tags`
