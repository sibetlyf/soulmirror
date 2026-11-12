# 安装失败排查

> 目标：拿到报错后 3 分钟内判断"这是本插件的问题，还是你 profile 里别的东西坏了"，然后按对应步骤修。

## 1. 一条最重要的事实：`dsh plugin add` 装的是**整个 profile**

`dsh plugin --profile web add <插件>` 会在 profile 的 workspace 里跑一次 pnpm 安装。
**profile 里任何一条依赖解析失败，都会让这次安装整体失败**——哪怕报错出现在你敲的这条命令里，罪魁祸首也可能是别的插件。

所以先别怀疑本插件，先看报错里出现的是哪个包名。

## 2. 实例：一条坏依赖挡住了安装（2026-11-12 实测）

```text
PS C:\Users\CMCC> dsh plugin --profile web add github:sibetlyf/soulmirror
✗ Lockfile failed supply-chain policy check (120 entries in 1.6s)
Progress: resolved 0, reused 1, downloaded 0, added 0
Error: ERR_PNPM_META_FETCH_FAIL
  ╰─▶ ERR_PNPM_RESOLVING_NPM_RESOLVER_NETWORK_ERROR: Failed to fetch metadata from https://registry.npmmirror.com/
      @cmjt%2Fdsh-personal-memory: HTTP status client error (404 Not Found)
```

逐行说明：

| 行 | 含义 |
|---|---|
| `Lockfile failed supply-chain policy check` | DSH 对 lockfile 做了一次供应链检查 |
| `ERR_PNPM_RESOLVING_NPM_RESOLVER_NETWORK_ERROR` | **pnpm 去 registry 查元数据失败**，不是本地权限问题 |
| `@cmjt%2Fdsh-personal-memory: 404` | 这条依赖在 registry 上**不存在**（`%2F` 就是 `/`，即 `@cmjt/dsh-personal-memory`） |

实测结论：这个包在 `registry.npmjs.org` 和 `registry.npmmirror.com` **两边都是 404**（我直接请求过两者的元数据接口）。也就是说 profile 里留着一条谁也下载不到的依赖，pnpm 解析到它就中止，于是 soulmirror 根本没开始装。

## 3. 三步定位（复制即可）

```powershell
# ① 谁在引用那个包
Select-String -Path "$env:USERPROFILE\.dsh\profiles\web\pnpm-workspace.yaml","$env:USERPROFILE\.dsh\profiles\web\package.json" -Pattern "dsh-personal-memory"

# ② registry 上到底有没有它
npm view @cmjt/dsh-personal-memory --registry=https://registry.npmjs.org

# ③ pnpm 自己的详细日志（DSH 也会在报错里给这个路径）
Get-Content "$env:USERPROFILE\.dsh\profiles\web\.plugin-manager\logs\operation-*\pnpm.log" -Tail 50
```

## 4. 修法（按推荐顺序）

### A. 去掉那条坏依赖（本例首选）

```powershell
dsh plugin --profile web remove @cmjt/dsh-personal-memory
dsh plugin --profile web add github:sibetlyf/soulmirror
```

如果 `remove` 也因为同一个解析错误失败，手工编辑 `%USERPROFILE%\.dsh\profiles\web\pnpm-workspace.yaml`，删掉那一行，然后再执行 `add`。

### B. 临时换 registry（那个包在 npmjs 上有、只是镜像没同步时）

在 `%USERPROFILE%\.dsh\profiles\web\.npmrc` 写入：

```ini
registry=https://registry.npmjs.org/
```

重跑安装；装完想换回镜像再删掉这行。
（本例中该包在 npmjs 也是 404，所以 B 不适用，直接用 A。）

### C. 手动安装（最后手段，绕过 pnpm）

```powershell
git clone https://github.com/sibetlyf/soulmirror.git "$env:TEMP\soulmirror"
robocopy "$env:TEMP\soulmirror" "$env:USERPROFILE\.dsh\profiles\web\plugins\soulmirror" /E
```

然后**重启 DSH**。

代价：插件管理器不认识这份安装（不会出现在插件列表的版本管理里），升级要 `git pull` + 再复制一次。

## 5. 那句 `allowBuilds` 提示不用慌

DSH 只要看到安装参数是 git 形式（`github:` / `git+` / `.git`），失败时就会打印：

> git-hosted plugins build on install via their prepare script, which pnpm blocks until allowed — add the exact key pnpm printed above under allowBuilds ...

这是**通用提醒**，不代表本插件要编译：

- 本仓库**没有** `prepare`、也没有 `postinstall`（`package.json` 的 `scripts` 里只有测试与自检命令）；
- 全部是可读 JS + 一个随包分发的 `tools/mbridge.exe`，**装完即用，不需要构建**；
- 如果 pnpm 真的打印了某个需要构建的 key，那属于**别的**包——只把 pnpm 打印的那个 key 加进 `pnpm-workspace.yaml` 的 `allowBuilds`。

## 6. 装好之后仍不工作的常见原因

| 现象 | 原因 | 处理 |
|---|---|---|
| 面板打不开 / 侧栏没有「会议」 | DSH 没重启 | 重启 DSH，再强刷页面 |
| 采集一直 0 字节 | 采集设备选错 / 会议声音不从该设备出 | 「设置 → 设备」里对齐，或先跑「一键体检」 |
| 提示缺少 `DASHSCOPE_API_KEY` | 没填百炼 Key | 「设置 → 会议助手」填一次（识别/语音/模型共用） |
| 发言没声音 | 没装虚拟声卡 | 装 VB-CABLE 等，把会议麦克风指向它 |
| `mbridge.exe` 被杀软拦 | 安全软件误报 | 把 `plugins\soulmirror\tools` 加入白名单 |
| Node 版本报错 | 版本太低 | 需要 **Node ≥ 22**（`node -v` 确认） |

## 7. 报告问题时请附上

1. `dsh plugin --profile web add ...` 的**完整输出**（别只截最后一行）
2. `%USERPROFILE%\.dsh\profiles\web\.plugin-manager\logs\operation-*\pnpm.log` 的最后 50 行
3. `node -v` 与 `dsh --version`
4. 如果是 Windows 采集相关，再附「一键体检」的结论文字
