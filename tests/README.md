# tests/ 测试

88 个测试文件，`node --test`，**零第三方测试框架**。

## 怎么跑

```bash
# 全部（推荐用显式文件列表，PowerShell 里 glob 可能不展开）
node --test (Get-ChildItem tests/*.test.mjs).FullName

# 单个
node --test tests/transcript-log.test.mjs

# 只看失败
node --test tests/*.test.mjs 2>&1 | Select-String "✖|fail "
```

> 注意：`node --test tests/`（目录）在 Node 24 会被当成模块，用文件列表。

## 为什么用 `.test.mjs` 而不是 `.test.js`

被测代码是 ESM（`import/export`），测试直接用 `.mjs` 避免 `type: module` 影响插件加载。

## 三个约定

1. **纯逻辑优先测**：判定、命名、回放、错误分类等都在可测的纯函数模块里。
2. **接线也要测**：光测函数不够——历史上出现过"函数对、但宿主没调"的 bug。
   所以有一类测试直接读 `index.js` 源码做断言（如 `meeting-naming-wiring.test.mjs`）。
3. **回归测试要写清事故**：每个修复都配一条测试，并在文件头写清"当初坏在哪"，
   例如 `ws-safety.test.mjs`（socket 错误没人接 → 宿主崩）。

## 分组一览

| 主题 | 代表文件 |
|---|---|
| 核心流程 | `core.test.mjs`、`session*.test.mjs`、`capture-supervision.test.mjs` |
| 账本与纪要 | `transcript-log.test.mjs`、`meeting-log.test.mjs`、`minutes-dedupe.test.mjs` |
| 恢复与会后 | `recovery.test.mjs`、`offline-pass.test.mjs`、`post-meeting.test.mjs` |
| ASR / TTS | `asr-*.test.mjs`、`ws-safety.test.mjs`、`tts*.test.mjs`、`model-probe.test.mjs` |
| 会议软件与入会 | `app-detect.test.mjs`、`join-guard.test.mjs`、`auto-join.test.mjs`、`uimap.test.mjs` |
| 判断与发言 | `advice*.test.mjs`、`trigger-rules*.test.mjs`、`reply-candidates.test.mjs` |
| 知识库与路径 | `knowledge-path.test.mjs`、`profile-path.test.mjs`、`profile-paths.test.mjs` |
| 内存与稳定性 | `memory-guard.test.mjs`、`audio-write.test.mjs`、`spawn-safety.test.mjs` |
| 界面 | `client-render.test.mjs`、`device-pick.test.mjs`、`compact-panel.test.mjs` |
| 命名 | `meeting-name.test.mjs`、`meeting-naming-wiring.test.mjs` |
| 依赖与分发 | `deps-optional.test.mjs`、`bridge-distribution.test.mjs`、`bom-guard.test.mjs` |
| 演练模式 | `demo*.test.mjs` |

## 已知问题

批量跑（多个文件一起）偶尔会挂起，单文件跑都正常——尚未定位，
最可能是某个测试起的服务端口与正在运行的 DSH 冲突。
排查时先逐文件跑定位。
