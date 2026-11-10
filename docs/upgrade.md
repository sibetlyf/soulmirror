# 升级（不同安装方式）

> 结论先说：**升级不需要卸载重装**。插件会按 `manifest.json` 比对每个文件的 sha256，只替换变了的。

## 一条命令

```
soul_setup { action: "upgrade" }
```

它会：

1. 从仓库取 `manifest.json`（运行时文件清单：路径 + sha256）
2. 与本地逐个比对 → 分出「新增 / 变更 / 一致 / 远端已移除」
3. 只下载新增与变更的文件
4. 写回后重新计算 sha256 校验，防止半截写入
5. 报告更新了几个文件

报告形如：

```
已增量更新 3 个文件：lib/upgrade.js、manifest.json、tools/mbridge.exe
当前版本：1.0.1
配置与会议记录未改动（都在 ~/.dsh/soulmirror，升级只替换插件文件）
重启 DSH 后生效（插件宿主代码只在启动时加载）
```

## 升级不会碰什么

| 位置 | 内容 | 升级是否触碰 |
|---|---|---|
| `<profile>/plugins/soulmirror` | 插件代码 | ✅ 只替换变化的文件 |
| `~/.dsh/soulmirror/config.json` | 配置（设备、密钥引用、开关） | ❌ 不碰 |
| `~/.dsh/soulmirror/<会议目录>` | 录音、转写、纪要 | ❌ 不碰 |
| DSH 凭据存储 | Key | ❌ 不碰 |

`manifest.json` 只收运行时文件：`index.js`、`lib/**`、`tools/{mbridge.exe,meeting-bridge.cs,ui.ps1,mic.ps1,hold.ps1}`、`package.json`、`README.md`。
`tests/`、`scripts/`、临时脚本不会同步。

## 三种安装方式

先看 `<profile>/package.json` 里 `soulmirror` 的值。

### 1. link 安装（推荐，也是默认）

```json
"soulmirror": "link:C:/Users/<你>/.dsh/profiles/web/plugins/soulmirror"
```

插件目录是普通目录 → **直接 `soul_setup { action: "upgrade" }`**。

### 2. git 工作副本

目录里有 `.git` → 可以 `git pull`，也可以直接 upgrade（按 manifest 覆盖，未提交的改动会被覆盖）。

### 3. node_modules（npm / pnpm 装的）

```json
"soulmirror": "^1.0.0"
```

**不支持原地覆盖升级**，工具会直接拒绝并说明原因：

- 下次 `install` 会把改动覆盖掉
- pnpm 的 store 是内容寻址的，可能只读
- 锁文件记录的版本与实际内容会不一致

正确做法：

```bash
pnpm add soulmirror@latest      # 或 npm i soulmirror@latest
```

想用增量升级，就改成 link：把仓库 clone 到 `<profile>/plugins/soulmirror`，再把依赖写成 `"soulmirror": "link:<该路径>"`。

## 私有部署 / fork

默认从 `sibetlyf/soulmirror@main` 拉取。自建或私有部署可指定自己的源：

```json
"upgrade": { "repo": "your-org/your-fork", "branch": "main" }
```

或环境变量：

```bash
SOULMIRROR_UPGRADE_REPO=your-org/your-fork
SOULMIRROR_UPGRADE_BRANCH=main
```

私有仓库需要宿主进程能访问（凭据走你自己的 git 配置，插件不代管 token）。

## 升级后必须重启宿主

- `lib/client.js` 改动 → 刷新页面即可（Ctrl+Shift+R）
- `index.js`、`lib/*.js` 等宿主侧改动 → **必须重启 DSH**

忘了重启会看到旧行为。插件能自己发现这一点：`/status` 里的 `host.stale`
会在代码比进程新时置真，界面顶部直接提示「宿主在跑旧代码，请重启 DSH」。

## 找回旧版本

升级只覆盖、不删除历史。想回退：

```bash
cd <插件目录>
git checkout <旧 commit>      # git 安装
# 或从 https://github.com/sibetlyf/soulmirror/tree/<旧 commit> 下载对应文件覆盖
```

配置与会议记录不受回退影响。
