/**
 * lib/calibrate-agent.js —— 让 computer-use 去"试"出界面坐标
 *
 * 为什么这么做：会议客户端的首页按钮是自绘的，既没有控件名，也没有稳定坐标。
 * 与其猜，不如让一个有屏幕能力的 agent（copylee/dsh-computer-use）亲手试一遍：
 *  看截图 → 点一下 → 看是否弹出预期窗口 → 记下相对位置 → 存进坐标表
 *
 * 这里的职责很窄：生成一段**边界清晰**的指令，交给宿主起一个会话来执行。
 * 参数不写死在提示里，全部由调用方传入。
 */

/** 校准任务的目标描述（join / quick / schedule …） */
const GOALS = {
  join: {
    label: '加入会议',
    expect: '弹出标题为「加入会议」的窗口（类名含 JoinMeetingDialog）',
    hint: '首页左上区域那排图标里的「加入会议」按钮（带白色加号的蓝色方块）',
  },
  quick: {
    label: '快速会议',
    expect: '直接进入一个会议窗口',
    hint: '首页「快速会议」按钮',
  },
  schedule: {
    label: '预定会议',
    expect: '弹出标题为「预定会议」的窗口',
    hint: '首页「预定会议」按钮',
  },
  share: {
    label: '共享屏幕',
    expect: '弹出共享选择窗口',
    hint: '首页「共享屏幕」按钮',
  },
}

/** 组装给校准 agent 的提示词 */
export function buildCalibrationPrompt({ app, action = 'join', imagePath = '', winSize = null, current = null }) {
  const goal = GOALS[action] || GOALS.join
  const sizeText = winSize && winSize.w ? `${winSize.w}×${winSize.h}` : '（见截图）'

  const lines = []
  lines.push(`任务：给会议客户端「${app}」标定「${goal.label}」按钮的位置，只做这一件事。`)
  lines.push('')
  lines.push('背景：这个客户端的首页是自绘界面，按钮没有控件名，只能按位置点。坐标要存成相对比例，')
  lines.push('插件以后每次入会都用它，所以必须点得准。')
  lines.push('')
  lines.push('可用工具（都在 computer-use 里）：')
  lines.push('- open_application：把客户端切到前台（先做这个）')
  lines.push('- windows list：看当前有哪些窗口，用来判断有没有弹出预期窗口')
  lines.push('- computer screenshot：看屏幕（也可以看本任务附带的截图）')
  lines.push('- computer left_click 带 coordinate：按坐标点')
  lines.push('- ui_elements：读当前窗口的控件树，能读到名字就别用坐标')
  lines.push('')
  lines.push(`要找的按钮：${goal.hint}`)
  lines.push(`点对了的标志：${goal.expect}`)
  if (winSize && winSize.w) lines.push(`目标窗口内容尺寸：${sizeText}（像素坐标要按这个尺寸换算）`)
  lines.push('')
  if (imagePath) {
    lines.push(`已截好一张窗口图：${imagePath}（窗口内容 ${sizeText}）。先看它，确定按钮在图里的像素中心 (px, py)。`)
  }
  if (current && current.x) {
    lines.push(`当前已存的比例是 ${current.x}, ${current.y}，它已经点不开了，别直接沿用。`)
  }
  lines.push('')
  lines.push('做法：')
  lines.push('1. open_application 把客户端叫到前台，确保它停在首页（不是已入会状态）')
  lines.push('2. 看图或截图，读准按钮中心的像素坐标 px, py')
  lines.push(`3. 调用 meeting_set_ui_map { app: "${app}", action: "${action}", px, py, w, h }，w/h 用截图或窗口内容的宽高`)
  lines.push('4. 再调用 meeting_calibrate 复查一次，确认返回的坐标和你算的一致')
  lines.push('')
  lines.push('规矩：')
  lines.push('- 只点这一个按钮。误点「共享屏幕」「预定会议」会真的开功能，必须避免')
  lines.push('- 点错了就关掉误开的窗口（Esc 或点关闭），再重来')
  lines.push('- 不确定就把截图留着，说明你看到什么，不要瞎编坐标')
  lines.push('')
  lines.push('完成后用一句话报告：存下的比例是多少，验证是否通过。')
  return lines.join('\n')
}

/** 让坐标失败时，重新探索的提示（附带上次失败原因） */
export function buildRecalibrationPrompt({ app, action = 'join', reason = '', failures = 0 }) {
  const base = buildCalibrationPrompt({ app, action })
  return [
    `注意：这次是**重新标定**。之前存的坐标连续失败 ${failures} 次${reason ? `（最后一次：${reason}）` : ''}，`,
    '说明客户端界面或窗口尺寸变了，旧比例不可信。',
    '',
    base,
  ].join('\n')
}

/** 单飞 + 冷却：同一软件同一动作短时间内只跑一次校准 */
export class CalibrationRunner {
  constructor({ run, logger, cooldownMs = 10 * 60 * 1000 } = {}) {
    this.run = run
    this.logger = logger
    this.cooldownMs = cooldownMs
    this.running = new Map()
    this.last = new Map()
    this.history = []
  }

  #key(app, action) {
    return `${app}::${action}`
  }

  /** 正在跑吗 */
  busy(app, action) {
    return this.running.has(this.#key(app, action))
  }

  /** 冷却中吗 */
  cooling(app, action) {
    const at = this.last.get(this.#key(app, action)) || 0
    return Date.now() - at < this.cooldownMs
  }

  /**
   * 触发一次校准。返回 { started, skipped, result }
   * 不抛错：校准是后台自愈，失败不能影响主流程。
   */
  async trigger({ app, action = 'join', reason = '', failures = 0, prompt }) {
    const key = this.#key(app, action)
    if (this.running.has(key)) return { started: false, skipped: 'running' }
    if (this.cooling(app, action)) return { started: false, skipped: 'cooldown' }
    if (typeof this.run !== 'function') return { started: false, skipped: 'no-runner' }

    const text = prompt || (failures > 0
      ? buildRecalibrationPrompt({ app, action, reason, failures })
      : buildCalibrationPrompt({ app, action }))

    const job = (async () => {
      const startedAt = Date.now()
      try {
        const out = await this.run(text, { app, action })
        const entry = { app, action, ok: !!(out && out.ok !== false), ms: Date.now() - startedAt, at: new Date().toISOString(), text: String((out && out.text) || '').slice(0, 300) }
        this.history.push(entry)
        if (this.history.length > 20) this.history.shift()
        this.logger?.info?.(`[soulmirror] 标定完成 ${app}/${action}：${entry.ok ? '成功' : '未确认'}（${entry.ms}ms）`)
        return entry
      } catch (e) {
        const entry = { app, action, ok: false, ms: Date.now() - startedAt, at: new Date().toISOString(), error: e.message }
        this.history.push(entry)
        this.logger?.warn?.(`[soulmirror] 标定失败 ${app}/${action}：${e.message}`)
        return entry
      } finally {
        this.last.set(key, Date.now())
        this.running.delete(key)
      }
    })()

    this.running.set(key, job)
    return { started: true, job }
  }
}
