# tools/ 工具

本目录两类东西：**随包分发的运行时组件** 和 **开发调试脚本**。

## 运行时（会随包发布）

| 文件 | 说明 |
|---|---|
| `meeting-bridge.cs` | 桌面桥接源码：WASAPI 环回采集 / SAPI 合成 / UIAutomation / 鼠标键盘 |
| `mbridge.exe` | **上面那个编译出来的产物**（约 32KB）。已入库，装完即可用 |

### 关于 `mbridge.exe`

- 由系统自带 `csc.exe` 编译，**无任何第三方依赖**（不需要 NuGet / native 模块）
- 已随包分发，所以正常安装**不需要 csc**
- 只有在两种情况下会重新编译：exe 被删/被隔离；或 `.cs` 比 exe 新
- **改了 `.cs` 必须重编并一起提交**：

```bash
node -e "import('./lib/setup.js').then(m=>console.log(m.buildBridge({force:true})))"
git add tools/mbridge.exe
```

忘了会被测试拦住：`tests/bridge-distribution.test.mjs` 会报
「exe 比 .cs 旧」或「exe 没被 git 跟踪」。

## 开发调试（不随包分发）

| 文件 | 用途 |
|---|---|
| `meeting-cli.mjs` | 命令行调 `mbridge`：列设备、采一段、播放、转储控件 |
| `run-capture.mjs` | 只跑采集（排查"有没有声音进来"） |
| `test-asr-loopback.mjs` | 环回采集 → ASR 端到端跑一遍 |
| `test-session.mjs` | 直接驱动 `MeetingSession`（不经界面） |
| `asr-test-server.mjs` + `asr-test.html` | 浏览器里试 ASR（本地起服务） |
| `ds-selftest.mjs` | DashScope 连通性自检 |
| `t2s-check.mjs` | 繁简转换抽查 |
| `hold.ps1` | 按住某键（配合发言时的开麦） |
| `ui.ps1` | UIA 控件转储（排查界面改版） |
| `test-meeting-agent.cmd` / `.ps1` | Windows 上的一键联调脚本 |

## 常见排查顺序

```
没声音      → run-capture.mjs → meeting-cli 列设备 → audio-diag
有声音没字  → test-asr-loopback.mjs（先确认 Key 与网络）
字不准      → ds-selftest.mjs / 看 ASR 模型名
点不到按钮  → ui.ps1 转储控件，确认 class/title 变没变
```

细节见 [../docs/troubleshooting.md](../docs/troubleshooting.md)。
