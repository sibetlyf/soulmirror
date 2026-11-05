# 无人值守与自动参会

预约、到点入会、会后自动整理。

## 🌙 无人值守

半夜在跑任务时，DSH 弹一张确认卡片，人不在，这轮就停在那儿。所以拦一下 `approval/request`：
卡片照常弹，你在五秒内点了就用你的答案；五秒没人理，就按推荐项自己选一个，agent 接着干。
没有推荐标记时，审批默认放行一次，问句取第一个选项。

```yaml
autoAnswer: { enabled: true, timeoutMs: 5000 }
```

---

## 🤖 替我参会：预约 + 到点自己进会

「明天三点帮我约个会，然后替我去开」这条链路现在是通的，分两段：

**① 建会**：用腾讯会议官方 API（`dsh-plugin-tencent-meeting` 提供），
返回会议号和入会链接。需要一次性配置 Token（见下）。

**② 到点入会**：交给 DSH 自己的「自动化任务」，不另造定时器。

```
meeting_auto_attend { at: "15:00", url: "https://meeting.tencent.com/dm/xxx", title: "周会", durationMin: 60 }
meeting_schedule_list
meeting_schedule_cancel { id: "..." }
```

它做的是：在指定时间往当前会话投递一条"去入会"的指令 → 会话里的 agent 调 `meeting_join` →
入会后调 `meeting_agent_start` → 采集转写 → 散会出纪要。任务在 DSH 界面「自动化任务」里能看见、能改、能删，
重启也不丢。

为什么用 DSH 的而不是插件自己定时：DSH 的调度是宿主级的、持久化的、界面上可见；
插件自己 `setTimeout` 一旦进程重启就全没了。

前提两条：**DSH 保持运行**、**插件总开关保持开启**。

### 配置腾讯会议 Token（一次就好）

1. 访问 https://meeting.tencent.com/ai-skill 拿个人 Token
2. 装插件：`dsh plugin --profile web install` 后重启 DSH，在「设置 → 腾讯会议凭据」里粘贴（不经过对话）
3. 或启动前设环境变量 `DSH_TENCENT_MEETING_TOKEN`

没有 Token 也能入会——只要有会议号和链接，`meeting_auto_attend` 照样工作；
只有"自动建会"这一步需要它。

---
