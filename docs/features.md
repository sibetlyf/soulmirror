# 能力一览

能做什么、活数据是什么。

## ✨ 能力一览

| | |
|---|---|
| 采集 | WASAPI 环回，只采会议客户端所在设备 |
| 识别 | 百炼 `paraformer-realtime-v2`，中间结果、标点、ITN、顺滑、VAD 断句、时间戳 |
| 纠错 | 每句过一遍同音字纠正，词表来自 `userName` + 唤醒词 + 会议背景 |
| 判断 | 完整上文交给模型，决定要不要接话、要不要干活 |
| 发言 | 切虚拟麦 → 长按空格 → 流式 TTS → 松开 → 切回 |
| 干活 | 起 DSH 任务，结果压成一两句汇报 |
| 沉淀 | 会后写知识库、更新 `USER.md` / `STATE.md` |

---

## 🌿 活数据：参数与工具

哲学在上面，这里只放能调的旋钮。全部在 `lib/living.js`，纯本地 JSON。

| | 半衰期 | 关键阈值 | 文件 |
|---|---|---|---|
| 记忆 | 3 天 | 0.15 沉睡 · 想起 +0.3 | `living/memory-living.json` |
| 信念 | 30 天不强化开始退化 | 0.35 发芽 · 0.6 小树 · 0.85 大树 · 0.02 死亡 | `living/beliefs.json` |
| 情绪 | 1.5 天 | 8×8 网格，主导情绪决定地貌 | `living/emotions.json` |

```
soul_world   { breathe? }    # 看形状；breathe 走一次衰减
soul_belief  { action }      # list / seed / reinforce / weaken / evolve
soul_goal    { action }      # add / list / run
```

`/status` 的 `world` 字段会带回同一份快照，面板和端侧都能看。
