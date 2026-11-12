# SoulMirror 开发与发布规程

规则约束所有修改，入口见 [AGENTS.md](../AGENTS.md)。参考 [DSH 只追加日志](https://dshbase.com/zh/blog/deepseek-harness-session-log/)：日志是真相，界面是投影，不是另一套状态。文档规则不等于实现已符合，须提供当次验证证据，不固定宣称历史测试数量。

## 1. 先复现，再修根因
1. 写最小失败用例，明确输入、期望和实际错误，先运行看到红灯。
2. 追溯实际路径。例如 recTimer 在 try 内声明、finally 越界访问；node --check 无法查出这种运行时作用域错误。
3. 修根因，不以空 catch 绕过；同例转绿，再跑相邻回归。
4. 保留失败→修复→通过命令与结果。静态源码断言只辅助，不能代替行为断言。

## 2. 可执行门禁
```sh
npm run check:scope
npm run test:rules
npm test
```
- 作用域检查拦截未定义名字、块作用域越界、声明前使用与语法错误；不是完整类型检查。
- 检查器只用 Node 模块解析或 SOULMIRROR_TYPESCRIPT 显式编译器入口，不运行 npm root -g，不捕获子进程管道。
- 缺工具/输入退出 2；代码问题退出 1；通过才退出 0。CI 必须准备 TypeScript，缺工具不能标绿。
- 本机 node_modules 是 DSH 宿主 junction，禁止在其中 npm install。独立干净 CI 可执行 `npm install --no-save --ignore-scripts --legacy-peer-deps typescript@5.9.3`；不改运行时 peer 依赖。
- test:rules 验证“坏代码必须失败”、工具缺失失败、Key 测试隔离；client-render 验证真实组件执行，但不等于浏览器实机验证。
- 禁止 --test-force-exit：不自然退出就是泄漏。超时用于报告失败，不表示底层资源已清理。
- `npm test` 固定 `--test-concurrency=4`：默认并发在本机（100+ 测试文件、多个会启动插件实例）
  会互相拖慢到看起来挂住；限并发后 20s 跑完。不要把"卡住"当成通过，也不要靠强制退出绕开。

### 硬件集成测试（默认跳过）
`SOULMIRROR_INTEGRATION=1` 只在获得当前用户明确授权、隔离的测试机上使用。它允许真实进程/网络，不能当作普通单测开关。以下保留原断言并显式跳过，不计入默认通过数量：
- switch：只读状态/设备探测；开启后标定放行。
- stop-button：显式 confirm 入会客户端路径。
- plugin：soul_setup check/links/deps 的真实设备依赖。

默认集成路由测试通过 helpers/isolated-plugin：临时 SOULMIRROR_HOME/dataDir、fake windows、执行 effect 清理，并封锁所有 child_process 入口与 fetch。probe 的 Fake A/Fake B 只允许写临时配置。启用硬件集成不代表这些功能已验证；须单独报告实际硬件/权限与执行结果。

## 3. 测试隔离与资源清理
- 写文件必须 mkdtemp(tmpdir())，显式 dataDir，在 t.after/finally 先关闭会话/流再清理目录。禁止空 dataDir、用户 .dsh、用户会议目录。
- 禁止真实录音、发声、入会、桌面操作、网络和用户 Key/注册表。ASR/TTS、进程、网络、时钟须依赖注入 fake/mock；意外真实 spawn 应立即抛错。
- 假 Key 使用明显测试字符串；缺 Key 注入 resolver 返回空串，不清除/改写真实环境或凭据。
- 每个 timer/stream/child/listener 有所有者及可重复清理路径；测成功、失败、超时、取消、重试、重启。timer 句柄声明在 finally 可见的作用域。
- 每场会持有不可变目录快照，旧任务不能读已切到新会议的 session.dir。
- 旧测试若尚未隔离，列出风险逐项迁移，不得宣称整个套件已安全；不删断言凑通过。

## 4. 状态先落盘，后投影
- 事件追加成功后才更新投影、通知 UI；写盘失败必须可见，不能展示成功。
- 状态条/侧栏/桌宠/工具/API 共用状态投影和显示配置，不各自拼阶段或完成条件。
- 重放纯函数须确定性；测重启前后投影一致、空日志、半行/损坏行、轮转、重复事件、目录迁移和旧产物导入。
- 不承诺任意文本日志都能恢复全部状态：缺事件须明确证据缺口，只从可验证产物推断，不能伪造完成。
- 超时后取消底层工作或 fencing 旧 attempt，禁止迟到结果覆盖新任务。外部写入用幂等键或读回确认；结果不确定不得盲目重发。

## 5. 用户可感知、模型默认与授权
- 展示排队/运行/完成/跳过/失败、原因、时间、修复及重试入口。未确认入库不等于全完成。
- 无静默回退：非流式转写失败不能用实时稿冒充；抽取稿必须标来源及局限；无内容不得空生成成功。
- 没真实分母就显示阶段和等待时间，不以耗时伪造百分比。
- 非语音功能默认继承 DSH 会话模型；显式配置才覆盖，显示 resolved provider/model/source。不能因某环境 Key 存在就自动切模型。
- 自动检测/录音不是自动入会许可，禁止自动入会；对外动作遵守 DSH 审批与当前用户授权。
- 日志/诊断包不得含 Key、Token、密码。

**会议结束自动停止（`autoStop*`）**：会散了却不停采集，是"转录停不下来"的直接原因，所以判定必须可解释：
- `autoStop`（默认 `true`）：会议结束后自动停采集并进入会后整理；关掉后只能手动停。
- `autoStopSilenceSec`（默认 `120`）：客户端退出会议后常仍占着麦克风句柄，要连续静音这么久才算结束。
- `autoStopGraceSec`（默认 `60`）：采集开始 60 秒内不许自动停（刚入会窗口/麦克风都还没稳定）。
- 规则本身是纯函数 `lib/lifecycle.js#shouldAutoStop`（会中窗口/短暂切换/麦克风+音频能量都不停）；停止原因写进 `lifecycle.snapshot().stopReason` 与日志。

## 6. 声纹模型与运行库安装
装一次就够；**绝不随插件分发几十 MB 权重**。清单在 `lib/voiceprint/models.manifest.json`，
里面每个文件的 `bytes/sha256/sha512` 都是实测的，改版本必须重新实测，不能只看文件大小。

**命令（与面板「一键安装」同一套代码）**
```bash
node scripts/fetch-voiceprint-model.mjs --list                 # 看清单与已装状态
node scripts/fetch-voiceprint-model.mjs --dir %TEMP%\sm-e2e    # 装默认模型 + 运行库 + 自检
node scripts/fetch-voiceprint-model.mjs --model campplus-zh    # 换模型（192 维）
node scripts/fetch-voiceprint-model.mjs --model-only           # 只装模型（不做自检）
```
自检会真的加载运行库、建 session、算一条向量，最后打印
`自检通过：256 维，… ms / 2 秒音频`；只打印"文件已存在"不算通过。

**校验与原子性**：先下到 `.part`，算 size → sha256（运行库是 sha512）→ 全对才 `rename` 成正式文件；
不符就删掉 `.part` 并以 `ok:false + 原因` 返回。取消（AbortSignal）也删 `.part`。
已装且校验通过时幂等跳过，不会重复下载 115 MB。

**数据目录（插件自己管的，别写宿主依赖目录）**
- `<数据目录>/voiceprint/models/<清单 file>`（如 `wespeaker_zh_cnceleb_resnet34.onnx`；
  注意文件名来自清单 `file`，不是模型 id）
- `<数据目录>/voiceprint/runtime/package/`（onnxruntime-node 的 `dist`/`lib`/dll/binding）
- `<数据目录>/voiceprint/runtime/package/node_modules/onnxruntime-common/`（嵌套依赖，目录名必须是 npm 包名）
- `<数据目录>/voiceprint/runtime/installed.json`（装了什么，`files` 记录必须都还在才算可用）
- `<数据目录>/voiceprint/install.json`（一键安装状态机，界面只读它）

**为什么不写宿主 `node_modules`**：本机 `node_modules` 是宿主依赖 junction，开发规则禁止写；
而且运行时替换 DLL 会被宿主占用（Windows 锁文件）。所以运行库解到数据目录，按文件路径 `import`。

**失败怎么排查**（`install.json` 的 `phase` + `error` + `hint` 就是入口）
| 现象 | 原因 / 动作 |
|---|---|
| `download-model` 停在 0% | 网络/代理挡住 GitHub release；换镜像或手动下载后按 sha256 核对 |
| `verify-model` 报 sha256/大小不符 | 下载被截断或被替换；`.part` 已删，重跑一次 |
| `extract-runtime` 报解压失败 | 需要系统 `tar`（Win10+ 自带）；检查磁盘空间 |
| `done` 后仍 `model-missing` | 模型路径与清单 `file` 不一致（路径 bug）或用户配了自定义 `modelPath` |
| `Load failed`/`onnx-runtime-load-failed` | 运行库解压不全（常见是 `onnxruntime-common` 没落到 `package/node_modules/`），重装运行库 |
| 重装运行库报"旧文件删不掉" | DLL 正被 DSH 加载；退出/重启 DSH 后再装 |
| 重启后状态停在中间阶段 | `install.json` 会被归一化成 `failed` + "上次安装未完成"，重新点一次 |

**取消**：`POST /api/soulmirror/voiceprint-install-cancel` 只置"正在取消"，终态由后台任务写；
取消后不写 `installed.json`、不跑自检、`.part` 与 `.tmp-*` 都清掉，界面落 `idle` 而不是红色失败。

### 6.1 录声纹时的朗读文本
注册要 10 秒有效语音，对着麦数数往往读不满。文案在 `lib/voiceprint/read-aloud.js`（10 段小故事/冷知识），
硬约束全是导出常量，改文案时按常量验一遍，别只改注释：

| 常量 | 含义 |
|---|---|
| `MIN_READ_SECONDS` | 与 `quality.js` 的 `MIN_SAMPLE_SPEECH_SECONDS` 同源（不重复定义 10） |
| `MIN_CHARS` / `MAX_CHARS` | 每段汉字数的下限 / 上限（`hanCount` 只数汉字，标点不算） |
| `MAX_ESTIMATE_SECONDS` | `estimateSeconds()` 的保守估算上限（4 字/秒，宁可多报一秒） |

- 选文要求：连贯完整的小段、有画面；**不要绕口令、生僻字、长数字串、英文单词**——读错卡壳会污染向量。
- `pickPassage(rand)` 随机挑一段，排除上一次的 id（连续两次不重复）；`rand` 可注入，测试不用碰真随机。
- 文案**只有服务端这一份**：`GET /api/soulmirror/voiceprint` 的 `readAloud: { minSeconds, passages, pick }`
  由 `listPassages()` 生成，客户端只挑"当前哪一段"，不复制文本。
- 界面（`VoiceprintCard`）：录音按钮上方显示当前段与"这段约 N 秒 · 说满 N 秒才能注册"，「换一段」在未录音时可用；
  录音中整块高亮并显示**真实已录秒数**（不编百分比）；不足门槛就在前端提示重录，不送到后端等一次报错。

### 6.2 体检里的声纹项
`collectPreflightEnv`（`index.js`）收集事实 → `buildPreflight`（`lib/preflight.js`）出判定，检查项 `id/key` 都是 `voiceprint`。

**只读文件与配置，绝不加载 ONNX 模型**：加载会锁住 `onnxruntime.dll` / `.node`，
之后「一键安装」换运行库会被 Windows 拒绝（"旧文件删不掉"）。所以这一项只回答
"配置/文件/库齐不齐、能不能认人、缺哪一步"，不承诺"模型这一次能推理"——真推理在安装末尾自检与会后认人时发生。
`npm test` 与运行库测试不受影响。

| 状态 | level | 结论 / 修法 |
|---|---|---|
| 未启用 | info | 本机声纹未启用（会后只按匿名说话人整理纪要） → 在「纪要与产物」页开启 |
| 模型缺失 | warn | 声纹模型未安装 → 点「一键安装」下载并校验 |
| 模型在但哈希/大小不符 | warn | 模型文件校验不通过（可能被截断或被替换） → 删掉后重新安装 |
| 运行库缺失 / `package/dist/index.js` 不在 | warn | 运行库未安装或文件不全 → 点「一键安装」补齐 |
| 库文件损坏 | warn | 读不出已入库的人，不能按 0 人处理 → 备份后删 `library.json` 再重录 |
| 都就绪但 0 人 | info | 声纹就绪，但还没有录过人 → 在「本机声纹」里录一段（≥10 秒） |
| 都就绪且有样本 | ok | 声纹就绪：N 人 / M 个样本（阈值 0.60 + margin 0.15） |

非致命项：声纹不参与"能不能转录"，只影响"会后能不能认出人"，所以 `fatal: false`；
一句话结论会用它自己的 `verdict`（如"声纹模型未安装"），不再只显示文件名。

## 7. 保存位置（录音 / 纪要 / 导出可配置）
用户要求"手动选择纪要和录音等保存位置"。这一项的难点不是加输入框，而是**不能丢历史、不能越界、不能静默失败**。

**两个键**

| 键 | 语义 | 空值 |
|---|---|---|
| `storage.recordsRoot` | 新会议的录音 / 纪要 / 转写写这里 | 默认数据目录（`dataDir` → `~/.dsh/soulmirror`） |
| `storage.exportDir` | 导出的纪要 / 转写文件写这里 | 仍然由浏览器下载（原行为） |

**单一真源**：`index.js#recordsRoot()` 是唯一出口（`storageState().effectiveRoot`），别处不再手拼
`join(CONFIG_DIR, ...)` 当会议根。`session.dataRoot()` 读的是 `cfg.dataDir`，所以生效自定义根时把
`cfg.dataDir` 指向它（没配自定义位置时保持原值，不改老行为）。配置、日志、声纹库、workspace 仍然在 `CONFIG_DIR`。

**绝不丢历史**：所有"读取/列表"同时扫两个根，并且去重 + 按时间倒序 + 标注来源：

| 位置 | 用什么 |
|---|---|
| `lib/recordings.js#listRecordings` | 接单根或 `[{path, kind}]`；每条带 `root: default|custom`，并给 `byRoot` 计数 |
| `GET /records` | `listRecordsMerged()`（两个根的 `listRecords` 合并去重排序） |
| `GET /recordings` | `listRecordings(recordsRoots())` + `storage` |
| 纪要连续性 | `collectHistoryByRoots()`（`minutes-history.js` 签名不动，在调用处按根调用后合并） |
| 未整理会议扫描 / 人格回填 | `scanPendingRecovery`、`readdirSync` 也按根循环 |

**越界防护按"实际根"收紧，不放松**：`resolveRecordDir`、`/offline`、`/records/delete`、
`/record`、`/record/export` 的白名单都改为"默认根或配置根的直接子目录"（`isDirectChildDir`），
嵌套目录、`..` 穿越到根外、根本身一律 `bad-path`；`resolve()` 之后再判断，所以 `..` 解析回根内是允许的。
`/open-path` 额外放行"配置的会议根 / 导出根"（仍然只走宿主 `openWorkspacePath`，不拼 explorer 命令）。

**校验（`lib/recordings.js#validateStorageDir`）**，失败一律 `{ok:false, reason, message, hint}`：

| reason | 触发 | 用户看到的下一步 |
|---|---|---|
| `bad-path` | 空 / 相对路径 / 不存在的目录 | 挑一个已存在文件夹（**不自动创建**，避免拼错后写错地方） |
| `is-file` | 指向文件 | 换成文件夹 |
| `inside-app` | 在 DSH / 插件安装目录内（`node_modules`、插件根、`process.execPath` 目录） | 换自己新建的目录（升级会覆盖/锁住） |
| `not-writable` | 探针写入/回读/删除失败 | 查权限、只读盘、OneDrive 占位、杀软拦截 |
| `no-space` | 剩余 < 200MB（`MIN_STORAGE_FREE_BYTES`） | 换盘或清理 |

探针是**真写一次再删**（不用 `accessSync` 猜"看起来可写"），探针文件叫 `.soulmirror-write-probe-*`。
写不进、回读不一致、删不掉都算失败（留下的探针会污染会议列表）。`statfsSync` 拿不到空间时返回
`freeUnknown: true` 而不是假装有空间；空间判定在探针之前（省一次写）。

**接口**：`POST /api/soulmirror/storage`，`{ action: validate|save|reset, kind: records|export, path }`

- `save` 先校验再落盘（`patchToStore` 白名单加 `storage`）；落盘失败返回 `save-failed`，**不改运行时值**。
- 校验不过 → 原配置保持不变，响应带 `reason/message/hint`；界面就地显示，不"看起来保存了"。
- 运行时另有一层：`/status` 的 `storage.{recordsRoot(=effectiveRoot), effectiveRoot, defaultRoot, configured, custom, fallback, reason, message, hint, exportDir, export*}`；
  `/config` 读回带 `storage`（用户值 + 生效值）。配置目录被删/权限丢了 → `fallback=true` 并回退默认根，
  响应与界面都写明"已回退"，绝不静默。

**不自动搬旧数据**（有意不做"把旧会议复制到新位置"）：跨盘/大文件复制会引入第二份真相，
一旦中途失败还要回滚，而源文件本来就在；用户要搬可以直接在资源管理器里移动。
选择"以后写这里 + 两个根都列出"能让旧会议继续可见、可整理、可删除，风险面最小。

**界面**：`lib/client.js#StorageCard`（设置页 + 面板设置页）：当前实际路径、「选择文件夹」（输入/粘贴绝对路径）、
「校验并保存」、「只校验」、「恢复默认」、「在文件夹中显示」，并写清"已有 N 场仍在原位置"。
「之前的录音」每条带 `自定义位置` 标记、头部写明"新会议写到哪 + 旧会议数量"；产物卡显示这场属于哪个位置与导出位置。

**已知边界**（不是 bug，但要能解释）：网络盘/OneDrive 目录探针通过后仍可能因断线/占位文件在中途写失败；
组策略限制的目录只能靠真写发现；`statfsSync` 在少数文件系统上拿不到剩余空间；移动/重命名自定义根会让配置失效 → 回退默认根并提示。

**验证命令**（全部在 `mkdtemp` 里，不碰用户数据）：
```sh
npm run check:scope
node --test tests/recordings-import.test.mjs tests/view-contract.test.mjs tests/hooks-order.test.mjs
```
另外用临时脚本跑过 7 组行为：默认/自定义/非法路径（含每条 reason）、两根列表去重与排序、
`/offline` 白名单（直接子目录放行；嵌套/`..` 穿越/根本身拒绝）、导入落自定义根且默认根数量不变、
真写失败 `not-writable`、配置目录删除后回退并明确说明、导出落盘与空配置原行为。

## 8. 发布证据清单
- [ ] 原失败用例修后通过；scope 零问题；相关及全量回归命令、通过/失败数。
- [ ] 无真实音频/网络/Key 副作用；临时目录清理；测试自然退出。
- [ ] manifest/打包清单正确；实际部署文件与源码 SHA-256/版本一致。
- [ ] Host 修改重启 DSH，Client 按真实构建/HMR能力刷新，不启动新服务器冒充原页面更新。
- [ ] 在现用 DSH URL 验证界面、操作、失败/恢复入口；未实机验证明确说明。
- [ ] 顺序证据：非流式转写产物→纪要文件→知识库确认；重启不串会、不重复入库。
- [ ] 报告 commit、部署目录、执行命令、未验证限制与是否还需用户重启。

不通过就保留失败证据继续修；规则文档不能替代实现验证。

---

## 🙏 参考与致谢

宿主是 [DeepSeek Harness](https://github.com/deepseek-ai/dsh)，插件模型来自
[cordis](https://github.com/deepseek-ai/cordis)。

四个直接参考过的插件：

| 项目 | 借了什么 |
|---|---|
| [sibetlyf/dsh-knowledge](https://github.com/sibetlyf/dsh-knowledge) | 写知识库走它的本地管理 API 与同源身份 |
| [sibetlyf/dsh-plugin-gateway](https://github.com/sibetlyf/dsh-plugin-gateway) | 宿主内建会话：`sessionController` 的 create/prompt 与 `session/event`。没有它，分会话只能起子进程，界面上看不见 |
| [yuhui-sama/dsh-agentsoul](https://github.com/yuhui-sama/dsh-agentsoul) | 四层人格文件、记忆蒸馏的三分类、只补种子不覆盖 |
| [AK-blank/dsh-plugin-auto-answer](https://github.com/AK-blank/dsh-plugin-auto-answer) | 超时按推荐项应答的思路；这里补了人工优先与多种选项形状 |

云与本地：[阿里云百炼](https://help.aliyun.com/zh/model-studio/)（识别/合成）、
[火山 Ark](https://www.volcengine.com/product/ark)（判断/纠错）、
[VB-CABLE](https://vb-audio.com/Cable/)、[whisper.cpp](https://github.com/ggerganov/whisper.cpp)（可选本地识别）、
[OpenCC](https://github.com/BYVoid/OpenCC)（繁简字符表）、系统 WASAPI 与 UIAutomation。

"记忆会呼吸 / 信念会进化 / 情绪成地形"这套提法来自需求方，这里只是把它落成了可计算的东西。

腾讯会议、飞书、钉钉、Zoom、Teams 的商标归各自所有者，本项目与这些公司没有关联。
用于会议录音转录时，请自行确认符合所在组织的合规要求。

MIT。第三方各自遵循其许可：DSH / cordis 为 Apache-2.0 系，whisper.cpp 为 MIT，OpenCC 为 Apache-2.0，
VB-CABLE 为捐赠版免费（商用看其条款）。
