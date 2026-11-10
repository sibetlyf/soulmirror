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

## 6. 发布证据清单
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
