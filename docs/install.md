# 安装

从零到能开会。

## 🔧 装起来

```bash
# 直接装（公开仓库，无需 token；已实测）
dsh plugin --profile web add "github:sibetlyf/soulmirror#main"
```

想改代码 / 想用增量升级，就换成本地 link：

```bash
git clone https://github.com/sibetlyf/soulmirror.git ~/.dsh/plugins/soulmirror
dsh plugin --profile web add link:~/.dsh/plugins/soulmirror
```

> `dsh plugin --profile <名字> ...` 只是把后面的参数转给 profile 目录里的 pnpm，
> 所以 `add` / `update` / `rm` 都可以直接用。

重启 `dsh web`，再跑一次 `soul_setup { action: "auto" }`。Windows 会用系统自带 `csc`
把 `tools/mbridge.exe` 编译出来，macOS / Linux 只做依赖检查。

> **`tools/mbridge.exe` 已随包分发**（32KB，由 `tools/meeting-bridge.cs` 编译）。
> 装完即可用，**不需要 csc、不需要 postinstall 跑成功**。
> 只有两种情况会重新编译：exe 缺失（被人删了/杀软隔离），或 `.cs` 比 exe 新
> （改了源码忘了提交新二进制）。改了 `.cs` 请执行 `buildBridge({force:true})` 重编并一起提交，
> `tests/bridge-distribution.test.mjs` 会拦住"忘了重编"和"忘了提交"。

> PowerShell 会把 `#` 当注释，上面那个 ref 的引号不能省。

## 装不上的常见报错

### `ERR_PNPM_IGNORED_BUILDS` / `dsh: plugin command failed`

```text
[ERR_PNPM_IGNORED_BUILDS] Ignored build scripts: soulmirror@https://codeload.github.com/...
Run "pnpm approve-builds" to pick which dependencies should be allowed to run scripts.
dsh: git-hosted plugins build on install via their prepare script, which pnpm blocks until allowed
```

**原因**：pnpm 10 默认拦截**依赖**的生命周期脚本（`postinstall`/`prepare` 等），
需要人工审批；DSH 把这个"被忽略"当成安装失败。

**旧版本（≤ `5ef33b6`）有 `postinstall`**，所以会触发。已在 `33671b5` 移除
（那脚本只是编译 mbridge、生成默认配置——前者随包分发，后者运行时会幂等生成）。

处理方式二选一：

1. **装新版本**（推荐）：

   ```bash
   dsh plugin --profile web add "github:sibetlyf/soulmirror#main"
   ```

2. **留在旧版本就手动放行**：按提示把 pnpm 打印的那个 key 加到
   `<profile>/pnpm-workspace.yaml` 的 `allowBuilds` 下，再重跑一次。

> peer 依赖的 `[WARN]` 可以忽略：`@deepseek-ai/dsh-tools`、`schemastery`、
> `react` 由 DSH 运行时提供，不需要装进 profile。
