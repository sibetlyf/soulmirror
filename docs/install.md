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
