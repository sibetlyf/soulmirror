# 发布与验证矩阵

> 版本号代表"我承诺了什么"。这张表说明**承诺兑现到哪一步**。
>
> 诚实优先：**未验证的就写未验证**，不因"应该没问题"就算通过。

## 1.0.0 验证状态

### 真机上验证过（有实际输出）

| 能力 | 证据 |
|---|---|
| 专属知识库建库 + 写画像 | 建库返回 `created:true`，二次同步 `action:updated`，条目仍为 1、版本 v2 |
| 画像渲染 | 232 字符文档，含相似程度/身份/语气/立场/规则 |
| 会议账本回放 | 3 场真实会议账本回放正常，账本行数 = 折叠后句数 |
| 未整理会议扫描 | 75 个目录 7.2ms，堆占用 4.5MB |
| 记忆衰减与情绪地形 | `anger 0.5 → 火山`、`joy 0.5 → 光原` |
| 信念演化 | seed 0.3 → 强化 4 次到 tree → 反驳 6 次到 dead |
| `mbridge` 自愈 | 删掉 exe 后重新编译，32KB / 361ms |
| 模型联通性错误翻译 | 401 → "Key 无效或未被接受" + 可操作提示 |

### 只过了单元测试（逻辑正确，未在真机跑完整链路）

| 能力 | 说明 |
|---|---|
| 会后重转写交给独立 dsh 子进程 | 回落路径已写；子进程能否调到本插件工具未实测 |
| 三场会收敛度上升 | 用模拟数据验证单调上升，未用真实多场会议累积 |
| 画像冲突取代与 TTL | 单测覆盖，真实数据量下未长时间运行 |
| 规则命中注入 | 单测覆盖；真实会议里是否命中合适规则未评估 |
| 会议目录复用（一期一会） | 单测覆盖 45 分钟窗口；未实测跨重启场景 |

### 已知未完成

| 项 | 状态 |
|---|---|
| 按说话人区分多人画像 | 未做。现在会把别人的观点当成她的立场（结构性风险） |
| 工作模式独立层 | 未做。偏好信息目前混在 `facts` 里 |
| 收敛度历史曲线 | 未做。只有当前分数，无法回看趋势 |
| 判据指纹 / 负面样本 | 未做。见 [docs/linghun-reference.md](linghun-reference.md) 待办 |
| 批量重命名历史目录 | 未做。旧目录仍是时间戳命名 |

## 升级检查清单

升级到新版本时按顺序确认：

1. **看版本差异**：`/status.version` 里的 `version` 与 `storage`
2. **`storage` 变大？** 先备份人格目录：
   ```bash
   cp -r <DSH根>/soulmirror/persona <DSH根>/soulmirror/persona.bak
   ```
3. **重启 DSH**（宿主侧改动需要重启才生效）
4. **看启动日志**：应打印 `[soulmirror] 版本 x.y.z（存储格式 vN，Node ...）`
5. **跑一次演练**：面板「开始演练」，确认转写 → 纪要链路通
6. **看 `/status`**：
   - `compatible: true`
   - `knowledge.installed` 符合预期
   - `memoryLayers.convergence` 有你预期的数字

## 回退纪律

| 情况 | 做法 |
|---|---|
| 只是功能不满意 | 回退插件提交（`github:…#<commit>`），数据不动 |
| 存储格式已升级 | **不能用旧版读新数据**。要么恢复备份，要么升级回新版 |
| 数据损坏 | 人格目录可整份删除重建（会从零开始长），会议账本不受影响 |

> 会议账本（`transcript.jsonl`）与人格目录是两套数据：
> 前者是"发生过什么"，后者是"它是谁"。删人格不会丢会议记录。

## 发布前自检

```bash
# 1) 版本号同步（测试会强制检查）
node --test tests/version.test.mjs

# 2) 相关回归
node --test tests/persona-growth.test.mjs tests/persona-wiring.test.mjs \
            tests/persona-kb.test.mjs tests/persona-kb-wiring.test.mjs \
            tests/memory-layers.test.mjs tests/memory-wiring.test.mjs \
            tests/soul.test.mjs tests/linghun-adapt.test.mjs \
            tests/docs-structure.test.mjs tests/meeting-finish.test.mjs

# 3) 更新 CHANGELOG.md，然后打 tag
git tag v1.0.0 && git push --tags
```

## 版本落点

| 位置 | 内容 |
|---|---|
| `package.json` → `version` | 插件版本 |
| `lib/version.js` → `VERSION` | 同一版本（测试强制一致） |
| `lib/version.js` → `STORAGE_VERSION` | 存储格式版本 |
| `/status.version` | 运行时汇总（含 Node/DSH 兼容性判断） |
| 启动日志 | 一行版本 + 存储格式 |
