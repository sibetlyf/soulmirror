# 说话人识别与录入：方案（参考 OpenASR）

> 目标：会议结束后的纪要不出现「说话人1/2」，能认出「这是谁在说」，
> 并且允许用户把自己的声音录进去，以后自动带上名字。
>
> 参考项目：[QuintinShaw/openasr](https://github.com/QuintinShaw/openasr)（Apache-2.0）。
> 本文只总结它**怎么把声纹和 ASR 结合**，以及 SoulMirror 该怎么落。

---

## 一、OpenASR 的做法（读代码后的结论）

它的目录结构已经把答案写清楚了：`crates/openasr-core/src/diarize/`
分成 `vad/`、`segment/`、`embed/`、`vbx/`、`voice_id/`，外加 `attribution.rs`。

### 1）核心思想：说话人不是 ASR 的一部分，是 ASR 外面的独立阶段

`diarize/mod.rs` 开头就写明：VAD 与说话人分析是"模型无关的前后处理阶段"，
围绕任意 ASR 执行器，只通过**时间区间**交流，ASR 内核 `GgmlAsrExecutor` 从不被改动。

`contract.rs` 定义了几何语言：

- `TimeRange { start_s, end_s }`
- `SpeechSegment`（VAD 找到的语音段）
- `SpeakerId(u32)` → 渲染成 `SPEAKER_01`，**故意不带身份**，也不跨录音稳定（隐私设计）
- `SpeakerTurn { range, speaker, overlap }`
- `SpeakerTimeline { turns, centroids }`

一句话：**谁在说话 = 一串区间；说了什么 = ASR 的文本；两者靠时间对齐合并**。
所以换 ASR 模型不影响说话人，换声纹模型也不影响转写。

### 2）五个阶段

```
音频 ──VAD──▶ 语音区间 ──分割模型──▶ 说话人边界 ──声纹嵌入──▶ 向量
     ──聚类(VBx)──▶ 匿名簇 SPEAKER_01..NN ──对齐──▶ 每段文字挂说话人
                                    └─voice_id 匹配──▶ 把 SPEAKER_01 换成"张三"
```

- **VAD**：FireRedVAD 流式 VAD（纯 Rust）。
- **分割**：pyannote 说话人分割（可选包），产出 `SpeakerTurn`。
- **声纹嵌入**：ReDimNet2-B6 为默认，WeSpeaker ResNet 为并行家族（256 维，
  `SpeakerEmbedding::l2_normalized` 由调用方做 L2 归一化）。
- **聚类**：VBx（PLDA），只在 `WeSpeakerResNet && dim==256` 时启用社区版 PLDA。
- **对齐（attribution.rs）**：把每个 ASR 段落按"与哪些 turn 重叠最多"分配给说话人；
  一段里跨了多个说话人时，**必须靠词级时间锚点切分**，锚点不可靠就 fail closed，
  绝不"按整段多数票"硬判——因为那会张冠李戴。

### 3）声纹录入（enrollment）

`diarize/enrollment.rs` 与 `diarize/voice_id/`：

- 一个人 = 一组样本（`enroll_person_from_clips`），可以后续加样本、删样本、改名字、撤销同意。
- **质量的单位不是"一个 turn"，而是固定窗口**（`evidence.rs` 开头长注释）：
  用一个 30 秒的 turn 去算向量，会把两个人的声音混在一起，而段落级质量指标看不出来；
  所以切成固定窗口（论文常用 1.5s/0.75s/1.44s），过滤到只剩一个声音，再平均。
- 每个标签最多取 `MAX_WINDOWS_PER_LABEL` 个窗口，避免长会议样本无限膨胀。
- 注册样本有最低语音时长：`MIN_CONTINUOUS_SPEECH_SECONDS` 等门槛（`quality.rs`：
  注册要 10 秒，因为识别侧只要求 8 秒——真实语音永远不如读稿干净）。

### 4）识别与"敢不敢说出名字"

`voice_id/matcher.rs` + `identity.rs` 的门槛（都是**双条件**，宁可不报）：

| 常量 | 值 | 作用 |
|---|---|---|
| `DEFAULT_MATCH_SIMILARITY` | 0.65 | 低于此不认 |
| 第二名 margin | ~0.08 | 第一名与第二名太接近就不认（避免认错人） |
| `MIN_NAMING_EVIDENCE_SECONDS` | 3.0 | 证据少于 3 秒不给名字 |
| `PROFILE_ANCHOR_SIMILARITY` | 0.85 | 实时里用高门槛做锚点 |
| `NEW_SPEAKER_MAX_EXISTING_SIMILARITY` | 0.50 | 与所有已知簇都低才敢开新簇 |

设计上还有两点很值得抄：

- **匿名标签与姓名是两件事**：转写里先写 `SPEAKER_01`，匹配成功才把显示名换掉，
  原标签保留在 `speaker_label` 里。失败时报告"为什么没认出来"（证据不足/分数不够/margin 不够），
  而不是笼统一句"未知"。
- **不猜**：`attribution.rs` 在锚点不可靠时直接失败，`identity` 在证据不足时保留匿名标签。

### 5）实时路径

`streaming.rs`：用变更点检测 + 余弦重用（`DEFAULT_REUSE_SIMILARITY`），
短句只能挂到"已经足够强的簇"上，不能创建新簇；变更点检测有延迟，
所以出现"文字被记到上一个说话人"时会用词级切分**回溯改判**
（`attribution.rs` 的 `word_snapped_tail_split`）。

---

## 二、SoulMirror 的现状与差距

| 能力 | 现状 | 差距 |
|---|---|---|
| 会后分人 | 已有：DashScope 录音文件识别 + 说话人分离，产出 `speaker` 字段 | 只有匿名编号，没有姓名 |
| 实时分人 | 没有（`speakerDiarization: false`） | 实时只能靠句式/内容判断 |
| 声纹库 | **没有** | 需要"录入 → 存 → 比对"三件事 |
| 姓名映射 | 只能手写配置 | 需要界面 + 持久化 |
| 纪要去标签 | 已做：`lib/minutes-format.js` 剥掉"说话人N" | 认不出名字时只能写角色，无法写具体人名 |

关键约束（决定方案形态）：

1. 插件是 Node/Cordis 插件，**不引入重型原生依赖**（现有只有 `mbridge.exe`）。
2. 语音识别已经在云端（DashScope），离线重转写已经带分人。
3. 声纹**是生物识别数据**：必须本地存、可删除、有同意动作，不能悄悄上传。

---

## 三、方案：三层，先可用再准确

### 第 1 层：说话人名册（不需要声纹，最快落地）

会后拿到 `transcript-offline.jsonl`（已有 `speaker` 编号），在面板上列出每个匿名标签：

```
SPEAKER_01   3 分 12 秒   45 句   [试听]  [这是：____ ▼]  [以后都记住]
SPEAKER_02   11 分 4 秒   120 句  [试听]  [这是：____ ▼]
```

- 用户填一次名字，写入 `speaker-map.json`（按会议 key + 标签）。
- 同一场会重新整理时直接用；**跨会议**暂不推断（没有声纹就没资格推断）。
- 纪要里就不再是"说话人1"，而是"李亚峰"或"与会人员"。

这一层不需要任何模型，今天就能做，价值也最大：至少纪要不难看。

### 第 2 层：声纹录入与 1:N 识别（核心）

参照 OpenASR 的分层，但把"嵌入模型"放到合适的位置：

```
注册：用户录 10~20 秒（或从历史会议里选一段自己的发言）
      → 切 1.5s 窗口 → 过滤纯净窗口 → 平均 → L2 归一化 → 存向量
识别：会后每个匿名簇 → 同样取窗口 → 与库中每个人算余弦
      → 分数 ≥ 0.65 且比第二名高 ≥ 0.08 才给名字
      → 否则保留匿名标签，并说明"证据不足 / 分数不够 / 太接近"
```

- **向量存哪**：`<dataDir>/speakers/<personId>.json`，只存向量与名字，
  音频样本默认不保留（保留需显式勾选，可随时删除）。
- **嵌入模型从哪来**：这是唯一需要调研确认的点，三个选项按优先级：
  1. **DashScope/阿里智能语音的声纹接口**（若开放 1:N）：最省事，不引入本地模型，
     但要把"每场会的簇音频"上传——等于把会议音频传给云，必须默认关闭、显式同意。
  2. **本地小模型（sherpa-onnx / 3D-Speaker CAM++ 的 ONNX）**：几十 MB，
     可以随插件分发或首次使用时下载；纯 CPU 推理，1.5s 窗口足够快。
     代价是引入 onnxruntime 依赖（可以用 `onnxruntime-node` 或 WASM）。
  3. **复用已经装了的 `mbridge.exe`** 加一个 C# 侧的小模型推理：可行但要自己写
     特征提取（fbank）+ 前向，工程量最大，不推荐第一版做。
- **门槛直接照搬 OpenASR 的数值**（0.65 / margin 0.08 / 3 秒证据 / 0.85 锚点），
  这些是被 AliMeeting 评测校准过的，先用再调。

### 第 3 层：实时分人（可选，最后做）

实时拿不到云端分人结果，只能做"局部变更点 + 余弦重用"：

- 每 2.5 秒一次的滑动窗口算向量，与当前簇比较，低于重用门槛就开新簇；
- 短句只能挂到已有簇，不能开新簇（OpenASR 的 `MIN_NEW_SPEAKER_DURATION_S`）；
- 变更点有延迟，所以落地后用词级时间戳回溯改判——**没有词级时间戳就不要硬改**，
  宁可晚一点，也不要张冠李戴。

---

## 四、落地顺序与验收

| 阶段 | 内容 | 验收 |
|---|---|---|
| P1 | 说话人名册 + 面板映射 + 纪要写真实姓名 | 同一场会：填名字后纪要里出现姓名；重新整理保持 |
| P2 | 声纹录入（录 10~20 秒）+ 本地存向量 + 1:N 识别 | 两个已知人、一个陌生人：3 个簇，2 个认对，陌生人保留匿名且给出原因 |
| P3 | 跨会议自动带名字 + 误认保护 | 相似嗓音/同一个人换设备，误认率不为 0 时必须有 margin 拒绝 |
| P4 | 实时分人 | 会中界面显示说话人变化，且不阻碍转写 |

每一步都遵守现有开发规程：状态先落盘、失败要可见、不猜、不把未确认的当成功。

---

## 五、需要先确认的三件事

1. **云端声纹接口**：DashScope 是否提供 1:N 声纹识别/注册（还是只有分人）。
   若不提供，就走本地 ONNX 小模型（方案第 2 层选项 2）。
2. **数据的边界**：声纹是生物识别数据。默认本地、默认不保留音频、
   录入必须有明确同意提示、支持一键删除；这些都写进设置页说明。
3. **说话人数量上限**：现有离线分人上限受服务端限制（DashScope 通常 2~8），
   超过就要在界面说清"这场会检测到 N 个声音，超过上限的可能被合并"。

---

## 附录 A：OpenASR Voice ID 的完整数据通路（代码级，供实现时对照）

### A1. 库里到底有什么

- **位置**：`$OPENASR_HOME/diarize/voice-id.db`（可用 `OPENASR_VOICE_ID_DB` 覆盖），SQLite + WAL。
- **写入**：每次变更在 `BEGIN IMMEDIATE` 事务里，schema 版本 `VOICE_ID_SCHEMA_VERSION = 1`。
- **隐私**：`voice_id/mod.rs` 第一句就是 "Raw audio is never retained."——只存向量、
  质量分、同意记录与采集上下文；原始音频用完即弃。

表（`store.rs`）：

| 表 | 存什么 | 关键点 |
|---|---|---|
| `persons` | person_id / 显示名 / 状态 / revision / 颜色 | 显示名只是展示元数据，**不参与分组或 margin 判定** |
| `enrollment_samples` | 每段注册音频的 consent / quality / context JSON | 一个样本可以来自不同设备/环境 |
| `embedding_spaces` | 空间的完整定义（模型、前端、校准、策略版本） | 见 A3 |
| `sample_embeddings` | 样本在所有空间下的向量（BLOB + 维度） | 主键 (sample_id, space_id)，**换模型不丢旧向量** |
| `prototypes` / `prototype_members` | 可重建索引：每个原型是一份真实样本当 medoid | 成员带质量权重 |
| `person_tombstones` | 删除/撤回的设备级墓碑 | 影响幂等与历史 |
| `voice_id_idempotency` | 注册/改名的幂等键（24h TTL） | 网络重试不会建出两个人 |

### A2. 建库：从录音到"可匹配的原型"

1. `assess_enrollment_quality(samples)`（`quality.rs`）：
   `MIN_SAMPLE_SPEECH_SECONDS = 10.0`、`TARGET_SAMPLE_SPEECH_SECONDS = 12.0`。
   含义：注册时至少要有 10 秒**有效语音**，推荐 12 秒。为什么注册门槛高于识别门槛
   （识别只要 3 秒）：真实说话的干净程度永远不如"对着麦克风读一段"，
   否则注册完第一次识别就失败。
2. 打分：`SampleQuality::weight()` = 语音时长 35% + SNR 25% + 削波 20% + VAD 覆盖 20%，
   落在 [0.05, 1.0]。这个权重后面既用于聚类，也用于匹配时的支持加分。
3. 算向量：默认 ReDimNet2-B6（256 维），WeSpeaker ResNet 是并行家族；
   调用方负责 L2 归一化（`SpeakerEmbedding::l2_normalized`）。
4. 建原型（`prototypes.rs`，可随时从样本重建）：
   - 在**同一个 space 内**做单链接聚类，余弦距离阈值 `DEFAULT_CLUSTER_COSINE_DISTANCE = 0.35`；
   - 每个簇取 **medoid = 真实样本**（使得到其他成员的质量加权平均距离最小），
     **不是**把向量平均——均值向量可能不对应任何真实声音；
   - 每人每空间最多 `MAX_PROTOTYPES_PER_PERSON = 3` 个原型，按
     "质量加权和 + medoid 质量 + 0.05×成员数" 排序保留。

### A3. 为什么必须有 Embedding Space

`space.rs` 的 `EmbeddingSpace` 由 6 个字段决定 `space_id`：
维度、模型包指纹、模型家族/id/版本、前端（fbank）版本、校准版本、匹配策略版本。

> 两个向量只有在 `space_id` 相等时才可比。**维度相同也不算可比。**

没有完整来源信息的 v1 旧档案会被标成 `legacy-unverifiable-v1`，
`is_matchable()` 直接为 false——宁可不用，也不拿不可比的向量去认人。

### A4. 转写时：声纹在哪一步接进 ASR

调用点在 `api/backend/native_transcribe.rs` 的 `compute_speaker_attribution`：

```
音频 ─VAD─▶ 语音段
     ─ExternalDiarizer─▶ SpeakerTimeline{turns, centroids}   ← 匿名 SPEAKER_01..
     ─attribution::assign_speakers─▶ 每段文字挂到 turn 上      ← 文字与时间对齐
     ─voice_id::resolve_timeline_identities─▶ assignments     ← 只有开了"认人"才走这一步
```

**关键开关**：`name_enrolled == false` 时这个函数**直接返回空 identities，
根本不去打开 person store**（注释写明 "never opens the operator person store"）。
不是"打开了但不用"——是连库都不碰。

#### 证据窗口（`evidence.rs`）

| 常量 | 值 | 含义 |
|---|---|---|
| `WINDOW_SECONDS` | 2.0 | 每个证据窗口长度 |
| `WINDOW_STEP_SECONDS` | 1.0 | 窗口步进（相邻窗口重叠一半） |
| `SEGMENT_EDGE_TRIM_SECONDS` | 0.5 | 每个 turn 首尾各修剪 0.5 秒 |
| `MAX_WINDOWS_PER_LABEL` | 20 | 每个说话人最多取 20 个窗口 |
| `MIN_PURITY_VERDICT_WINDOWS` | 5 | 少于 5 个窗口就不做"是不是两个人"的判定 |

三条规矩：
1. 窗口只在"分割结果说这里只有一个人在说"的地方取；与别的标签重叠的窗口直接不要。
2. 窗口按 **turn** 规划，不按句子的切分规划——句子怎么断不能改变一个人被记多少证据。
3. 首尾各修 0.5 秒：说话人切换的头尾最容易被前一个人污染。

#### 纯化：为什么还要做一次两簇切分

`evidence.rs` 开头有实测记录：一个 30.69 秒、听着很流畅的 turn，
实际是两个人（前 8 秒是 A，之后是 B），而所有**段落级**质量指标都说它"优秀"。
把整段丢给嵌入模型，得到的向量就是两个人混合。

所以：切窗口 + 对窗口做二簇切分 + **丢掉少数簇**。
效果（三个 AliMeeting 会场，最近的不同说话人质心相似度）：

| 会场 | 整段为单位 | 窗口 + 保留主簇 |
|---|---|---|
| R8003_M8001 | 0.235 | **0.554** |
| R8001_M8004 | 0.271 | **0.465** |
| R8007_M8010 | 0.324 | **0.462** |

阈值 0.45：整段方案全部低于阈值（两个人被合成一个），窗口方案全部高于。

还要注意它怎么防止"两个判断互相污染"：
- **主簇只负责质心质量**；
- **两簇判定只决定"能不能给名字"**；
- 即使判定说"混合"，主簇仍然可以用来拼接与匹配；判定错了也不会毒化质心。

#### 匹配打分（`matcher.rs` + `prototypes.rs`）

```
person.score = max over prototypes( score_prototype )
score_prototype = medoid 与 query 的余弦
                + support_bonus
support_bonus   = clamp( (top2 成员的 余弦×质量权重 之和) × 0.08, 0, 0.06 )
```

- support bonus 只加一点点（最多 0.06），防止"同一个人传了一堆重复样本"靠数量压过真实匹配。
- 然后两道门槛（校准值，`calibration.rs` 的 ReDimNet2 档案）：
  - `enrollment_default_match_similarity = 0.60`（旧常量 0.65 是保守回退值）
  - `enrollment_match_margin = 0.15`（第一名必须比第二名高 0.15）
- 任一不满足 → 返回 None，**并且记下拒绝原因**。

#### 拒绝原因（`naming.rs`，会进 JSON）

| kind | 含义 | 带上什么数字 |
|---|---|---|
| `embedder-unavailable` | 声纹模型没装（故障，不是判断） | — |
| `not-enough-speech` | 证据太少 | windows / required_windows / seconds / required_seconds / **required_continuous_seconds** |
| `mixed-voices` | 这段标签底下其实是两个人 | windows / seconds |
| `no-match-in-library` | 证据够了但库里没有（或不够像） | library_empty / best_score / accept_threshold |

注释里特别指出：给用户看的应该是 `required_continuous_seconds`（引擎按窗口几何算出来的
"一句连续说多久才够"），而不是 `required_seconds`——后者是较小、非约束性的门槛，
照它去补，下一次还会失败。**UI 不许自己从门槛反推出这句话。**

### A5. 名字怎么回到转写里

`domain.rs` 的 `VoiceIdAssignment` 与 `enrollment.rs` 的 `SpeakerDisplayAssignment`：

| 字段 | 内容 |
|---|---|
| `speaker` | 匹配成功 → 显示名；失败 → 匿名标签 |
| `speaker_label` | 永远保留会话内匿名 `SPEAKER_NN` |
| `speaker_person_id` | 稳定的人 id（改名不影响历史） |
| `speaker_snapshot_label` | 匹配当时的显示名，冻结进历史 |

好处：删掉/改名一个人以后，旧转写仍能安全渲染；
界面也能显示"这是张三（当时叫张三）"，而不会因为改名把历史改掉。

### A6. 隐私与生命周期

- `PersonStatus::{Active, ConsentRevoked, Deleted}`，只有 `Active` 才 `allows_matching()`。
- 每个样本都带 `ConsentRecord{granted_at, notice_version, capture_method}`：
  同意是有版本、有时间的记录，不是一次点击。
- 删除/撤回写 `person_tombstones`，配合幂等键避免"删了又被重试建回来"。
- 原始音频不落盘，所以"泄露声纹库"的最坏后果是泄露向量，不是泄露录音。

### A7. 实时路径的差别（`streaming.rs`）

| 常量 | 值 | 作用 |
|---|---|---|
| `DEFAULT_MATCH_SIMILARITY` | 0.65 | 复用已有说话人的余弦下限 |
| `MIN_NEW_SPEAKER_DURATION_S` | 2.5 | 少于 2.5 秒不许开新说话人 |
| `MIN_CENTROID_UPDATE_DURATION_S` | 1.0 | 太短的 turn 可以贴标签，但不更新质心 |
| `PROFILE_ANCHOR_SIMILARITY` | 0.85（校准后 0.80） | 用已注册的人做锚点，门槛更高 |
| `NEW_SPEAKER_MAX_EXISTING_SIMILARITY` | 0.50 | 与所有已知簇都低于此才敢开新簇 |

实时没有"整段重算"的机会，所以用变更点检测 + 余弦重用；
变更点检测有窗口延迟，会把新说话人的开头几句记到上一个人名下——
它用词级时间戳做**回溯改判**（`attribution.rs` 的 `word_snapped_tail_split`）。
没有可靠词级时间戳时就不改，宁可晚一点也不张冠李戴。

---

## 附录 B：如果 SoulMirror 要照这套做，落到我们代码上是什么样

### B1. 我们缺的只有"嵌入"这一层

| OpenASR | SoulMirror 现状 | 需要补的 |
|---|---|---|
| VAD + 分割 → turns | DashScope 录音文件识别已给分人 + 时间 | 无（离线） |
| 嵌入（本地 ggml 模型） | 无 | 选一个嵌入来源（本地 ONNX 或云端声纹） |
| VBx 聚类 | DashScope 已聚好 | 无 |
| attribution（文字挂 turn） | DashScope 输出segment 已带 speaker | 无 |
| Voice ID（向量 → 人） | 无 | 本地声纹库 + 匹配 |

也就是说：**只差"从音频片段算向量"和"库+匹配"两块**，其余都能复用。

### B2. 我们已有的两块积木

1. `lib/offline-audio.js` 的 `extractRangeToWav({src,dst,startSec,endSec})`：
   可以按 turn 的起止时间从整场 WAV 里切出任意片段——**这正是证据窗口需要的操作**，
   不用新写音频处理。
2. Node ≥22 自带 `node:sqlite`（实验 API）：可以用它做和 OpenASR 一样的
   SQLite + 事务存储，**不必引入原生依赖**（比 onnxruntime 轻得多）。

### B3. 建议的表结构（简化版，字段名对齐 OpenASR 便于对照）

```sql
persons(person_id TEXT PK, display_name TEXT, status TEXT, created_at, updated_at, revision INT)
enrollment_samples(sample_id TEXT PK, person_id TEXT, created_at, consent_json, quality_json, context_json)
embedding_spaces(space_id TEXT PK, dimension INT, model_id TEXT, model_version TEXT, frontend_version TEXT, matcher_policy TEXT)
sample_embeddings(sample_id TEXT, space_id TEXT, blob BLOB, dim INT, PRIMARY KEY(sample_id, space_id))
prototypes(prototype_id TEXT PK, person_id TEXT, space_id TEXT, medoid_sample_id TEXT, medoid_blob BLOB)
prototype_members(prototype_id TEXT, sample_id TEXT, quality_weight REAL)
```

- 每人最多 3 个原型、medoid 用真实样本、质量权重公式照抄；
- 空间 id = 模型 id + 版本 + 前端 + 匹配策略（换模型必须新空间，旧向量留着但不参与匹配）。

### B4. 匹配与写回的伪代码

```js
// 会后：对每个 DashScope 说话人簇
for (const [label, turns] of groupBySpeaker(offlineLines)) {
  const windows = planWindows(turns)            // 2.0s/1.0s/修 0.5s/≤20 个/不跨别人
  if (windows.length < 5) → 拒绝 'not-enough-speech'
  const embs = await embedWindows(wav, windows)  // extractRangeToWav + 模型
  const main = keepMainCluster(embs)             // 二簇切分，丢少数簇
  if (main.length < 5) → 拒绝 'mixed-voices'
  const centroid = l2normalize(mean(main))
  const best = matchPersons(centroid)            // medoid 余弦 + support bonus
  if (!best || best.score < 0.60 || best.score - best.runnerUp < 0.15)
    → 拒绝 'no-match-in-library'，带上 best_score
  else → 给这组句子写 speakerName = person.displayName，并保留 speakerLabel
}
```

拒绝原因要一路带到界面（抄 `JsonUnnamedSpeaker` 的字段）：
`{label, reason, windows, required_windows, seconds, required_seconds, required_continuous_seconds, library_empty, best_score, accept_threshold}`。

### B5. 验收（照 OpenASR 的教训设计）

1. **两个人 + 一个陌生人**：3 个簇，2 个认出名字，陌生人保留匿名且原因是
   `no-match-in-library`（带 best_score），不是笼统"未知"。
2. **同一人换设备录**：应仍然认出（如果认不出，说明阈值/前端需要按我们的麦克风重校）。
3. **一个人连续说 2 秒就停**：应报 `not-enough-speech` 并给出
   `required_continuous_seconds`，而不是给出错误的名字。
4. **删掉某人**：他的旧纪要仍能显示当时的名字（snapshot），新会议不再认他。
5. **换嵌入模型版本**：旧向量不可用于匹配，界面要说明"需要重新录入"而不是静默失配。

### B6. 与 OpenASR 的两处必然不同（别照抄）

1. **嵌入来自哪**：他们是本地 ggml 模型；我们要么本地 ONNX，
   要么云端声纹接口（此时 `space_id` 要包含供应商与模型版本，且必须显式同意上传）。
2. **分人上限**：他们的聚类自己算，可到 15 人（`MAX_DIARIZATION_SPEAKERS = 15`）；
   我们的离线分人受 DashScope 服务端限制（通常 2~8），
   超过上限时必须明确告诉用户"可能被合并"，不能假装分开了。
