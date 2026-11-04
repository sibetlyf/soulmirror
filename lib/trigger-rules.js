/**
 * 「这句是不是在等我回应」的判别。
 *
 * 为什么单独做一套：原来只用「名字 + 问号」两个条件，
 * 实测两样都不可靠——
 *   - 语音识别会把名字认错（李亚峰 → 杨峰 / 严峰）
 *   - 口语很少带问号（"回我一下。" 看起来是陈述句）
 * 结果就是人在叫它，它一动不动。
 *
 * 这里改成三类线索叠加，任何一类命中就算候选句：
 *   称谓 / 疑问语气 / 祈使请求
 */

/** 叫它的通用称呼（不依赖配置） */
const DEFAULT_ADDRESS = ['助手', '小助手', '会议助手', 'DSH', '人工智能']

/** 疑问语气：中文口语里常不带问号 */
const QUESTION_CUES = [
  '吗', '呢', '怎么样', '对吧', '是不是', '能不能', '可不可以', '有没有',
  '多少', '什么时候', '怎么办', '怎么看', '在不在', '在吗', '听得到', '听到吗',
  '听到', '听得见', '听得清', '对不对', '好不好', '行不行', '可以吗', '有没有在',
]

/** 祈使请求：在要求它做/说点什么 */
const REQUEST_CUES = [
  '回我', '回答', '你说', '讲讲', '说一下', '说说', '确认一下', '帮我看', '帮我查',
  '查一下', '记一下', '记下来', '提醒我', '整理一下', '总结一下',
]

/** 去掉标点与空格，便于比较 */
function normalize(text) {
  return String(text || '').toLowerCase().replace(/[\s，。！？、；：,.!?;:""''（）()]/g, '')
}

/**
 * 名字的鲁棒匹配：允许识别错一个字。
 * 规则：去标点后，只要句子包含名字的**任意连续 2 字**，或名字去掉姓之后的尾部，
 * 就认为可能在叫它。宁可多判一次（有冷却），也不要叫了不应。
 */
export function hitsName(text, names = []) {
  const t = normalize(text)
  if (!t) return ''
  for (const raw of names) {
    const name = normalize(raw)
    if (!name) continue
    if (t.includes(name)) return raw
    if (name.length >= 2) {
      // 尾部 2 字：李亚峰 → 亚峰；能覆盖"杨峰/严峰"这类首字识别错的情况
      const tail = name.slice(-2)
      if (tail.length === 2 && t.includes(tail)) return raw
    }
    if (name.length >= 3) {
      // 任意连续 2 字
      for (let i = 0; i + 2 <= name.length; i++) {
        const part = name.slice(i, i + 2)
        if (t.includes(part)) return raw
      }
    }
  }
  return ''
}

/**
 * 判断这句是否需要回应。
 * @returns {{hit: boolean, kind: 'name'|'question'|'request'|'', why: string}}
 */
export function detectTrigger(text, { names = [], extraAddress = [] } = {}) {
  const t = normalize(text)
  if (!t) return { hit: false, kind: '', why: '' }

  const allNames = [...(Array.isArray(names) ? names : []), ...(Array.isArray(extraAddress) ? extraAddress : [])]
  const byName = hitsName(t, allNames)
  // 弱匹配兜底：识别常把姓认错（李亚峰 → 杨峰），末字相同且句子里有疑问/请求线索就算在叫它
  if (!byName) {
    for (const raw of allNames) {
      const name = normalize(raw)
      if (name.length < 2) continue
      const last = name.slice(-1)
      if (!last || !t.includes(last)) continue
      const hasCue = QUESTION_CUES.some((c) => t.includes(normalize(c)))
        || REQUEST_CUES.some((c) => t.includes(normalize(c)))
      if (hasCue) return { hit: true, kind: 'name', why: '疑似叫「' + raw + '」（识别可能错字）' }
    }
  }
  if (byName) return { hit: true, kind: 'name', why: '叫到「' + byName + '」' }

  for (const word of DEFAULT_ADDRESS) {
    if (t.includes(normalize(word))) return { hit: true, kind: 'name', why: '称呼「' + word + '」' }
  }

  for (const cue of QUESTION_CUES) {
    if (t.includes(normalize(cue))) return { hit: true, kind: 'question', why: '疑问语气「' + cue + '」' }
  }

  for (const cue of REQUEST_CUES) {
    if (t.includes(normalize(cue))) return { hit: true, kind: 'request', why: '请求「' + cue + '」' }
  }

  return { hit: false, kind: '', why: '' }
}
