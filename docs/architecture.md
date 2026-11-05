# 架构

分层、会话身份、目录结构。

## 🧵 会话与会议身份

一场会议对应一条 DSH 会话，会话会在界面里出现，端侧能翻每一轮模型输出。

判定"同一场会"的顺序：显式会议号 → 窗口标题里的会议号 → 窗口标题 → 时间戳。
映射存在 `~/.dsh/soulmirror/sessions.json`，所以中途退出再进、甚至重启 DSH，
只要身份一样就续上原来那条会话。

```
soul_session { setMeetingId: "206-275-219" }
```

腾讯会议把会议号画在画布上，读不到标题里，所以自动识别会扫窗口控件文本、再退回剪贴板；
实在没有就手填一次，之后记住。

---

## 📁 目录

```
~/.dsh/soulmirror/
├── config.json
├── persona/{SOUL,IDENTITY,USER,STATE}.md   改完即时生效
├── memory.json                             长期记忆 + 蒸馏结果
├── living/{memory-living,beliefs,emotions}.json
├── sessions.json                           会议身份 → DSH 会话
└── workspace/<会议>/                        每场会一个工作区
```
