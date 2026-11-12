/**
 * 录声纹时给用户读的一段话。
 *
 * 为什么需要：注册要 MIN_READ_SECONDS 秒有效语音（见 quality.js 的 MIN_SAMPLE_SPEECH_SECONDS）。
 * 对着麦数"一、二、三"很容易只录到几秒，或者越数越紧张、读得含糊；
 * 给一段连贯有趣的小文，人自然就读满十几秒，语气也更接近平时说话，
 * 算出来的向量才更像这个人。
 *
 * 选文规则（写文案时就这么定的，数字都在下面的常量里，这里不写死）：
 *   · 每段的汉字数必须落在 MIN_CHARS..MAX_CHARS 之间：成人自然朗读约 3.5~4.5 字/秒，
 *     正常读一定 ≥ MIN_READ_SECONDS，又不会长到让人等得不耐烦
 *   · estimateSeconds() 的保守估算不得超过 MAX_ESTIMATE_SECONDS（4 字/秒算），
 *     否则界面提示的"约 N 秒"会离谱，用户读一半就想放弃
 *   · 必须是**完整的小段**（小故事 / 冷知识 / 俏皮吐槽 / 生活场景），有画面、有结尾；
 *     不要绕口令、不要生僻字、不要长数字串、不要英文单词——
 *     这些都会让人读错、卡壳，反过来污染声纹
 *   · 文案只放服务端这一份：GET /api/soulmirror/voiceprint 的 readAloud
 *     把它交给前端，客户端不复制一份（两边各存一份必然漂移）
 */
import { MIN_SAMPLE_SPEECH_SECONDS } from './quality.js'

/** 与 quality.js 的注册门槛同一个数（不在这里重复定义门槛数字，避免两处漂移） */
export const MIN_READ_SECONDS = MIN_SAMPLE_SPEECH_SECONDS

/** 每段汉字数的硬下限 / 硬上限（低于下限读不满，高于上限读太久） */
export const MIN_CHARS = 70
export const MAX_CHARS = 100

/** estimateSeconds() 的硬上限：界面提示"约 N 秒"不能超过这个数 */
export const MAX_ESTIMATE_SECONDS = 25

/** 估算用的语速：4 字/秒（自然朗读 3.5~4.5 的中位偏保守，估出来的秒数偏大，不会读不够） */
const CHARS_PER_SECOND = 4

/** 只数汉字：标点、空格、数字都不算"读出来的字" */
export function hanCount(text) {
  const m = String(text || '').match(/[\u4e00-\u9fff]/g)
  return m ? m.length : 0
}

/**
 * 这段读完大概要几秒。
 * 按 CHARS_PER_SECOND 字/秒**保守估算**：宁可多报一秒，也不要让人读到一半发现不够 MIN_READ_SECONDS。
 */
export function estimateSeconds(text) {
  const chars = hanCount(text)
  if (!chars) return 0
  return Math.ceil(chars / CHARS_PER_SECOND)
}

/** 10 段小文（都是连贯完整的小段，不是句子拼盘） */
export const PASSAGES = Object.freeze([
  Object.freeze({
    id: 'rainy-cat',
    text: '下班路上忽然下雨，我没带伞，只好站在便利店门口等。店员搬了把椅子出来，还递给我一杯热水。'
      + '我就坐着看雨水顺着招牌往下滴，看骑手披着雨衣冲过去。十几分钟后雨小了，我买了两瓶酸奶，一瓶留给店员。',
  }),
  Object.freeze({
    id: 'honey-keeps',
    text: '你知道吗，蜂蜜放上一千年也不会坏。考古队真在古墓里挖出过能吃的蜂蜜，因为水分少、糖分高，'
      + '细菌活不下去。不过别拿它去喂一岁的孩子，小宝宝的肠胃受不了。'
      + '柜子里的蜂蜜结成了白晶，别急着扔，它其实还能吃。',
  }),
  Object.freeze({
    id: 'phone-dead',
    text: '早上出门我看了一眼手机，电量只剩一点点，结果刚上地铁就黑屏了。'
      + '这一整天我没法扫码、没法查公交、也没法发消息。奇怪的是，什么都不能做以后，我反而记住了每条街的样子。'
      + '晚上充上电，消息弹出一大片，其实只有三条正事。',
  }),
  Object.freeze({
    id: 'breakfast-boss',
    text: '楼下早餐店的老板记性特别好。我才去过三次，他就记住了我不要香菜、豆浆要少糖。'
      + '有天下雨人少，他一边煎蛋一边说，做这行二十多年，最难的是记住每个人习惯的那点差别。'
      + '我说这太用心了，他笑笑说，你天天来，我得让你觉得值。',
  }),
  Object.freeze({
    id: 'moon-drifting',
    text: '月亮正在慢慢离开地球，每年大约三个厘米，差不多是指甲长那么快。听起来不多，'
      + '可一年年积累下去，很久以后的月亮看起来会比现在小不少，日全食大概也看不成了。'
      + '所以我们这一代挺幸运，抬头就能看到刚刚好的那一眼。',
  }),
  Object.freeze({
    id: 'parcel-mixup',
    text: '我网购了一个书架，物流显示已经放进快递柜。晚上去取，柜门打开只有一个很小的纸盒。'
      + '我举着盒子看半天，以为发错货了。第二天问客服，人家说书架太大，柜子放不下，包裹还在驿站。'
      + '那个小盒子是卖家送的螺丝和说明卡片。',
  }),
  Object.freeze({
    id: 'lift-oranges',
    text: '有一次我抱着两袋东西进电梯，袋子忽然裂了，橘子滚了一地。一位阿姨二话不说弯腰帮我捡，'
      + '边捡边数，说少了一个。到了她那层，她还先帮我把袋子提到门口才走。'
      + '我后来常想起这件事，也想在别人手忙脚乱时弯一下腰。',
  }),
  Object.freeze({
    id: 'update-loop',
    text: '昨晚我打算写完报告就睡，电脑忽然提示要更新，我点了确定，然后它就开始转圈。'
      + '转到一半彻底不动了，屏幕黑着，风扇还在响。我等了半小时，只好关机睡觉。'
      + '第二天打开，更新自己完成了，报告也还在。有些等待真没必要盯着，越盯越急。',
  }),
  Object.freeze({
    id: 'giraffe-sleep',
    text: '长颈鹿脖子那么长，骨头数量却和人类差不多，只是每节都拉得很长。'
      + '它们睡觉时间特别短，一天加起来常常不到两小时，还得站着打盹，因为躺下再爬起来太费力。'
      + '所以动物园里那只站着的长颈鹿，不是在装酷，可能刚打了个盹。',
  }),
  Object.freeze({
    id: 'balcony-mint',
    text: '我在阳台上养了一盆薄荷，起初每天浇水，长得飞快。后来出差一周，回来时叶子全垂下来了，'
      + '只剩底下一小截还绿着。我剪掉枯枝，浇透水，也没抱多大希望。'
      + '结果两周后它又冒出一圈新芽，比之前还密。你给它留一点余地，它自己就找活路。',
  }),
])

/** 单段 → 界面要的字段（字数与秒数都由文本算，不手写死数字） */
export function passageInfo(passage) {
  const text = String((passage && passage.text) || '')
  return {
    id: String((passage && passage.id) || ''),
    text,
    chars: hanCount(text),
    estimateSeconds: estimateSeconds(text),
  }
}

/** 接口下发的整份文案（客户端不复制一份） */
export function listPassages() {
  return PASSAGES.map(passageInfo)
}

/**
 * 随机挑一段。
 *
 * @param {() => number} [rand] 随机函数，默认 Math.random（测试可注入）
 * @returns {{id: string, text: string, chars: number, estimateSeconds: number}}
 *
 * 连续两次不重复：记住上一次的 id 并排除掉。
 * 只排除"上一次"，不做更长的历史——几段轮着看就够了，也不会越用越像固定顺序。
 */
let lastPickId = ''
export function pickPassage(rand) {
  const total = PASSAGES.length
  if (!total) return null
  const r = typeof rand === 'function' ? rand : Math.random
  let value = 0
  try { value = Number(r()) } catch { value = 0 }
  if (!Number.isFinite(value)) value = 0
  // 允许 rand 返回 1 或越界值：夹到 [0, 1) 再取整，不能出现 undefined
  const at = Math.floor(Math.min(0.999999, Math.max(0, value)) * total)
  let passage = PASSAGES[at] || PASSAGES[0]
  if (passage.id === lastPickId) passage = PASSAGES[(at + 1) % total]
  lastPickId = passage.id
  return passageInfo(passage)
}
