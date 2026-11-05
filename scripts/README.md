# scripts/ 脚本

| 脚本 | 时机 | 作用 |
|---|---|---|
| `postinstall.mjs` | 安装后 | 尝试编译 `tools/mbridge.exe`（用系统自带 `csc`），失败只打提示、不中断安装 |

## 设计取舍

**postinstall 不应该是必需的一步。**

`mbridge.exe` 已随包入库，正常安装不需要它跑成功。
这里保留脚本只是兜底：如果 exe 被删、被隔离，或者用户改了 `.cs`，
安装时会顺手补上。

所以它：

- 失败**不抛错**（不能让安装失败）
- 只打印一行提示：`[soulmirror] mbridge 未就绪：<原因>`
- 真正的兜底在运行时：`lib/bridge.js` 的 `ensureBridge()`
  会在采集前检查，缺失就现场编译

## 自己跑

```bash
node scripts/postinstall.mjs
```

强制重编：

```bash
node -e "import('./lib/setup.js').then(m=>console.log(m.buildBridge({force:true})))"
```
