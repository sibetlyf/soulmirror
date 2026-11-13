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

---

## 8. 为什么"装一个插件却要求整份 lockfile 都能解析"（2026-11-13 实测）

有人问：装别的插件都正常，为什么装这个就要动别的东西？
**不是这个插件的问题，也不是"要更新其它插件"，而是 pnpm 的 workspace 机制。**

### 复现（同一个 workspace，对照组）

在一个只含一条坏依赖的 workspace 里（`@cmjt/dsh-personal-memory: ^0.1.0`，该包在 npmjs 与
npmmirror 上都是 404）：

| 实验 | 命令 | 结果 |
|---|---|---|
| A | `pnpm add is-odd`（**完全无关**的小包） | `ERR_PNPM_FETCH_404` → 失败 |
| B | 从 `package.json` 删掉那条坏依赖，再执行同一条命令 | `added 2, done` → **成功** |
| C | 坏依赖仍在，重新生成 lockfile 后执行 | 仍然 404 失败 |
| D | 加 `--no-lockfile` | 仍然 404 失败（无法绕过） |

结论：**只要 `package.json` 里有一条依赖解析不了，`pnpm add` 装任何包都会失败**——
包括装一个跟它毫无关系的小包。这与"装的是哪个插件"无关。

### 为什么 pnpm 要这么做

一个 workspace 只有一份 `pnpm-lock.yaml`。`pnpm add X` 要保证"加上 X 之后整份 lockfile
仍然可解"（这是 pnpm 的一致性设计），所以它会把 `package.json` 里**所有**依赖重新解析一遍，
再落盘。解析阶段就失败 → 下载一个字节都没开始（日志里的 `resolved 1, downloaded 0, added 0`
就是这个意思）。

### 所以"安插件不需要全部更新其他内容"这句话对，但 pnpm 的要求是"全部可解析"

不需要**更新**其它内容，但必须让它们**能解析**。两者不是一回事：
- 不需要升级、不需要重装其它插件；
- 只需要那条解析不了的依赖被删掉或被换成能解析的来源。

### 具体到这台机器（一步就好）

```powershell
# 1) 看 profile 里到底哪条坏了（会在报错里指名）
Select-String -Path "$env:USERPROFILE\.dsh\profiles\web\package.json" -Pattern "personal-memory"

# 2) 删掉那一行（只删这一条，别的插件一个字不动），然后重装
dsh plugin --profile web add github:sibetlyf/soulmirror
```

### 这个插件本身没有依赖，不会贡献任何解析项

`package.json` 里 `dependencies` / `devDependencies` / `optionalDependencies` **全为空**，
只有三个 `peerDependencies` 且都标了 `optional: true`（声明"依赖 DSH 自带能力"，不参与下载）。
代码里没有任何非 `@deepseek-ai` 的外部 import。

### 想提前确认自己会不会踩

```powershell
# 在 profile 目录里跑一次"只解析不安装"，有坏依赖会立刻报出包名
pnpm -C "$env:USERPROFILE\.dsh\profiles\web" install --frozen-lockfile --ignore-scripts
```

---

## 9. 不经过 pnpm 安装（绕开 registry 与"整库解析"）

> 结论先说：**可以**。已实测（隔离 DSH_HOME + `--dump-config` 验证，见下）。

### 为什么可行

DSH 的 profile 启动时只做两件事：
1. 用 profile 目录做 Node 解析锚点，解析 `dsh.profile.bundles` 里的每个包名；
2. 按顺序应用每个 bundle 的 `dsh.bundle.patch`。

也就是说：**只要 profile 的 `node_modules` 里能解析到这个包名，并且在 bundles 列表里有它**，
就会被加载——不需要 pnpm、不需要 registry、更不会去解析 profile 里其它任何依赖。

pnpm 在这件事里只负责"把包放成 node_modules 里的链接"。我们直接手工建同样的链接即可。

### 一步安装（本仓库自带脚本）

```powershell
# 把本仓库装进 web profile（不联网、不执行 pnpm）
node scripts\install-without-pnpm.mjs --profile web

# 指定其它源目录 / 其它 profile
node scripts\install-without-pnpm.mjs --profile headless --source G:\soulmirror

# 卸载（只删 bundles 里那一个名字 + 删链接）
node scripts\install-without-pnpm.mjs --profile web --uninstall
```

脚本做的事（每一步都有输出，失败会停下并说原因）：

1. 校验源目录确实是本插件（`package.json.name === soulmirror` 且有 `dsh.bundle.patch`）；
2. 建 `profiles/<p>/node_modules/soulmirror` → 源目录的链接（Windows junction / 其它平台 symlink）；
3. 在 `profiles/<p>/package.json` 的 `dsh.profile.bundles` 里**追加一个名字**
   （改之前先备份 `package.json.bak-<时间戳>`；其它内容一字不动）；
4. 立刻验证：跑 `dsh --profile <p> --dump-config`，确认组合结果里出现 `- id: soulmirror`。

### 实测证据（隔离环境，不碰用户 profile）

临时 `DSH_HOME=G:\dsh-test\_profprobe`，新建空 profile，bundles 只有 `@deepseek-ai/dsh-base` + `@deepseek-ai/dsh-web-app`：

| 步骤 | 结果 |
|---|---|
| 手工建 junction + 往 bundles 加一个名字 | `dsh --profile zp --dump-config` **exit=0** |
| 组合结果 | 出现 `# == soulmirror` / `- id: soulmirror` / `name: soulmirror`，并带出我们的配置项（`enabled: true`、`windowTitle: 腾讯会议`） |
| 脚本第一次运行 | `✓ 已链接` → `✓ 已加入 dsh.profile.bundles` → `✓ 已验证` |
| 脚本第二次运行（幂等） | `✓ 已指向…（不动它）` → `✓ 已在 bundles 里（位置 3/3）` |
| 卸载 | `✓ 已移除` → `✓ 已删除链接` → 再 `--dump-config` **组合结果里没有 soulmirror** |
| 再装回 | 通过 |

**整个过程没有联网、没有执行 pnpm、没有解析 `@cmjt/dsh-personal-memory` 这类坏依赖。**

### 什么时候用哪种

| 场景 | 推荐 |
|---|---|
| profile 健康（没有解析不了的依赖） | `dsh plugin --profile web add github:sibetlyf/soulmirror`（pnpm 自动管理，升级方便） |
| profile 里有一条下载不到的依赖、又不想动其它插件 | **用第 9 节脚本**（只加一个链接和一个名字） |
| 想改代码即时生效 | 第 9 节脚本 + 每次改完复制文件（本仓库 `soulmirror` 的日常开发就是这样） |

### 注意

- 这条路径**不会被 `dsh plugin` 的版本管理跟踪**：`dsh plugin list/remove` 看不到它，
  升级要重新指向新目录（脚本可重复执行，幂等）。
- 脚本只改两处：`node_modules` 链接、`package.json` 的 `bundles` 数组；其它插件、配置、数据一律不碰。
- Host 代码变更仍需**重启 DSH**（Client 改完重载页面即可）。
