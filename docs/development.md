# 开发与测试

测试怎么跑、目录结构、参考致谢。

## 🧪 测试

```
node --test "tests/*.test.mjs"
```

498 例全绿。其中 `sources.test.mjs` 用假信号源 + 假音频 + 假转写跑完整流程，
**不联网、不要桌面、不要会议软件**；`client-render.test.mjs` 会真正执行面板组件，
专抓"未声明变量导致白屏"这类只有渲染才暴露的错。

近期新增的纯逻辑测试（都是"能被单测钉住"的部分，不依赖模型与桌面）：

| 测试 | 钉住什么 |
|---|---|
| `pet-dsh` / `pet-display` | 状态→桌宠档位映射、三路气泡优先级与节流、菜单协议形状、取锁与投喂 |
| `deps-optional` | 可选插件体检、缺插件时的门禁文案、安装参数合法性 |
| `join-guard` | 会议号校验（格式/全 0）、失败分类翻译 |
| `action-items` | 从纪要抽待办：负责人、截止、过去时不误判 |
| `trigger-rules` / `segment-merge` | 叫名/问句/祈使的触发判定、碎片句合并 |
| `reply-candidates` / `advice-trigger` | 候选词形状与去重、建议的自动触发规则 |

---

## ✅ 测试

```
npm test        # 75 个用例
```

覆盖活数据三条曲线、会议身份与复用、人格读写去重、长期记忆与蒸馏、大脑触发与模型决策、
纠错器、宿主内会话驱动（含"旧轮次不提前结算"）、知识库检测与回写、自动应答三种情形、
会议软件识别打分，以及插件整体启动：31 个工具注册、配置 API 不回显密钥、各 `soul_*` 工具读写。

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
