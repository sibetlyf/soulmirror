# 安装

从零到能开会。

## 🔧 装起来

> `dsh plugin --profile <名字> ...` 只是把后面的参数转给 profile 目录里的 pnpm，
> 所以 `add` / `update` / `rm` 都能直接用。

按可靠性排序，**推荐第一种**：

### 方式一：clone 后 link（推荐）

```bash
git clone https://github.com/sibetlyf/soulmirror.git ~/.dsh/plugins/soulmirror
dsh plugin --profile web add link:~/.dsh/plugins/soulmirror
```

不经过 pnpm 的"git 依赖构建审批"，也不受 `files` 白名单限制；
可以改代码，也能用增量升级（`soul_setup { action: "upgrade" }`）。

### 方式二：tarball 地址（一条命令）

```bash
dsh plugin --profile web add "https://github.com/sibetlyf/soulmirror/archive/refs/heads/main.tar.gz"
```

同样不需要构建审批（pnpm 把它当普通 tarball，不当 git 依赖）。
代价：拿到的是整个仓库（约 1.8MB，含 tests/）。

### 方式三：`github:` 简写

```bash
dsh plugin --profile web add "github:sibetlyf/soulmirror#main"
```

最简洁，但 **pnpm 会把 git 来源的依赖统统视为"需要构建审批"**，
在没配置过 `allowBuilds` 的机器上会报 `ERR_PNPM_IGNORED_BUILDS`。
遇到就改用方式一或二，或按下面的说明放行。

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

如果报错里被拦的是**别的包**（例如 `node-pty`、`koffi`、`protobufjs`、`@google/genai`）：

```text
[ERR_PNPM_IGNORED_BUILDS] Ignored build scripts: koffi@3.1.1, node-pty@1.2.0-beta.15, ...
Packages: +786 -7
```

那说明安装时把 DSH 内部依赖也拉进了 profile（早期版本把 `@deepseek-ai/dsh-tools`
声明成了必装 peer）。已在 `b784e5f` 把 peer 全部标记 `optional`，装新版本后只会装 1 个包：

```bash
dsh plugin --profile web add "github:sibetlyf/soulmirror#main"
```

实在要留旧版本，就按提示把这几个 key 加进 `<profile>/pnpm-workspace.yaml` 的 `allowBuilds`：

```yaml
allowBuilds:
  '@deepseek-ai/dsh-subprocess-local': true
  '@google/genai': true
  koffi: true
  node-pty: true
  protobufjs: true
```

然后重跑。被拦的包是 DSH 自身依赖，放行前值得确认它们来自官方来源。

### 为什么 `github:` 这种方式最容易撞上审批

pnpm 把**所有 git 来源的依赖**视为"可能需要在本地构建"，即便包里根本没有
`postinstall` / `prepare`。所以在一台没配置过 `allowBuilds` 的机器上，
哪怕我们这边完全干净，装完仍可能看到：

```text
[ERR_PNPM_IGNORED_BUILDS] Ignored build scripts: ... , soulmirror@https://codeload.github.com/...
```

两条路，任选：

1. **换安装方式**（最省事）：用上面的「方式一 clone 后 link」或「方式二 tarball 地址」，
   它们不经过 git 依赖通道，不需要任何审批。
2. **就地放行**：把 pnpm 打印出来的每一条都写进 `<profile>/pnpm-workspace.yaml`，然后重跑：

   ```yaml
   allowBuilds:
     soulmirror: true
     '@deepseek-ai/dsh-subprocess-local': true
     '@google/genai': true
     koffi: true
     node-pty: true
     protobufjs: true
   ```

   放行等于允许这些包在安装时执行脚本，请确认来源可信（前五个是 DSH 自身依赖）。
