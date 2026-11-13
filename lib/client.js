/**
 * soulmirror 客户端
 * 布局对齐 DSH 自身面板：右侧停靠、无遮罩变暗、44px 头部、12px 圆角、主题 token。
 */
window.__ModuleLoader__.load({
  id: 'soulmirror',
  factory: function (require) {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    var React = require('react')

    exports.name = 'soulmirror-client'
    exports.inject = ['slots']

    // 主题色一律写成 "token, 兜底色"。
    // 实测：这套 DSH 页面里 --dsw-alias-* 不存在（getComputedStyle 全是空串），
    // 单写 var(--x) 的结果是"无效颜色"→ 浏览器退回初始值，按钮变成黑底黑字的方块。
    // 有兜底值后：宿主定义了就用宿主的，没定义就用自己的，永远不会变成黑块。
    var T = {
      bg: 'var(--dsw-alias-bg-layer-1, #ffffff)',
      bg2: 'var(--dsw-alias-bg-layer-2, #f5f6f8)',
      border: 'var(--dsw-alias-border-l1, #e3e6ea)',
      brand: 'var(--dsw-alias-brand-primary, #3b6ef5)',
      brandText: 'var(--dsw-alias-label-inverse, #ffffff)',
      text: 'var(--dsw-alias-label-primary, #1f2329)',
      muted: 'var(--dsw-alias-label-secondary, #6b7280)',
      ok: 'var(--dsw-alias-state-success-primary, #16a34a)',
      warn: 'var(--dsw-alias-state-warn-primary, #d97706)',
      err: 'var(--dsw-alias-state-error-primary, #dc2626)',
      idle: 'var(--dsw-alias-state-idle-primary, #9ca3af)',
    }

    var S = {
      dock: {
        position: 'fixed', top: 0, right: 0, bottom: 0, width: 400, maxWidth: '92vw', zIndex: 9000,
        display: 'flex', flexDirection: 'column',
        background: T.bg, color: T.text,
        borderLeft: '1px solid ' + T.border,
        boxShadow: 'none',
        font: '13px/1.55 var(--dsw-font-family, system-ui), "Microsoft YaHei", sans-serif',
      },
      header: {
        height: 44, flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 8,
        padding: '0 12px', borderBottom: '1px solid ' + T.border,
      },
      title: { fontSize: 13, fontWeight: 600 },
      dot: { width: 6, height: 6, borderRadius: '50%', flex: '0 0 auto' },
      meta: { flex: '0 0 auto', padding: '10px 12px', borderBottom: '1px solid ' + T.border, display: 'flex', flexDirection: 'column', gap: 6 },
      metaRow: { display: 'flex', alignItems: 'center', gap: 6, minHeight: 18 },
      metaLabel: { color: T.muted, fontSize: 11, width: 34, flex: '0 0 auto' },
      metaValue: { fontSize: 12, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
      tag: {
        fontSize: 11, lineHeight: '18px', padding: '0 6px', borderRadius: 4, flex: '0 0 auto',
        color: T.muted, background: T.bg2, border: '1px solid ' + T.border,
      },
      list: { flex: 1, overflowY: 'auto', padding: '2px 12px 12px' },
      row: { display: 'flex', gap: 8, padding: '6px 0', borderBottom: '1px solid ' + T.border, alignItems: 'flex-start' },
      time: { color: T.muted, fontSize: 11, fontVariantNumeric: 'tabular-nums', flex: '0 0 auto', paddingTop: 2, width: 50 },
      speaker: { fontSize: 11, color: T.brand, flex: '0 0 auto', paddingTop: 2, maxWidth: 64, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
      text: { fontSize: 13, flex: 1, lineHeight: 1.5 },
      interim: { color: T.muted, fontStyle: 'italic', fontSize: 12, padding: '6px 0' },
      empty: { color: T.muted, fontSize: 12, textAlign: 'center', padding: '48px 0', lineHeight: 1.8 },
      footer: { flex: '0 0 auto', height: 44, padding: '0 12px', borderTop: '1px solid ' + T.border, display: 'flex', alignItems: 'center', gap: 8 },
      btn: {
        height: 28, padding: '0 10px', fontSize: 12, borderRadius: 6, cursor: 'pointer',
        border: '1px solid ' + T.border, background: T.bg2, color: T.text,
      },
      btnPrimary: {
        height: 28, padding: '0 12px', fontSize: 12, borderRadius: 6, cursor: 'pointer',
        border: '1px solid ' + T.brand, background: T.brand, color: T.brandText, fontWeight: 600,
      },
      iconBtn: {
        width: 28, height: 28, border: 'none', background: 'transparent', color: T.muted,
        cursor: 'pointer', borderRadius: 6, fontSize: 14, lineHeight: 1,
      },
      field: {
        height: 28, flex: 1, minWidth: 0, background: T.bg2, color: T.text, fontSize: 12,
        border: '1px solid ' + T.border, borderRadius: 6, padding: '0 8px', outline: 'none',
      },
      formRow: { display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0' },
      formLabel: { width: 76, color: T.muted, fontSize: 12, flex: '0 0 auto' },
      section: { fontSize: 11, color: T.muted, margin: '12px 0 2px' },
      note: { color: T.muted, fontSize: 11 },
      card: { border: '1px solid ' + T.border, borderRadius: 10, padding: '10px 12px', margin: '8px 0', background: T.bg2 },
      cardTitle: { fontSize: 13, fontWeight: 600, color: T.text },
      muted: { fontSize: 12, color: T.muted, lineHeight: 1.6 },
      warn: { fontSize: 12, color: T.warn, lineHeight: 1.6 },
      rowBetween: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
      btnGhost: { border: '1px solid ' + T.border, background: 'transparent', color: T.muted, borderRadius: 6, padding: '3px 8px', fontSize: 12, cursor: 'pointer' },
      depRow: { marginTop: 8, paddingTop: 8, borderTop: '1px dashed ' + T.border },
      depHead: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 },
      depName: { fontSize: 13, fontWeight: 600, color: T.text },
      cmd: { display: 'flex', alignItems: 'center', gap: 6, margin: '6px 0' },
      cmdCode: { flex: 1, fontFamily: 'ui-monospace, Consolas, monospace', fontSize: 11, color: T.text, background: T.bg, border: '1px solid ' + T.border, borderRadius: 6, padding: '4px 6px', overflowX: 'auto', whiteSpace: 'nowrap' },
    }

    var store = {
      open: false, mode: 'compact', listeners: [],
      set: function (v) { store.open = v; store.listeners.forEach(function (f) { f() }) },
      setMode: function (m) { store.mode = m; store.listeners.forEach(function (f) { f() }) },
    }

    function useStore() {
      var s = React.useState({}), bump = s[1]
      React.useEffect(function () {
        var fn = function () { bump({}) }
        store.listeners.push(fn)
        return function () {
          var i = store.listeners.indexOf(fn)
          if (i >= 0) store.listeners.splice(i, 1)
        }
      }, [])
      return store
    }

    var live = {
      // D1：采集没起来时的即时提示（IssueBanner 会合并展示）。
      // 以前 set 的白名单漏了它，363/365/369 行写进来的话永远到不了界面。
      captureNotice: '',
      // D1b：点了按钮到响应回来之间的反馈（"正在提交操作…"），响应落地即清空。
      commandNotice: '',
      auto: false, armed: false, enabled: false, mode: 'transcribe', state: 'idle', capturing: false, asr: null, lastLlmError: null,
      transcript: [], partial: '', meeting: null, models: null, devices: null, peak: 0, since: null, tasks: [], apps: [], activeApp: '', autoAppSelect: true,
      // 演练状态来自 /status.demo：没有它，"演练中"永远不会显示（以前漏接了这一个字段）
      demo: null,
      listeners: [],
      set: function (v) {
        if (v.view !== undefined) live.view = v.view
        if (v.journal !== undefined) live.journal = v.journal
        if (v.display !== undefined) live.display = v.display
        if (v.pipelineQueue !== undefined) live.pipelineQueue = v.pipelineQueue
        if (v.session !== undefined) live.session = v.session
        if (v.issues !== undefined) live.issues = v.issues
        if (v.postMeeting !== undefined) live.postMeeting = v.postMeeting
        if (v.demo !== undefined) live.demo = v.demo
        if (v.auto !== undefined) live.auto = !!v.auto
        if (v.state !== undefined) live.state = v.state || 'idle'
        if (v.capturing !== undefined) live.capturing = !!v.capturing
        if (v.transcript) live.transcript = v.transcript
        live.partial = v.partial || ''
        if (v.meeting) live.meeting = v.meeting
        if (v.models) live.models = v.models
        if (v.devices) live.devices = v.devices
        live.peak = v.peak || 0
        live.since = v.since || null
        if (v.tasks) live.tasks = v.tasks
        if (v.apps) live.apps = v.apps
        if (v.activeApp !== undefined) live.activeApp = v.activeApp
        if (v.autoAppSelect !== undefined) live.autoAppSelect = v.autoAppSelect
        if (v.armed !== undefined) live.armed = v.armed
        if (v.enabled !== undefined) live.enabled = v.enabled
        if (v.mode !== undefined) live.mode = v.mode
        if (v.asr) live.asr = v.asr
        if (v.lastLlmError !== undefined) live.lastLlmError = v.lastLlmError
        // 白名单必须收下即时提示：漏一个字段 = 界面永远读不到（静默失败）
        if (v.captureNotice !== undefined) live.captureNotice = String(v.captureNotice || '')
        if (v.commandNotice !== undefined) live.commandNotice = String(v.commandNotice || '')
        // 保存位置（/status.storage）：漏收它，界面就只能永远显示"读取中…"
        if (v.storage !== undefined) live.storage = v.storage
        live.notify()
      },
      // 只通知重绘、不动任何字段：callAuto 先直接赋值再 notify，
      // 避免 live.set 顺带把 partial/peak/since 清掉（那条路径会无条件重置）。
      notify: function () { live.listeners.forEach(function (f) { f() }) },
    }

    var liveTimer = null
    var pollingBusy = false
    var pollTick = 0
    function stopPolling() { if (liveTimer) clearInterval(liveTimer); liveTimer = null }
    function ensurePolling() {
      if (liveTimer) return
      liveTimer = setInterval(function () {
        if (pollingBusy || typeof fetch !== 'function') return
        pollingBusy = true
        pollTick += 1
        // 每秒一次轻量轮询（宿主只读桌面探测缓存）；每 10 秒做一次完整探测。
        // 原来的写法每秒都让宿主跑 PowerShell 探测，点开关要等好几秒才见状态。
        var light = pollTick % 10 !== 1
        fetch('/api/soulmirror/status' + (light ? '?light=1' : ''))
          .then(function (r) { return r.ok ? r.json() : null })
          .then(function (j) {
            if (!j) return
            live.set({
              view: j.view, journal: j.journal, display: j.display, pipelineQueue: j.pipelineQueue, session: j.session, issues: j.issues, postMeeting: j.postMeeting,
              // 保存位置（实际生效根 + 是否回退）：面板与设置页都要能读
              storage: j.storage,
              auto: j.auto,
              state: j.lifecycle && j.lifecycle.state,
              capturing: j.session && j.session.capturing,
              asr: j.session && j.session.asr,
              lastLlmError: j.lastLlmError,
              transcript: j.transcript,
              partial: j.partial,
              meeting: j.meeting,
              models: j.models,
              devices: j.devices,
              peak: j.lifecycle && j.lifecycle.lastPeak,
              since: j.lifecycle && j.lifecycle.since,
              tasks: j.tasks,
              apps: j.apps,
              activeApp: j.activeApp,
              autoAppSelect: j.autoAppSelect,
              armed: j.armed,
              enabled: j.enabled,
              mode: j.mode,
              demo: j.demo,
            })
          })
          .catch(function (e) { live.transportError = '状态同步失败：' + e.message })
          .finally(function () { pollingBusy = false })
      }, 1000)
      if (liveTimer.unref) liveTimer.unref()
    }

    /**
     * 当前"正在抓谁"的唯一来源。
     *
     * 之前大页面把「接入」绑 lv.meeting.app（检测结果）、把「抓取」绑 lv.activeApp（手动选择），
     * 两个字段各说各话：同时开着腾讯会议和移动会议时，一处显示腾讯会议、另一处显示移动会议，
     * 侧栏小窗又是另一套。这里收成一个函数，两个面板都问它。
     */
    function pickActiveApp(lv) {
      var manual = String((lv && lv.activeApp) || '').trim()
      var detected = String((lv && lv.meeting && lv.meeting.app) || '').trim()
      var name = manual || detected
      return {
        name: name || '—',
        source: manual ? '手动' : (detected ? '自动' : '未识别'),
        manual: !!manual,
        detected: detected,
      }
    }

    /**
     * 共享配置 store。
     *
     * 为什么需要：大页面、设置向导、设备选择卡原来各自 fetch 一份 /config，
     * 各存各的 React state —— 在一个页面改了设置，另一个页面看不到（要刷新才同步），
     * 看起来就像"大小页面不是同一个配置"。
     *
     * 现在只有一份数据 + 一组订阅者：任何一处保存后 set(newCfg)，
     * 所有用到配置的组件立刻一起更新。
     */
    var cfgStore = {
      data: null,
      loading: false,
      error: '',
      listeners: [],
      set: function (data) {
        cfgStore.data = data || null
        cfgStore.error = ''
        cfgStore.emit()
      },
      patch: function (partial) {
        cfgStore.data = Object.assign({}, cfgStore.data || {}, partial || {})
        cfgStore.emit()
      },
      emit: function () {
        var list = cfgStore.listeners.slice()
        for (var i = 0; i < list.length; i++) {
          try { list[i](cfgStore.data) } catch { /* ignore */ }
        }
      },
      // 必须**永远返回 Promise**：调用方写的是 cs.reload().then(...)，
      // 这里任何一条提前 return 都会让整个配置页抛
      // "Cannot read properties of undefined (reading 'then')" 并白屏。
      ensure: function (force) {
        if (typeof fetch !== 'function') return Promise.resolve(cfgStore.data)
        if (cfgStore.loading) return Promise.resolve(cfgStore.data)
        if (cfgStore.data && !force) return Promise.resolve(cfgStore.data)
        cfgStore.loading = true
        return fetch('/api/soulmirror/config')
          .then(function (r) { return r.json() })
          .then(function (c) {
            if (c && c.error) throw new Error(String(c.error))
            cfgStore.data = c || null
            cfgStore.error = ''
            cfgStore.emit()
            return cfgStore.data
          })
          .catch(function (e) {
            cfgStore.error = (e && e.message) || '读取配置失败'
            cfgStore.emit()
            throw e
          })
          .then(function (c) { cfgStore.loading = false; return c }, function (e) { cfgStore.loading = false; throw e })
      },
      subscribe: function (fn) {
        cfgStore.listeners.push(fn)
        return function () {
          var i = cfgStore.listeners.indexOf(fn)
          if (i >= 0) cfgStore.listeners.splice(i, 1)
        }
      },
    }

    /** 订阅共享配置；返回 { data, error, set, patch, reload } */
    function useConfig() {
      var s = React.useState(0), bump = s[1]
      React.useEffect(function () {
        cfgStore.ensure()
        var off = cfgStore.subscribe(function () { bump({}) })
        return off
      }, [])
      return {
        data: cfgStore.data,
        error: cfgStore.error,
        set: cfgStore.set,
        patch: cfgStore.patch,
        reload: function () { return cfgStore.ensure(true) },
      }
    }

    function useLive() {
      var s = React.useState({}), bump = s[1]
      React.useEffect(function () {
        var fn = function () { bump({}) }
        live.listeners.push(fn)
        ensurePolling()
        return function () {
          var i = live.listeners.indexOf(fn)
          if (i >= 0) live.listeners.splice(i, 1)
          if (!live.listeners.length) stopPolling()
        }
      }, [])
      return live
    }

    function switchApp(name) {
      fetch('/api/soulmirror/app', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: name }),
      })
        .then(function (r) { return r.json() })
        .then(function (j) {
          if (j && j.ok) live.set({
            enabled: j.enabled, activeApp: j.activeApp, autoAppSelect: !!j.activeApp ? false : true })
        })
        .catch(function () {})
    }

    function switchMode(mode) {
      fetch('/api/soulmirror/mode', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: mode }),
      })
        .then(function (r) { return r.json() })
        .then(function (j) { if (j && j.ok) live.set({ mode: j.mode }) })
        .catch(function () {})
    }

    function callAuto(action) {
      // 点「开始录音」= 立刻开录（后端 action=record），不是只做"待命"。
      // 以前 start 只 arm，没有会议窗口时什么都不发生 —— 用户反馈"点了没反应"。
      var act = action === 'start' ? 'record' : action
      // 即时反馈：先乐观置位，避免等下一次轮询才变化
      // Never optimistically claim a durable state. The command response is not the log.
      live.commandNotice = '正在提交操作…'
      live.notify()
      fetch('/api/soulmirror/auto', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: act }),
      })
        .then(function (r) { return r.json() })
        .then(function (j) {
          // 响应回来了就先清掉"正在提交操作…"：过程提示不能挂在界面上当成结论
          live.commandNotice = ''
          if (!j) { live.notify(); return }
          live.set({
            enabled: !!j.enabled,
            armed: !!j.armed,
            auto: !!j.auto,
            state: j.lifecycle && j.lifecycle.state,
            capturing: !!j.capturing,
          })
          // 采集没起来就把原因抛到最显眼的地方，而不是静默
          if (act === 'record' && j.enabled && !j.capturing) {
            live.set({ lastLlmError: '' })
            live.set({ captureNotice: j.error || '采集没有启动：可能缺 Key、桥接不可用或设备被占用' })
          } else if (act === 'record') {
            live.set({ captureNotice: '' })
          }
        })
        .catch(function (e) {
          live.commandNotice = ''
          live.set({ captureNotice: '请求失败：' + ((e && e.message) || '') })
        })
    }

    /**
     * 只有用户本来就停在底部时才自动跟随新内容；
     * 一旦往上翻，就不再打断——等他自己滚回底部再继续跟随。
     */
    // 正在说的那一行：逐字出现 + 光标，让"还在识别"这件事看得见
    function TypeLine(props) {
      var h = React.createElement
      var shown = useTypewriter(props.text, true)
      return h('span', { style: S.text }, shown,
        h('span', {
          style: {
            display: 'inline-block', width: 6, marginLeft: 1, color: T.brand,
            animation: 'smCaret 1s steps(1) infinite',
          },
        }, '▌'))
    }

    // 打字机：把"突然冒出一整句"改成"逐字出现"，读起来更跟得上说话节奏
    // 算法与 lib/typewriter.js 同一套（那边有单测）：按字符推进、落后加速、目标变短立即收敛
    var TYPE_CPS = 45
    function useTypewriter(text, active) {
      var target = String(text || '')
      var st = React.useState(0)
      var shown = st[0], setShown = st[1]
      var reduced = false
      try {
        reduced = typeof window !== 'undefined' && window.matchMedia
          ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
          : false
      } catch { reduced = false }

      React.useEffect(function () {
        if (!active || reduced) { setShown(target.length); return }
        // 目标变短（新的中间结果替换旧的）：直接收敛，不倒放
        if (shown > target.length) { setShown(target.length); return }
        if (shown >= target.length) return
        var id = setInterval(function () {
          setShown(function (cur) {
            if (cur >= target.length) return target.length
            var per = Math.max(1, Math.round((TYPE_CPS * 33) / 1000))
            var gap = target.length - cur
            var speedUp = gap > 40 ? 3 : (gap > 15 ? 2 : 1)
            return Math.min(target.length, cur + per * speedUp)
          })
        }, 33)
        return function () { clearInterval(id) }
      }, [target, active, reduced, shown])

      return active && !reduced ? target.slice(0, Math.min(shown, target.length)) : target
    }

    // 会议时长：从入会时间开始按秒走（侧栏顶部显示 00:00 那种）
    function useElapsed(sinceIso, active) {
      var s = React.useState(0)
      var secs = s[0], setSecs = s[1]
      React.useEffect(function () {
        function tick() {
          var start = Date.parse(sinceIso || '')
          setSecs(active && start ? Math.max(0, Math.round((Date.now() - start) / 1000)) : 0)
        }
        tick()
        if (!active) return
        var id = setInterval(tick, 1000)
        return function () { clearInterval(id) }
      }, [sinceIso, active])
      return secs
    }

    function useFollowBottom(count) {
      var elRef = React.useRef(null)
      var stickRef = React.useRef(true)
      React.useEffect(function () {
        var el = elRef.current
        if (!el) return
        if (stickRef.current) el.scrollTop = el.scrollHeight
      }, [count])
      function onScroll(e) {
        var el = e.currentTarget
        var gap = el.scrollHeight - el.scrollTop - el.clientHeight
        stickRef.current = gap < 48
      }
      return { elRef: elRef, onScroll: onScroll }
    }

    function Row(props) {
      return React.createElement('div', { style: S.formRow },
        React.createElement('span', { style: S.formLabel }, props.label),
        props.children)
    }

    function Field(props) {
      if (props.options) {
        return React.createElement('select', {
          value: props.value || '', onChange: function (e) { props.onChange(e.target.value) }, style: S.field,
        }, props.options.map(function (o) { return React.createElement('option', { key: o, value: o }, o) }))
      }
      return React.createElement('input', {
        type: props.secret ? 'password' : 'text',
        value: props.value || '', placeholder: props.placeholder || '',
        onChange: function (e) { props.onChange(e.target.value) }, style: S.field,
      })
    }

    function SourceTag(props) {
      var s = props.source || 'none'
      var label = s === 'config' ? '页面' : (s === 'env' ? '环境变量' : '未配置')
      return React.createElement('span', { style: Object.assign({}, S.tag, { color: s === 'none' ? T.warn : T.ok }) }, label)
    }

    function blobToWavDataUrl(blob) {
      return blob.arrayBuffer()
        .then(function (buf) { return new (window.AudioContext || window.webkitAudioContext)().decodeAudioData(buf) })
        .then(function (audio) {
          var src = audio.getChannelData(0)
          var rate = 16000
          var ratio = audio.sampleRate / rate
          var len = Math.max(1, Math.floor(src.length / ratio))
          var pcm = new Int16Array(len)
          for (var i = 0; i < len; i++) {
            var v = src[Math.floor(i * ratio)] || 0
            pcm[i] = Math.max(-1, Math.min(1, v)) * 0x7fff
          }
          var header = new ArrayBuffer(44)
          var dv = new DataView(header)
          var write = function (o, s) { for (var i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)) }
          write(0, 'RIFF'); dv.setUint32(4, 36 + pcm.length * 2, true); write(8, 'WAVE')
          write(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true)
          dv.setUint32(24, rate, true); dv.setUint32(28, rate * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true)
          write(36, 'data'); dv.setUint32(40, pcm.length * 2, true)
          var bytes = new Uint8Array(44 + pcm.length * 2)
          bytes.set(new Uint8Array(header), 0)
          bytes.set(new Uint8Array(pcm.buffer), 44)
          var bin = ''
          for (var j = 0; j < bytes.length; j++) bin += String.fromCharCode(bytes[j])
          return 'data:audio/wav;base64,' + btoa(bin)
        })
    }

    function ConfigTab() {
      // 用共享配置：与大会页 / 设备卡看到的是同一份
      var cs = useConfig()
      var cfg = cs.data
      var setCfg = cs.set
      var sv = React.useState(''), msg = sv[0], setMsg = sv[1]
      var tk = React.useState(''), testing = tk[0], setTesting = tk[1]
      var md = React.useState(null), models = md[0], setModels = md[1]
      var ca = React.useState(''), cloneAudio = ca[0], setCloneAudio = ca[1]
      var cm = React.useState(''), cloneMsg = cm[0], setCloneMsg = cm[1]
      var rs = React.useState(false), recording = rs[0], setRecording = rs[1]
      var vs = React.useState([]), voices = vs[0], setVoices = vs[1]
      var recRef = React.useRef(null)
      var chunkRef = React.useRef([])

      React.useEffect(function () {
        // 配置走共享 store：与大会页/设备卡是同一份数据
        cs.reload()
          .then(setCfg)
          .catch(function (e) {
            var hint = String(e.message || '').indexOf('404') >= 0
              ? '宿主还没加载配置 API：请重启 DSH 后刷新页面'
              : '读不到配置：' + e.message
            setCfg({ error: hint })
          })
        fetch('/api/soulmirror/models').then(function (r) { return r.ok ? r.json() : null }).then(setModels).catch(function () {})
      }, [])

      if (!cfg) return React.createElement('div', { style: S.empty }, '加载配置…')
      if (cfg.error) return React.createElement('div', { style: Object.assign({}, S.empty, { color: T.err }) }, cfg.error)

      function set(path, value) {
        var next = JSON.parse(JSON.stringify(cfg))
        var parts = path.split('.')
        var cur = next
        for (var i = 0; i < parts.length - 1; i++) cur = cur[parts[i]]
        cur[parts[parts.length - 1]] = value
        setCfg(next)
      }

      function secretPatch(obj) {
        var out = JSON.parse(JSON.stringify(obj || {}))
        if (!out.apiKey) delete out.apiKey
        return out
      }

      function save() {
        var body = {
          policy: cfg.policy, devices: cfg.devices, apps: cfg.apps,
          activeApp: cfg.activeApp, userName: cfg.userName, wakeWords: cfg.wakeWords, autoWatch: cfg.autoWatch,
          asr: secretPatch(cfg.asr), tts: secretPatch(cfg.tts), brain: secretPatch(cfg.brain),
        }
        fetch('/api/soulmirror/config', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
          .then(function (r) { return r.json() })
          .then(function (j) { setCfg(j); setMsg('已保存') })
          .catch(function (e) { setMsg('保存失败：' + e.message) })
      }

      function test(kind) {
        setTesting(kind); setMsg('测试中…')
        fetch('/api/soulmirror/test', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: kind }) })
          .then(function (r) { return r.json() })
          .then(function (j) { setMsg(j.ok ? '测试通过' : '失败：' + (j.error || '')); setTesting('') })
          .catch(function (e) { setMsg('失败：' + e.message); setTesting('') })
      }

      function detectModels() {
        setMsg('探测模型中…')
        fetch('/api/soulmirror/models')
          .then(function (r) { return r.json() })
          .then(function (j) {
            setModels(j)
            var d = j.llm && j.llm.default
            var count = (j.llm && j.llm.groups || []).reduce(function (n, g) { return n + (g.models || []).length }, 0)
            setMsg('探测完成：' + (d ? ('默认 ' + d.provider + '/' + d.model + '，') : '') + count + ' 个 LLM 模型；ASR provider ' + ((j.speech && j.speech.providers || []).length) + ' 个；TTS 音色 ' + ((j.tts && j.tts.voices || []).length) + ' 个')
          })
          .catch(function (e) { setMsg('探测失败：' + e.message) })
      }

      function cloneVoice() {
        if (!cloneAudio) { setCloneMsg('请先填参考音频路径或 URL'); return }
        setCloneMsg('克隆中…（可能需要几十秒）')
        fetch('/api/soulmirror/voice/clone', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ audio: cloneAudio, prefix: cfg.tts.clonePrefix, targetModel: cfg.tts.model, workspaceId: cfg.tts.workspaceId }),
        })
          .then(function (r) { return r.json() })
          .then(function (j) {
            if (!j.ok) { setCloneMsg('失败：' + (j.error || '')); return }
            if (j.workspaceId) set('tts.workspaceId', j.workspaceId)
            set('tts.voice', j.voiceId); set('tts.cloneVoiceId', j.voiceId)
            setCloneMsg('已创建音色：' + j.voiceId + (j.workspaceId ? '，WorkspaceId=' + j.workspaceId : '') + '（已设为发言音色，记得保存）')
          })
          .catch(function (e) { setCloneMsg('失败：' + e.message) })
      }

      function handleAudioFile(e) {
        var f = e.target.files && e.target.files[0]
        if (!f) return
        var reader = new FileReader()
        reader.onload = function () { setCloneAudio(String(reader.result || '')); setCloneMsg('已选择：' + f.name) }
        reader.onerror = function () { setCloneMsg('读取文件失败') }
        reader.readAsDataURL(f)
      }

      function toggleRecord() {
        if (recording) {
          try { recRef.current && recRef.current.stop() } catch { /* ignore */ }
          setRecording(false)
          return
        }
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          setCloneMsg('浏览器不支持录音')
          return
        }
        navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
          var mr = new MediaRecorder(stream)
          chunkRef.current = []
          mr.ondataavailable = function (ev) { if (ev.data && ev.data.size) chunkRef.current.push(ev.data) }
          mr.onstop = function () {
            stream.getTracks().forEach(function (t) { t.stop() })
            setRecording(false)
            setCloneMsg('录音结束，转 WAV 中…')
            var blob = new Blob(chunkRef.current, { type: 'audio/webm' })
            blobToWavDataUrl(blob)
              .then(function (url) { setCloneAudio(url); setCloneMsg('录音已转 WAV，可以克隆') })
              .catch(function (e) { setCloneMsg('转 WAV 失败：' + e.message) })
          }
          recRef.current = mr
          mr.start()
          setRecording(true)
          setCloneMsg('录音中…再次点击停止')
        }).catch(function (e) { setCloneMsg('无法录音：' + e.message) })
      }

      function detectVoices() {
        setCloneMsg('探测音色中…')
        fetch('/api/soulmirror/voice/list', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ prefix: cfg.tts.clonePrefix }),
        })
          .then(function (r) { return r.json() })
          .then(function (j) {
            if (!j.ok) { setCloneMsg('探测失败：' + (j.error || '')); return }
            setVoices(j.voices || [])
            if (j.workspaceId) set('tts.workspaceId', j.workspaceId)
            setCloneMsg('探测到 ' + (j.voices || []).length + ' 个音色' + (j.workspaceId ? '，WorkspaceId=' + j.workspaceId : ''))
          })
          .catch(function (e) { setCloneMsg('探测失败：' + e.message) })
      }
      var providerOptions = [''].concat(((models && models.llm && models.llm.groups) || []).map(function (g) { return g.id }))

      return React.createElement('div', { style: { flex: 1, overflowY: 'auto', padding: '4px 12px 16px' } },
        React.createElement('div', { style: S.section }, '语音识别'),
        React.createElement(Row, { label: 'provider' }, React.createElement(Field, { value: cfg.asr.provider, options: ['dashscope', 'local', 'openai', 'none'], onChange: function (v) { set('asr.provider', v) } })),
        React.createElement(Row, { label: 'model' }, React.createElement(Field, { value: cfg.asr.model, options: ['paraformer-realtime-v2', 'paraformer-realtime-v1', 'whisper-1'], onChange: function (v) { set('asr.model', v) } })),
        React.createElement(Row, { label: 'Key' }, React.createElement(Field, { secret: true, value: cfg.asr.apiKey, placeholder: '留空用环境变量', onChange: function (v) { set('asr.apiKey', v) } }), React.createElement(SourceTag, { source: cfg.asr.keySource })),
        React.createElement('div', { style: { display: 'flex', justifyContent: 'flex-end' } }, React.createElement('button', { style: S.btn, onClick: function () { test('asr') } }, testing === 'asr' ? '测试中…' : '测试连接')),

        React.createElement('div', { style: S.section }, '语音合成'),
        React.createElement(Row, { label: 'provider' }, React.createElement(Field, { value: cfg.tts.provider, options: ['dashscope', 'sapi', 'openai'], onChange: function (v) { set('tts.provider', v) } })),
        React.createElement(Row, { label: 'model' }, React.createElement(Field, { value: cfg.tts.model, options: ['cosyvoice-v2', 'cosyvoice-v1', 'tts-1'], onChange: function (v) { set('tts.model', v) } })),
        React.createElement(Row, { label: 'voice' }, React.createElement(Field, { value: cfg.tts.voice, options: ['longxiaochun_v2', 'longwan_v2', 'longcheng_v2', 'alloy'], onChange: function (v) { set('tts.voice', v) } })),
        React.createElement(Row, { label: 'Key' }, React.createElement(Field, { secret: true, value: cfg.tts.apiKey, placeholder: '留空用环境变量', onChange: function (v) { set('tts.apiKey', v) } }), React.createElement(SourceTag, { source: cfg.tts.keySource })),
        React.createElement('div', { style: { display: 'flex', justifyContent: 'flex-end' } }, React.createElement('button', { style: S.btn, onClick: function () { test('tts') } }, testing === 'tts' ? '测试中…' : '测试连接')),

        React.createElement('div', { style: S.section }, '大脑'),
        React.createElement(Row, { label: 'provider' }, React.createElement(Field, { value: cfg.brain.provider || '', placeholder: '留空=DSH默认；可填自定义 provider', onChange: function (v) { set('brain.provider', v) } })),
        React.createElement(Row, { label: 'baseUrl' }, React.createElement(Field, { value: cfg.brain.baseUrl, placeholder: '留空 = 用 DSH 当前模型', onChange: function (v) { set('brain.baseUrl', v) } })),
        React.createElement(Row, { label: 'model' }, React.createElement(Field, { value: cfg.brain.model, placeholder: '留空 = DSH 默认模型，可自定义', onChange: function (v) { set('brain.model', v) } })),
        React.createElement(Row, { label: 'Key' },
          React.createElement(Field, { secret: true, value: cfg.brain.apiKey, placeholder: '留空 = 用 DSH 默认模型', onChange: function (v) { set('brain.apiKey', v); set('brain.clearKey', false) } }),
          React.createElement(SourceTag, { source: cfg.brain.keySource }),
          React.createElement('button', {
            style: Object.assign({}, S.btn, { height: 24 }),
            onClick: function () { set('brain.apiKey', ''); set('brain.clearKey', true); setMsg('已标记清除 Key：保存后改用 DSH 默认模型') },
          }, '清除')),
        React.createElement('div', { style: { color: T.muted, fontSize: 11, textAlign: 'right' } }, '留空保存会保留旧 Key；要切换到 DSH 默认模型，请点「清除」再保存。'),
        React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'flex-end' } },
          React.createElement('span', { style: S.note }, (models && models.llm && models.llm.default) ? ('DSH 默认：' + models.llm.default.provider + '/' + models.llm.default.model) : ''),
          React.createElement('button', { style: S.btn, onClick: detectModels }, '探测 DSH 模型')),

        React.createElement('div', { style: S.section }, '声音克隆（DashScope 声音复刻）'),
        React.createElement(Row, { label: '参考音频' }, React.createElement(Field, { value: cloneAudio, placeholder: '选择本地文件、录音，或粘贴公网 URL', onChange: setCloneAudio })),
        React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' } },
          React.createElement('input', { type: 'file', accept: 'audio/*', onChange: handleAudioFile, style: { fontSize: 11, color: T.muted } }),
          React.createElement('button', { style: S.btn, onClick: toggleRecord }, recording ? '停止录音' : '录音'),
          React.createElement('button', { style: S.btn, onClick: detectVoices }, '探测音色'),
          React.createElement('button', { style: S.btn, onClick: detectModels }, '探测模型')),
        React.createElement(Row, { label: 'WorkspaceId' }, React.createElement(Field, { value: cfg.tts.workspaceId || '', placeholder: '百炼业务空间 ID（克隆后自动回填）', onChange: function (v) { set('tts.workspaceId', v) } })),
        React.createElement(Row, { label: '音色前缀' }, React.createElement(Field, { value: cfg.tts.clonePrefix || '', placeholder: '仅字母数字，≤10 位', onChange: function (v) { set('tts.clonePrefix', v) } })),
        voices.length ? React.createElement(Row, { label: '音色库' }, React.createElement('select', {
          style: S.field, value: cfg.tts.cloneVoiceId || cfg.tts.voice || '',
          onChange: function (e) { set('tts.cloneVoiceId', e.target.value); set('tts.voice', e.target.value) },
        }, voices.map(function (v) { return React.createElement('option', { key: v, value: v }, v) }))) : null,
        React.createElement(Row, { label: '已克隆' }, React.createElement(Field, { value: cfg.tts.cloneVoiceId || cfg.tts.voice || '', onChange: function (v) { set('tts.cloneVoiceId', v); set('tts.voice', v) } })),
        React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'flex-end' } },
          React.createElement('span', { style: S.note }, cloneMsg),
          React.createElement('button', { style: S.btnPrimary, onClick: cloneVoice }, '克隆并设为发言音色')),

        React.createElement('div', { style: S.section }, '会议与设备'),
        React.createElement(Row, { label: '抓取软件' },
          React.createElement('select', {
            style: S.field,
            value: cfg.activeApp || '',
            onChange: function (e) { set('activeApp', e.target.value) },
          },
            React.createElement('option', { value: '' }, '自动跟随'),
            (cfg.apps || []).map(function (a) {
              return React.createElement('option', { key: a.name, value: a.name }, a.name + (a.proc ? ' · ' + a.proc : ''))
            }))),
        React.createElement(Row, { label: '用户名' }, React.createElement(Field, { value: cfg.userName || '', placeholder: '用于生成唤醒词', onChange: function (v) { set('userName', v) } })),
        React.createElement(Row, { label: '唤醒词' }, React.createElement(Field, { value: (cfg.wakeWords || []).join(','), placeholder: '留空自动推导', onChange: function (v) { set('wakeWords', v.split(',').map(function (s) { return s.trim() }).filter(Boolean)) } })),
        React.createElement(Row, { label: '发言设备' }, React.createElement(Field, { value: cfg.devices.speak, placeholder: 'CABLE Input', onChange: function (v) { set('devices.speak', v) } })),
        React.createElement(Row, { label: '恢复麦克风' }, React.createElement(Field, { value: cfg.devices.micRestore, placeholder: '真实麦克风', onChange: function (v) { set('devices.micRestore', v) } })),

        // ── 采集：环回 + 麦克风 ───────────────────────────────────────
        // 用户报的原始问题："只采集声卡，我说话的声音没有啊"。
        // 根因：会议软件不会把自己的麦克风声音再输出到扬声器（否则参会的人会听见自己的回声），
        // 所以环回里只有别人的声音；必须再采一路麦克风，和环回混成一路再送识别。
        React.createElement('div', { style: S.section }, '采集（环回 + 麦克风）'),
        React.createElement(Row, { label: '同时录我的麦克风' },
          React.createElement(Field, {
            value: cfg.devices.mixMic === false ? 'false' : 'true',
            options: ['true', 'false'],
            onChange: function (v) { set('devices.mixMic', v === 'true') },
          })),
        React.createElement('div', { style: { color: T.muted, fontSize: 11, margin: '-2px 0 6px' } },
          '会议软件不会把自己的声音放到输出（否则会听到自己的回声），所以只录环回时转写里没有你自己说的话。' +
          '打开这个开关后会同时再采一路麦克风，和环回混成一路再送语音识别（默认打开）。'),
        React.createElement(Row, { label: '麦克风设备' },
          React.createElement(Field, { value: cfg.devices.micDevice || '', placeholder: '留空 = 系统默认录音设备', onChange: function (v) { set('devices.micDevice', v) } })),
        React.createElement('div', { style: { color: T.muted, fontSize: 11, margin: '-2px 0 6px' } },
          (cfg.devices.captureMode === 'device')
            ? '当前采集模式是「麦克风（device）」，采的本来就是麦克风，所以不会再叠一路（否则同一句话会重复）。'
            : '可填设备名的一部分，按名字匹配；留空就用系统默认录音设备。麦克风那一路断了会继续用环回来转写，并在状态里写明。'),
        React.createElement(Row, { label: '策略' }, React.createElement(Field, { value: cfg.policy, options: ['observe', 'suggest', 'auto'], onChange: function (v) { set('policy', v) } })),
        React.createElement(Row, { label: '自动监听' }, React.createElement(Field, { value: cfg.autoWatch ? 'true' : 'false', options: ['true', 'false'], onChange: function (v) { set('autoWatch', v === 'true') } })),

        React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginTop: 14 } },
          React.createElement('button', { style: S.btnPrimary, onClick: save }, '保存'),
          React.createElement('span', { style: S.note }, msg))
      )
    }

    function Stat(props) {
      return React.createElement('div', { style: { background: T.bg2, border: '1px solid ' + T.border, borderRadius: 8, padding: '10px 12px', minWidth: 0 } },
        React.createElement('div', { style: { color: T.muted, fontSize: 11, marginBottom: 3 } }, props.label),
        React.createElement('div', { style: { fontSize: 18, fontWeight: 600, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, props.value))
    }

    function Card(props) {
      return React.createElement('section', { style: { background: T.bg2, border: '1px solid ' + T.border, borderRadius: 10, minWidth: 0, overflow: 'hidden' } },
        React.createElement('header', { style: { display: 'flex', alignItems: 'center', gap: 8, padding: '9px 12px', borderBottom: '1px solid ' + T.border, fontSize: 12, fontWeight: 600 } },
          React.createElement('span', { style: { flex: 1, minWidth: 0 } }, props.title),
          props.extra || null),
        React.createElement('div', { style: { padding: 12 } }, props.children))
    }

    function MeetingPage(props) { return React.createElement(MeetingWorkspace, { full: true }) }

    function toneColor(tone) { return tone === 'error' ? T.err : tone === 'warning' ? T.warn : tone === 'success' ? T.ok : tone === 'info' ? T.brand : T.muted }
    /** 秒 → "16 分 38 秒"。界面只显示已落盘的录音时长，不显示还在涨的墙钟。 */
    function fmtDuration(sec) {
      var n = Math.max(0, Math.round(Number(sec) || 0))
      var m = Math.floor(n / 60)
      var s = n % 60
      return m > 0 ? (m + ' 分 ' + s + ' 秒') : (s + ' 秒')
    }
    function getView(lv) {
      return lv.view && lv.view.version === 1 ? lv.view : {
        version: 0, headline: '需要更新并重启 DSH', detail: '当前宿主尚未提供持久化视图。为避免状态冲突，不显示推测的运行状态。', tone: 'warning',
        primary: { label: '立即开始录音', action: 'record' }, steps: [], activity: [], diagnostics: [], issues: [], notices: [], display: {}, persistence: '等待服务端事件视图',
      }
    }
    /**
     * 产物位置卡：录音文件、纪要、非流式转写各自的真实路径。
     * 路径来自宿主 stat（不猜），按钮走 /api/soulmirror/open-path 由宿主机打开，
     * 插件自己不拼 explorer 命令，也不允许打开数据目录以外的路径。
     */
    function ArtifactsCard(props) {
      var h = React.createElement
      var a = (props && props.artifacts) || null
      var ns = React.useState(''), msg = ns[0], setMsg = ns[1]
      var bs = React.useState(false), busy = bs[0], setBusy = bs[1]
      if (!a || !a.dir) return h('div', { style: S.note }, '还没有会议目录：开始录音后，录音与纪要的位置会显示在这里。')
      function openFile(path, reveal) {
        if (!path || busy) return
        setBusy(true); setMsg('正在打开…')
        fetch('/api/soulmirror/open-path', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ path: path, reveal: !!reveal }),
        }).then(function (r) { return r.json() }).then(function (r) {
          setBusy(false)
          setMsg(r && r.ok ? (reveal ? '已在文件夹中定位' : '已用默认程序打开') : ('打不开：' + ((r && r.error) || '未知原因')))
        }).catch(function (e) { setBusy(false); setMsg('打不开：' + e.message) })
      }
      function row(label, item, canOpen) {
        var exists = !!(item && item.exists)
        var extra = ''
        if (item && item.seconds) extra = ' · ' + Math.floor(item.seconds / 60) + ' 分 ' + (item.seconds % 60) + ' 秒'
        else if (item && item.bytes) extra = ' · ' + Math.round(item.bytes / 1024) + ' KB'
        return h('div', { key: label, style: { padding: '8px 0', borderBottom: '1px solid ' + T.border } },
          h('div', { style: S.rowBetween },
            h('span', { style: { fontWeight: 600, fontSize: 12 } }, label),
            h('span', { style: S.note }, exists ? '已生成' + extra : '还没有')),
          h('div', { style: { fontFamily: 'ui-monospace, Consolas, monospace', fontSize: 11, color: T.muted, overflowWrap: 'anywhere', marginTop: 3 } },
            item && item.path ? item.path : '（尚无可显示的路径）'),
          exists && canOpen ? h('div', { style: { display: 'flex', gap: 6, marginTop: 6 } },
            h('button', { type: 'button', style: Object.assign({}, S.btn, { height: 24 }), disabled: busy, onClick: function () { openFile(item.path, true) } }, '在文件夹中显示'),
            label === '录音文件' ? h('button', { type: 'button', style: Object.assign({}, S.btn, { height: 24 }), disabled: busy, onClick: function () { openFile(item.path, false) } }, '用播放器打开') : null,
            label !== '录音文件' ? h('button', { type: 'button', style: Object.assign({}, S.btn, { height: 24 }), disabled: busy, onClick: function () { openFile(item.path, false) } }, '打开') : null) : null)
      }
      return h('section', { 'aria-label': '会议产物位置', style: { border: '1px solid ' + T.border, borderRadius: 8, padding: '10px 12px' } },
        h('div', { style: S.rowBetween },
          h('div', { style: { display: 'flex', gap: 6, alignItems: 'center' } },
            h('span', { style: { fontWeight: 600 } }, '产物位置'),
            // 这一场在哪个位置：默认数据目录 / 用户在「保存位置」里选的自定义目录
            a.root === 'custom'
              ? h('span', { style: Object.assign({}, S.tag, { color: T.brand }) }, '自定义保存位置')
              : (a.root === 'default' ? h('span', { style: S.tag }, '默认位置') : null)),
          h('button', { type: 'button', style: Object.assign({}, S.btn, { height: 24 }), disabled: busy, onClick: function () { openFile(a.dir, true) } }, '打开会议文件夹')),
        h('div', { style: Object.assign({}, S.note, { marginTop: 4, overflowWrap: 'anywhere' }) }, a.dir),
        row('录音文件', a.audio, true),
        row('会议纪要', a.minutes, true),
        row('非流式转写', a.transcript, true),
        // 导出位置：设了就写在那里（真实落盘路径由宿主返回）；没设就还是浏览器下载
        h('div', { style: { padding: '8px 0' } },
          h('div', { style: S.rowBetween },
            h('span', { style: { fontWeight: 600, fontSize: 12 } }, '导出位置'),
            h('span', { style: S.note }, a.exportDir ? '自定义位置' : '未设置：浏览器下载')),
          h('div', { style: { fontFamily: 'ui-monospace, Consolas, monospace', fontSize: 11, color: T.muted, overflowWrap: 'anywhere', marginTop: 3 } },
            a.exportDir || '（未设置导出位置，导出仍由浏览器下载）'),
          a.exportDir ? h('div', { style: { display: 'flex', gap: 6, marginTop: 6 } },
            h('button', { type: 'button', style: Object.assign({}, S.btn, { height: 24 }), disabled: busy, onClick: function () { openFile(a.exportDir, true) } }, '在文件夹中显示')) : null),
        msg ? h('div', { role: 'status', style: Object.assign({}, S.note, { marginTop: 6 }) }, msg) : null)
    }

    /**
     * 保存位置卡：会议保存位置（录音 / 纪要 / 转写）与导出位置，都可以手动改。
     *
     * 三条约束对应"不能丢历史 / 不能越界 / 不能静默失败"：
     *   ① 先校验再保存：路径交给宿主 /storage 校验（真写一个探针文件再删掉），
     *      校验不过就地显示 reason + hint，绝不"看起来保存了"；
     *   ② 换位置是"以后写这里"：不搬旧数据。列表是**默认根 + 配置根合并**的，
     *      所以已有会议仍在原位置，仍可查看 / 整理 / 删除；
     *   ③ 配置的路径后来失效时宿主会回退默认根，并把 fallback/reason 带在 /status 里，
     *      这张卡直接显示"已回退"，不假装还在自定义位置。
     */
    function StorageCard(props) {
      var h = React.createElement
      var live = useLive()
      var st = (props && props.storage) || (live && live.storage) || null
      var ms = React.useState(''), msg = ms[0], setMsg = ms[1]
      var bs = React.useState(false), busy = bs[0], setBusy = bs[1]
      var es = React.useState(''), editing = es[0], setEditing = es[1]
      var ts = React.useState(''), draft = ts[0], setDraft = ts[1]
      var cs = React.useState(null), counts = cs[0], setCounts = cs[1]
      function loadCounts() {
        // 旧会议数量：从 /recordings 的 byRoot 拿（不在这里猜目录）。
        // 只在浏览器里发请求：组件渲染冒烟测试没有 window，也不该触发网络。
        if (typeof window === 'undefined' || typeof fetch !== 'function') return
        fetch('/api/soulmirror/recordings').then(function (r) { return r.json() })
          .then(function (j) {
            if (j && j.ok) setCounts({ byRoot: j.byRoot || {}, total: Number(j.total) || 0 })
          })
          .catch(function () {})
      }
      React.useEffect(function () { loadCounts() }, [])
      function submit(action, kind, path) {
        if (busy) return
        if (typeof fetch !== 'function') { setMsg('当前环境不能校验保存位置'); return }
        setBusy(true)
        setMsg(action === 'reset' ? '正在恢复默认…' : '正在校验并保存…')
        fetch('/api/soulmirror/storage', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action: action, kind: kind, path: path || '' }),
        }).then(function (r) { return r.json() }).then(function (j) {
          setBusy(false)
          if (j && j.ok) {
            setEditing('')
            setMsg(j.message || '已保存')
            loadCounts()   // 保存后重算"已有 N 场"：不靠旧数字糊弄
          } else {
            setMsg('没保存：' + ((j && (j.message || j.error)) || '未知原因') + (j && j.hint ? '｜' + j.hint : ''))
          }
        }).catch(function (e) { setBusy(false); setMsg('没保存：' + e.message) })
      }
      function openPath(path, reveal) {
        if (!path || typeof fetch !== 'function') return
        fetch('/api/soulmirror/open-path', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ path: path, reveal: !!reveal }),
        }).then(function (r) { return r.json() }).then(function (r) {
          setMsg(r && r.ok ? (reveal ? '已在文件夹中定位' : '已打开') : ('打不开：' + ((r && r.error) || '未知原因')))
        }).catch(function (e) { setMsg('打不开：' + e.message) })
      }
      function pathRow(kind, label, value, emptyText) {
        return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 4 } },
          h('div', { style: { fontFamily: 'ui-monospace, Consolas, monospace', fontSize: 11, color: T.muted, overflowWrap: 'anywhere' } },
            (value || emptyText)),
          editing === kind
            ? h('div', { style: { display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' } },
              h('input', {
                'aria-label': label + '（绝对路径）',
                placeholder: '文件夹绝对路径，例如 D:\\会议记录',
                value: draft,
                onChange: function (e) { setDraft(e.target.value) },
                onKeyDown: function (e) { if (e.key === 'Enter') submit('save', kind, draft) },
                style: Object.assign({}, S.field, { height: 26, fontSize: 12, fontFamily: 'ui-monospace, Consolas, monospace', flex: 1, minWidth: 220 }),
              }),
              h('button', { type: 'button', style: Object.assign({}, S.btnPrimary, { height: 26 }), disabled: busy || !String(draft || '').trim(), onClick: function () { submit('save', kind, draft) } },
                busy ? '校验中…' : '校验并保存'),
              h('button', { type: 'button', style: Object.assign({}, S.btn, { height: 26 }), disabled: busy, onClick: function () { submit('validate', kind, draft) } }, '只校验'))
            : null)
      }
      var defRoot = (st && st.defaultRoot) || ''
      var effRoot = (st && st.effectiveRoot) || defRoot
      var exportDir = (st && st.exportDir) || ''
      var byRoot = (counts && counts.byRoot) || {}
      var defaultCount = Number(byRoot['default']) || 0
      var customCount = Number(byRoot['custom']) || 0
      var recordsLabel = !st ? '读取中…' : (st.custom ? '自定义位置' : (st.fallback ? '已回退到默认位置' : (st.sameAsDefault ? '默认位置（配置值与默认相同）' : '默认位置')))
      var exportLabel = !st ? '读取中…' : (!st.exportConfigured ? '未设置（浏览器下载）' : (st.exportFallback ? '已回退为浏览器下载' : '自定义位置'))
      return h('section', { 'aria-label': '保存位置', style: { border: '1px solid ' + T.border, borderRadius: 8, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 10 } },
        h('div', { style: S.rowBetween },
          h('span', { style: { fontWeight: 600 } }, '保存位置'),
          h('span', { style: S.note }, '手动选择；先校验，再保存')),
        h('div', { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
          h('div', { style: S.rowBetween },
            h('span', { style: { fontSize: 12, fontWeight: 600 } }, '会议保存位置'),
            h('span', { style: Object.assign({}, S.note, { color: (st && st.fallback) ? T.warn : T.muted }) }, recordsLabel)),
          pathRow('records', '会议保存位置', effRoot, '（还没有确定）'),
          st && st.fallback
            ? h('div', { role: 'status', style: Object.assign({}, S.warn, { fontSize: 11 }) },
              '配置的保存位置不可用，已回退到默认位置：' + String((st.reason || '') + ' ' + (st.message || '')).trim() + (st.hint ? '｜' + st.hint : ''))
            : null,
          h('div', { style: S.note },
            '录音、纪要、转写都写到这个位置。只影响以后的**新会议**：已有 ' + defaultCount + ' 场仍在默认位置' +
            (customCount ? '、' + customCount + ' 场在自定义位置' : '') +
            '，都还能查看、整理与删除（列表会把两个位置合并显示，不会自动搬走文件）。'),
          h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap' } },
            h('button', { type: 'button', style: Object.assign({}, S.btn, { height: 24 }), disabled: busy, onClick: function () {
              if (editing === 'records') { setEditing(''); return }
              setDraft((st && st.custom) ? effRoot : '')
              setEditing('records')
            } }, editing === 'records' ? '收起' : '选择文件夹'),
            st && st.configured ? h('button', { type: 'button', style: Object.assign({}, S.btn, { height: 24 }), disabled: busy, onClick: function () { submit('reset', 'records', '') } }, '恢复默认') : null,
            effRoot ? h('button', { type: 'button', style: Object.assign({}, S.btn, { height: 24 }), disabled: busy, onClick: function () { openPath(effRoot, true) } }, '在文件夹中显示') : null)),
        h('div', { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
          h('div', { style: S.rowBetween },
            h('span', { style: { fontSize: 12, fontWeight: 600 } }, '导出位置'),
            h('span', { style: Object.assign({}, S.note, { color: (st && st.exportFallback) ? T.warn : T.muted }) }, exportLabel)),
          pathRow('export', '导出位置', exportDir, '未设置：导出仍由浏览器下载'),
          st && st.exportFallback
            ? h('div', { role: 'status', style: Object.assign({}, S.warn, { fontSize: 11 }) },
              '配置的导出位置不可用，导出已回退为浏览器下载：' + String((st.exportReason || '') + ' ' + (st.exportMessage || '')).trim() + (st.exportHint ? '｜' + st.exportHint : ''))
            : null,
          h('div', { style: S.note }, '设了以后，导出的纪要 / 转写文件直接写到这个目录，并给出真实落盘路径；留空则仍然由浏览器下载。'),
          h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap' } },
            h('button', { type: 'button', style: Object.assign({}, S.btn, { height: 24 }), disabled: busy, onClick: function () {
              if (editing === 'export') { setEditing(''); return }
              setDraft((st && st.exportConfigured) ? exportDir : '')
              setEditing('export')
            } }, editing === 'export' ? '收起' : '选择文件夹'),
            st && st.exportConfigured ? h('button', { type: 'button', style: Object.assign({}, S.btn, { height: 24 }), disabled: busy, onClick: function () { submit('reset', 'export', '') } }, '恢复默认') : null,
            exportDir ? h('button', { type: 'button', style: Object.assign({}, S.btn, { height: 24 }), disabled: busy, onClick: function () { openPath(exportDir, true) } }, '在文件夹中显示') : null)),
        h('div', { style: S.note },
          '校验规则：必须是**已存在**的文件夹绝对路径；不能是 DSH / 插件的安装目录；会真写一个临时探针文件再删掉来确认可写；磁盘剩余要 ≥200MB。' +
          '（这里没有系统文件夹弹窗：粘贴或输入路径即可。）'),
        msg ? h('div', { role: 'status', style: S.note }, msg) : null)
    }

    /** 目录名（用于「从会议录音添加」的下拉，不把整条路径塞进一行） */
    function recBaseName(dir) {
      var parts = String(dir || '').split(/[\\/]+/)
      var out = []
      for (var i = 0; i < parts.length; i++) if (parts[i]) out.push(parts[i])
      return out.length ? out[out.length - 1] : String(dir || '')
    }

    /**
     * 从会议录音补声纹：把接口的 reason 翻成人话（+ 宿主给的 hint）。
     *
     * 两个入口（「这场会谁是谁」每行 / 声纹卡「从会议录音添加」）共用这一份，
     * 不在两处各写一套——文案不一致时，用户会以为是两个不同的毛病。
     * reason 清单来自 lib/voiceprint/enroll-from-meeting.js 的 fail() 与 quality.js。
     */
    function enrollFailText(j) {
      var reason = String((j && j.reason) || '')
      var hint = String((j && j.hint) || '')
      var need = Number(j && j.requiredSeconds) > 0 ? Number(j.requiredSeconds) : 10
      var haveRaw = j && j.availableSeconds != null ? j.availableSeconds
        : (j && j.speechSeconds != null ? j.speechSeconds : null)
      var have = haveRaw == null ? null : Number(haveRaw)
      var haveTxt = have != null && isFinite(have) ? (Math.round(have * 10) / 10) + ' 秒' : ''
      var text = ''
      var fallbackHint = ''
      if (reason === 'not-enough-speech') {
        text = '这个人在这场的发言只够 ' + (haveTxt || '不到 ' + need + ' 秒') + '，至少 ' + need + ' 秒才能存成声纹'
        fallbackHint = '需要这个人在不被打断的情况下连续说满约 ' + (need + 1) + ' 秒；换一场发言更长的会，或现场对着面板录一段'
      } else if (reason === 'mixed-voices') {
        text = '这段里像两个人在说话：混着存会把两个人的声音写成同一个人，所以先没有入库'
        fallbackHint = '换一段更干净发言的会，或换这场会里另一个人；现场对着面板录一段更稳'
      } else if (reason === 'no-audio') {
        text = '这场会没有可用的录音' + (j && j.message ? '：' + j.message : '')
        fallbackHint = '只有带录音（audio.wav）的会才能补声纹：在「之前的录音」里挑一条有音频的'
      } else if (reason === 'no-speaker') {
        text = '这场会里找不到这个说话人的可用发言' + (j && j.labels && j.labels.length ? '（云端只分出了：' + j.labels.join('、') + '）' : '')
        fallbackHint = '先用「非流式转写」把这场会整理一次（要 transcript-offline.jsonl），再来补声纹'
      } else if (reason === 'model-missing' || reason === 'runtime-missing') {
        text = '声纹模型/运行库还没装好，这段录音没有解码、也没有入库'
        fallbackHint = '在「我认识的人 · 本机声纹」点「一键安装」，装好后回来重试'
      } else if (reason === 'consent-required') {
        text = '还没有勾选同意，不能把这个人的声纹存进本机库'
        fallbackHint = '勾选「我同意在本机保存这个人的声纹，仅用于会后认人」后再保存'
      } else if (reason === 'need-name') {
        text = '还没有填这个人的名字'
        fallbackHint = '名字用来在「我认识的人」里显示；同名会追加样本，不会新建一个人'
      } else if (reason === 'too-quiet') {
        text = '这段录音太安静（像静音或音量太低），算出来的声纹不可靠，先没有入库'
        fallbackHint = '确认这场会的录音设备没静音；换一场声音更清楚的会，或现场录一段'
      } else if (reason === 'clipping') {
        text = '这段录音削波了（音量顶到头），声纹会失真，先没有入库'
        fallbackHint = '换一场录音音量正常的会，或现场录一段'
      } else if (reason === 'embed-failed') {
        text = '算声纹向量失败' + (j && j.message ? '：' + j.message : '')
        fallbackHint = '在声纹卡点「一键安装」重装模型后再试'
      } else if (reason === 'store-failed') {
        text = '向量算好了，但写声纹库失败' + (j && j.message ? '：' + j.message : '')
        fallbackHint = '检查数据目录是否可写、磁盘是否已满后重试'
      } else if (reason === 'person-missing') {
        text = '这个人已经不在本机声纹库里了'
        fallbackHint = '清掉重选，按名字重新存一次'
      } else if (reason === 'library-missing') {
        text = '宿主没有打开声纹库，存不进去'
        fallbackHint = '重启 DSH 后再试'
      } else {
        text = String((j && (j.message || j.error)) || ('没有入库：' + (reason || '未知原因')))
      }
      return { text: text, hint: hint || fallbackHint, reason: reason }
    }

    /**
     * 本机声纹库：录 10 秒 → 算向量 → 存本地（音频不保留），
     * 会后就能把"说话人2"自动认成这个人。
     *
     * 展示上照参考项目的分工：模型状态（装没装）/ 人员（几个人、几个样本）/
     * 操作（录一段、删）分开写，避免"点了没反应"时看不出卡在哪。
     */
    function VoiceprintCard(props) {
      var h = React.createElement
      var ds = React.useState(null), data = ds[0], setData = ds[1]
      var ms = React.useState(''), msg = ms[0], setMsg = ms[1]
      var bs = React.useState(false), busy = bs[0], setBusy = bs[1]
      var rs = React.useState(false), recording = rs[0], setRecording = rs[1]
      var ns = React.useState(''), name = ns[0], setName = ns[1]
      var secs = React.useState(0), elapsed = secs[0], setElapsed = secs[1]
      var cs = React.useState(false), consented = cs[0], setConsented = cs[1]
      var xs = React.useState(''), confirmId = xs[0], setConfirmId = xs[1]
      var fs = React.useState(''), loadError = fs[0], setLoadError = fs[1]
      // 朗读文本的"当前这一段"：只在首次拿到数据时定下来，之后用户不点「换一段」就不换。
      // 为什么不能用服务端每次的 pick：安装时每 800ms 刷新一次 /voiceprint，
      // 若每刷一次跟着换，用户读着读着文本就变了（真实体验灾难）。
      var pss = React.useState(''), passageId = pss[0], setPassageId = pss[1]
      var recorderRef = React.useRef(null)
      var aliveRef = React.useRef(true)
      var secRef = React.useRef(null)
      // 「从会议录音添加」：给以前的会补声纹（同一个 voiceprint-enroll 接口）。
      // 全部 hook 必须留在这两个提前 return 之前（tests/hooks-order）。
      var fr = React.useState(null), fromRecs = fr[0], setFromRecs = fr[1]
      var frl = React.useState(false), fromLoading = frl[0], setFromLoading = frl[1]
      var fre = React.useState(''), fromErr = fre[0], setFromErr = fre[1]
      var fdr = React.useState(''), fromDir = fdr[0], setFromDir = fdr[1]
      var fsps = React.useState([]), fromSpeakers = fsps[0], setFromSpeakers = fsps[1]
      var fsp = React.useState(''), fromSpeaker = fsp[0], setFromSpeaker = fsp[1]
      var fnm = React.useState(''), fromName = fnm[0], setFromName = fnm[1]
      var fcon = React.useState(false), fromConsent = fcon[0], setFromConsent = fcon[1]
      var fbusy = React.useState(false), fromBusy = fbusy[0], setFromBusy = fbusy[1]
      var fmsg = React.useState(''), fromMsg = fmsg[0], setFromMsg = fmsg[1]

      function refresh() {
        return fetch('/api/soulmirror/voiceprint').then(function (r) { return r.json() }).then(function (j) {
          if (j && j.ok) { setData(j); setLoadError(''); return j }
          setLoadError('读不到声纹库：' + ((j && (j.error || j.reason)) || '宿主没有返回数据'))
          return j
        }).catch(function (e) { setLoadError('读不到声纹库：' + e.message); return null })
      }
      React.useEffect(function () { refresh() }, [])
      // 卸载清理：切 tab / 收面板后不能留着麦克风占用（P1-44 的隐私面）
      React.useEffect(function () {
        aliveRef.current = true
        return function () {
          aliveRef.current = false
          var rec = recorderRef.current
          if (!rec) return
          recorderRef.current = null
          try { if (rec.__timer) clearInterval(rec.__timer) } catch (e) { /* 已清 */ }
          try { rec.stop() } catch (e) { /* 已停 */ }
          try { if (rec.__stream) rec.__stream.getTracks().forEach(function (t) { try { t.stop() } catch (err) { /* 已停 */ } }) } catch (e) { /* 已释放 */ }
        }
      }, [])
      // 状态卡「去安装」跳过来时，把焦点落到这张卡上（否则用户还是找不到）
      React.useEffect(function () {
        var fp = (props && props.focusSeq) || 0
        if (!fp) return
        var el = secRef.current
        if (!el) return
        try { if (el.scrollIntoView) el.scrollIntoView({ block: 'center' }) } catch (e) { /* 滚动不可用 */ }
        try { if (el.focus) el.focus() } catch (e) { /* 焦点不可用 */ }
      }, [(props && props.focusSeq) || 0])
      // ——hooks 必须全部在提前 return 之前（否则 data 到位那一刻 hook 数量变化 → React #310）——
      // 安装进行中：每 800ms 读一次真实进度（不按时间估算）
      React.useEffect(function () {
        var inst = (data && data.install) || {}
        if (!inst.running) return
        var alive = true
        var t = setInterval(function () { if (alive) refresh() }, 800)
        return function () { alive = false; clearInterval(t) }
      }, [data && data.install ? data.install.running : false])

      // 后台安装结束时把终态告诉用户（轮询停下来那一刻正是 done / failed / idle）
      React.useEffect(function () {
        var inst = (data && data.install) || {}
        if (!data || inst.running) return
        if (inst.phase === 'done') setMsg('安装完成，自检通过：可以开始录声纹了')
        else if (inst.phase === 'idle' && String(inst.message || '').indexOf('已取消') === 0) setMsg('已取消，临时文件已清理')
      }, [data && data.install ? data.install.phase : '', data && data.install ? data.install.message : '', data && data.install ? data.install.running : false])

      // 首次拿到 /voiceprint 时把"当前这一段"定下来（服务端 pick 只用来定初值）。
      // 文案不在这里复制：文本、字数、估算秒数都来自 data.readAloud（服务端唯一一份）。
      React.useEffect(function () {
        var ra = (data && data.readAloud) || {}
        var list = Array.isArray(ra.passages) ? ra.passages : []
        if (!list.length || passageId) return
        var first = (ra.pick && ra.pick.id) ? ra.pick : list[0]
        setPassageId(String((first && first.id) || ''))
      }, [data && data.readAloud ? (data.readAloud.pick && data.readAloud.pick.id) || '' : '', data && data.readAloud && Array.isArray(data.readAloud.passages) ? data.readAloud.passages.length : 0, passageId])

      if (!data) {
        return h('div', { style: S.note },
          loadError
            ? h('div', { style: { color: T.err } }, loadError, h('button', { type: 'button', style: Object.assign({}, S.btn, { height: 24, marginLeft: 8 }), onClick: function () { setLoadError(''); refresh() } }, '重试'))
            : '正在读取本机声纹库…')
      }

      var model = data.model || {}
      var people = data.people || []
      var runtime = data.runtime || {}
      var vpEnabled = data.enabled === undefined ? true : data.enabled === true
      var hostRuntimeOk = !!(data.hostRuntime && data.hostRuntime.ok)
      // 能不能录：**模型装好**且**运行库可用**（数据目录自装的，或宿主依赖里本来就有）。
      // 旧宿主没带 usable 字段时退回 model/runtime 两个字段，行为与之前一致。
      var usable = data.usable === undefined ? !!(model.installed && runtime.usable) : data.usable === true

      // 朗读文本（服务端下发唯一一份；这里只挑"当前哪一段"，不复制文案）
      var readAloud = (data && data.readAloud) || null
      var passages = (readAloud && Array.isArray(readAloud.passages)) ? readAloud.passages : []
      // 门槛来自服务端（与注册门槛同源）。旧宿主没带这个字段时退回 10 秒，不写死在前端文案里
      var minSeconds = readAloud && Number(readAloud.minSeconds) > 0 ? Number(readAloud.minSeconds) : 10
      var current = null
      for (var pi = 0; pi < passages.length; pi++) {
        if (passages[pi] && passages[pi].id === passageId) current = passages[pi]
      }
      if (!current && readAloud && readAloud.pick) current = readAloud.pick
      if (!current && passages.length) current = passages[0]

      /** 换一段：只在服务端下发的列表里换，且换到与当前不同的一段 */
      function nextPassage() {
        if (!passages.length) return
        var at = Math.floor(Math.random() * passages.length)
        if (passages.length > 1 && passages[at] && passages[at].id === passageId) at = (at + 1) % passages.length
        var picked = passages[at] || passages[0]
        setPassageId(String((picked && picked.id) || ''))
      }

      function stopRecording() {
        var rec = recorderRef.current
        if (!rec) return
        recorderRef.current = null
        try { if (rec.__timer) clearInterval(rec.__timer) } catch (e) { /* 已清 */ }
        try { rec.stop() } catch (e) { /* 已停 */ }
        setRecording(false)
      }

      function startRecording() {
        if (recording) { stopRecording(); return }
        // 不白录：模型/运行库不可用、没勾同意、没填人名，都不许打开麦克风
        if (!usable) {
          setMsg('先装模型才能录声纹：' + (data.notReadyHint || '模型/运行库还没装好'))
          return
        }
        if (!consented) { setMsg('请先勾选「我同意在本机保存这个人的声纹」再录'); return }
        var theName = String(name || '').trim()
        if (!theName) { setMsg('先填要录的人名，再录'); return }
        var media = typeof navigator !== 'undefined' && navigator.mediaDevices
        if (!media || !media.getUserMedia) { setMsg('这个浏览器拿不到麦克风'); return }
        setMsg('正在请求麦克风权限…')
        media.getUserMedia({ audio: { channelCount: 1, sampleRate: 16000, echoCancellation: false, noiseSuppression: false } })
          .then(function (stream) {
            var Rec = typeof MediaRecorder !== 'undefined' ? MediaRecorder : null
            if (!Rec) { stream.getTracks().forEach(function (t) { t.stop() }); setMsg('这个浏览器不支持录音'); return }
            var rec = new Rec(stream, { mimeType: Rec.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : '' })
            rec.__stream = stream
            var chunks = []
            rec.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data) }
            rec.onstop = function () {
              stream.getTracks().forEach(function (t) { t.stop() })
              setRecording(false)
              recorderRef.current = null
              if (!aliveRef.current) return   // 组件已卸载：只释放麦克风，不再发请求
              // 真实已录秒数（按墙钟算，不编百分比）。不够门槛就在这里停住：
              // 让人等一次后端报错更差，也会白算一遍向量（后端只会回 not-enough-speech）。
              // 用 floor：9.5 秒不能显示成 10 秒骗过前端门槛（后端按真实时长判定）
        var recordedSec = Math.floor((Date.now() - (rec.__startedAt || Date.now())) / 1000)
              setElapsed(recordedSec)
              if (recordedSec < minSeconds) {
                setMsg('这段只录了 ' + recordedSec + ' 秒，不够 ' + minSeconds + ' 秒：请对着上面的段落读完，再录一次')
                return
              }
              var blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' })
              // 交回后端解析：后端只认 16k 单声道 WAV/WebM，转码在浏览器侧做
              decodeToWav(blob).then(function (wav) {
                if (!wav) { setMsg('这段录音解码失败'); return }
                enroll(wav)
              }).catch(function (e) { setMsg('录音处理失败：' + e.message) })
            }
            rec.start()
            recorderRef.current = rec
            setRecording(true)
            setElapsed(0)
            setMsg('正在录音：对着上面的段落读完，说满 ' + minSeconds + ' 秒（推荐 12 秒），说完再点一次结束')
            var startedAt = Date.now()
            rec.__startedAt = startedAt
            var timer = setInterval(function () {
              setElapsed(Math.round((Date.now() - startedAt) / 1000))
              if (Date.now() - startedAt > 30000) { clearInterval(timer); stopRecording() }
            }, 200)
            rec.__timer = timer
          })
          .catch(function (e) { setMsg('拿不到麦克风：' + e.message) })
      }

      /** WebM/Opus → 16k 单声道 WAV（用 WebAudio 重采样；不依赖后端转码） */
      function decodeToWav(blob) {
        var AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext)
        if (!AC) return Promise.resolve(null)
        return blob.arrayBuffer().then(function (buf) {
          var ctx = new AC({ sampleRate: 16000 })
          return ctx.decodeAudioData(buf).then(function (audio) {
            var ch = audio.getChannelData(0)
            var resample = audio.sampleRate === 16000 ? ch : (function () {
              var ratio = 16000 / audio.sampleRate
              var out = new Float32Array(Math.round(ch.length * ratio))
              for (var i = 0; i < out.length; i++) out[i] = ch[Math.min(ch.length - 1, Math.round(i / ratio))]
              return out
            })()
            var wav = new ArrayBuffer(44 + resample.length * 2)
            var dv = new DataView(wav)
            function w(off, str) { for (var i = 0; i < str.length; i++) dv.setUint8(off + i, str.charCodeAt(i)) }
            w(0, 'RIFF'); dv.setUint32(4, 36 + resample.length * 2, true); w(8, 'WAVE'); w(12, 'fmt ')
            dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true)
            dv.setUint32(24, 16000, true); dv.setUint32(28, 32000, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true)
            w(36, 'data'); dv.setUint32(40, resample.length * 2, true)
            for (var j = 0; j < resample.length; j++) {
              var v = Math.max(-1, Math.min(1, resample[j]))
              dv.setInt16(44 + j * 2, Math.round(v * 32767), true)
            }
            try { ctx.close() } catch (e) { /* ignore */ }
            return readerToBase64(new Uint8Array(wav))
          })
        })
      }

      function readerToBase64(bytes) {
        var s = ''
        var CH = 0x8000
        for (var i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH))
        return 'data:audio/wav;base64,' + btoa(s)
      }

      function enroll(wavBase64) {
        var theName = String(name || '').trim()
        if (!theName) { setMsg('先填要录的人名，再录'); return }
        if (!consented) { setMsg('请先勾选「我同意在本机保存这个人的声纹」再录'); return }
        setBusy(true); setMsg('正在算声纹并保存…')
        fetch('/api/soulmirror/voiceprint-enroll', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          // 同意由用户勾选后显式带上；后端只在 granted=true 时写入同意记录
          body: JSON.stringify({
            name: theName, wav: wavBase64, captureMethod: 'panel-recording',
            consent: { granted: true, noticeVersion: 'v1' },
          }),
        }).then(function (r) { return r.json() }).then(function (j) {
          setBusy(false)
          if (!j || !j.ok) {
            setMsg('没注册成功：' + ((j && (j.message || j.reason)) || '未知原因') + (j && j.hint ? '｜' + j.hint : (j && j.advice ? '｜' + j.advice : '')))
            refresh()
            return
          }
          setMsg('已注册：' + j.personName + ' · ' + j.seconds + ' 秒样本。下次会后就自动认人。')
          setName('')
          refresh()
        }).catch(function (e) { setBusy(false); setMsg('注册失败：' + e.message) })
      }

      /**
       * 「从会议录音添加」的三步：读录音清单 → 读这场的说话人 → 走同一个 enroll 接口。
       * 录音清单只在展开那一刻读，默认折叠不白跑请求。
       */
      function loadFromRecordings() {
        if (typeof fetch !== 'function') { setFromErr('当前环境没有 fetch，读不到录音列表'); return }
        setFromLoading(true); setFromErr('')
        fetch('/api/soulmirror/recordings')
          .then(function (r) { return r.json() })
          .then(function (j) {
            setFromLoading(false)
            if (!j || !j.ok) { setFromErr('读不到录音列表：' + ((j && (j.message || j.error)) || '宿主没有返回数据')); return }
            var rows = []
            var list = Array.isArray(j.recordings) ? j.recordings : []
            for (var i = 0; i < list.length; i++) if (list[i] && list[i].hasAudio === true) rows.push(list[i])
            setFromRecs(rows)
            if (!rows.length) setFromErr('还没有带音频的会议录音：补声纹只能用真正录到声音的会')
          })
          .catch(function (e) { setFromLoading(false); setFromErr('读不到录音列表：' + e.message) })
      }

      function pickFromDir(dir) {
        setFromDir(dir); setFromSpeaker(''); setFromSpeakers([]); setFromMsg('')
        if (!dir || typeof fetch !== 'function') return
        fetch('/api/soulmirror/speakers?dir=' + encodeURIComponent(dir))
          .then(function (r) { return r.json() })
          .then(function (j) {
            if (!j || !j.ok) { setFromErr('读不到这场会的说话人：' + ((j && (j.message || j.error)) || '未知原因')); return }
            setFromErr('')
            setFromSpeakers(Array.isArray(j.speakers) ? j.speakers : [])
          })
          .catch(function (e) { setFromErr('读不到这场会的说话人：' + e.message) })
      }

      function canSubmitFrom() {
        return !!(fromDir && fromSpeaker && String(fromName || '').trim() && fromConsent && !fromBusy)
      }

      function submitFromMeeting() {
        if (fromBusy) return
        var theName = String(fromName || '').trim()
        // 同意是硬门槛：没勾就一个字都不发
        if (!fromConsent) { setFromMsg('没有保存：先勾选「我同意在本机保存这个人的声纹，仅用于会后认人」'); return }
        if (!fromDir) { setFromMsg('没有保存：先在「选会议」里挑一场有录音的会'); return }
        if (!fromSpeaker) { setFromMsg('没有保存：先选这场会里的一个说话人'); return }
        if (!theName) { setFromMsg('没有保存：先填这个人的名字'); return }
        setFromBusy(true); setFromMsg('正在把「' + fromSpeaker + '」的发言存成声纹…')
        fetch('/api/soulmirror/voiceprint-enroll', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          // 与「这场会谁是谁」每行完全同一个请求：dir + speaker + 显式同意
          body: JSON.stringify({
            dir: fromDir, speaker: fromSpeaker, name: theName,
            consent: { granted: true, noticeVersion: 'v1' },
            captureMethod: 'meeting-recording',
          }),
        }).then(function (r) { return r.json() }).then(function (j) {
          setFromBusy(false)
          if (!j || !j.ok) {
            var f = enrollFailText(j)
            setFromMsg('没存成：' + f.text + (f.reason ? '（原因：' + f.reason + '）' : '') + (f.hint ? '｜' + f.hint : ''))
            return
          }
          setFromMsg('已入库：' + j.personName + ' · ' + j.seconds + ' 秒 · ' + j.windows + ' 段窗口')
          setFromName(''); setFromConsent(false)
          refresh()
        }).catch(function (e) { setFromBusy(false); setFromMsg('没存成：' + e.message) })
      }

      function remove(personId, label) {
        // 生物特征数据不做单击即删：第一次点只进入"确认删除"，再点一次才真的删
        if (confirmId !== personId) { setConfirmId(personId || ''); setMsg('再点一次「确认删除」：' + label + ' 的样本会留在本机库供审计，不再参与认人'); return }
        if (busy) return
        setConfirmId('')
        setBusy(true)
        fetch('/api/soulmirror/voiceprint-delete', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify(personId ? { personId: personId } : {}),
        }).then(function (r) { return r.json() }).then(function (j) {
          setBusy(false)
          // 只做软删除（store 保留样本可审计）：文案必须与事实一致，不能说"已从磁盘删除"
          setMsg(j && j.ok
            ? ('已从名册移除：' + label + '。样本仍保留在本机库供审计、不再参与认人；历史纪要不受影响。')
            : ('删除失败：' + ((j && j.error) || '未知原因')))
          refresh()
        }).catch(function (e) { setBusy(false); setMsg('删除失败：' + e.message) })
      }

      function enableVoiceprint() {
        if (busy) return
        setBusy(true); setMsg('正在开启…')
        fetch('/api/soulmirror/config', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ voiceprint: { enabled: true } }),
        }).then(function (r) { return r.json() }).then(function (j) {
          setBusy(false)
          // 只认已落盘后返回的值，不做乐观假设
          var nowOn = !!(j && j.voiceprint && j.voiceprint.enabled === true)
          if (!nowOn) {
            setMsg('没有开启：' + ((j && (j.error || (j.voiceprint ? '宿主要求重启 DSH 后才读得到声纹配置' : ''))) || '配置没有写成'))
            return
          }
          setMsg('已开启本机声纹：会后整理会尝试认出说话人')
          refresh()
        }).catch(function (e) { setBusy(false); setMsg('开启失败：' + e.message) })
      }

      var install = data.install || {}
      var manifestModels = (data.manifest && data.manifest.models) || []
      var chosen = null
      for (var mi = 0; mi < manifestModels.length; mi++) if (manifestModels[mi].id === model.modelId) chosen = manifestModels[mi]
      var installing = !!install.running
      var installLabel = {
        'idle': '空闲', 'resolving': '准备中', 'download-model': '下载模型', 'verify-model': '校验模型',
        'install-model': '模型落盘', 'download-runtime': '下载运行库',
        'verify-runtime': '校验运行库', 'extract-runtime': '解压运行库', 'done': '完成', 'failed': '失败',
      }[install.phase] || install.phase || ''
      var modelMb = chosen ? Math.round(chosen.bytes / 1048576) : 0
      // 体积全部来自清单（/voiceprint 的 runtimeBytes + model.bytes），不在前端写死
      var runtimeMb = data.runtimeBytes ? Math.round(data.runtimeBytes / 1048576) : 0
      var needRuntime = !runtime.usable && !hostRuntimeOk
      // 还缺东西才显示安装区：装好且能用时只留一行状态（避免常驻大按钮）
      var needInstall = !model.installed || needRuntime || installing
      var modelLine = model.installed
        ? '模型已就绪：' + model.modelId + '（' + model.dim + ' 维）' + (runtime.usable || hostRuntimeOk ? ' · 运行库 ' + (runtime.usable ? ((runtime.backend || '') + ' ' + (runtime.version || '')) : '宿主自带') : ' · 运行库还没装好')
        : '声纹模型未安装：会后整理会跳过认人，说话人保持匿名。' + (model.reason ? '原因：' + model.reason + (model.hint ? '｜' + model.hint : '') : '')

      function startInstall() {
        if (busy || installing) return
        setBusy(true); setMsg('开始安装…')
        fetch('/api/soulmirror/voiceprint-install', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ modelId: model.modelId || (chosen && chosen.id), withRuntime: needRuntime }),
        }).then(function (r) { return r.json() }).then(function (j) {
          setBusy(false)
          var st = (j && j.install) || {}
          if (j && j.install) setData(Object.assign({}, data, { install: j.install, runtime: j.runtime || data.runtime }))
          // 后端立刻返回 started：真正的下载在后台跑，进度靠轮询读（不再等整个 135MB）
          if (j && j.started) {
            setMsg('已开始安装' + (st.stepsTotal ? '：第 ' + (st.step || 1) + '/' + st.stepsTotal + ' 步 · ' + (st.stepLabel || '') : '')
              + '，进度会自动刷新')
            return
          }
          if (j && j.ok && st.phase === 'done') { setMsg('安装完成，自检通过'); refresh(); return }
          setMsg(st.phase === 'idle'
            ? '已取消（临时文件已清理，可以重新安装）'
            : ('没装成：' + ((j && (j.error || st.error)) || '未知原因')))
          refresh()
        }).catch(function (e) { setBusy(false); setMsg('安装失败：' + e.message) })
      }

      function cancelInstall() {
        setMsg('正在取消…（已下载的部分会被清理）')
        fetch('/api/soulmirror/voiceprint-install-cancel', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
          .then(function (r) { return r.json() }).then(function (j) {
            if (j && j.install) setData(Object.assign({}, data, { install: j.install }))
            if (j && !j.ok) setMsg(j.message || '现在没有在装')
          })
          .catch(function (e) { setMsg('取消失败：' + e.message) })
      }

      function openModelDir() {
        var p = (model.file && model.file.path) || ''
        if (!p) { setMsg('宿主没返回模型路径：重启 DSH 后再试'); return }
        setMsg('正在打开模型目录…')
        fetch('/api/soulmirror/open-path', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ path: p, reveal: true }),
        }).then(function (r) { return r.json() }).then(function (j) {
          setMsg(j && j.ok ? '已在文件夹中定位模型文件' : ('打不开：' + ((j && j.error) || '未知原因')))
        }).catch(function (e) { setMsg('打不开：' + e.message) })
      }

      // 「从会议录音添加」的下拉选项在渲染前算好：嵌套太深容易漏括号，也便于测试读文案
      var fromMeetingOptions = (fromRecs || []).map(function (rec) {
        var when = rec.startedAt ? recTime(rec.startedAt) : (rec.title || recBaseName(rec.dir))
        return h('option', { key: rec.dir, value: rec.dir }, when + ' · ' + recDuration(rec.seconds) + ' · ' + recBaseName(rec.dir))
      })
      var fromSpeakerOptions = (fromSpeakers || []).map(function (sp) {
        return h('option', { key: sp.label, value: sp.label },
          sp.label + '（' + sp.sentences + ' 句 · ' + Math.round(Number(sp.seconds) || 0) + ' 秒' + (sp.hasPrint ? ' · 已在声纹库' : '') + '）')
      })
      var canRecord = usable && consented
      var recordLabel = recording ? ('结束录音（' + elapsed + ' 秒）') : (usable ? ('录一段注册（≥' + minSeconds + ' 秒）') : '先装模型才能录声纹')
      return h('section', {
        'aria-label': '本机声纹库',
        id: 'sm-voiceprint-card',
        tabIndex: -1,
        ref: secRef,
        style: { border: '1px solid ' + T.border, borderRadius: 8, padding: '10px 12px', marginBottom: 12, outline: 'none' },
      },
        h('div', { style: S.rowBetween },
          h('span', { style: { fontWeight: 600 } }, '我认识的人 · 本机声纹'),
          h('span', { style: S.note }, people.length + ' 人 · ' + ((data.stats && data.stats.samples) || 0) + ' 个样本')),
        h('div', { style: Object.assign({}, S.note, { marginTop: 4 }) }, '录一次，以后每场会都能认出这个人'),
        h('div', { role: 'status', style: Object.assign({}, S.note, { marginTop: 2 }) }, '模型在本机运行；声纹不外传，音频不上传云端'),
        !vpEnabled ? h('div', { role: 'status', style: { marginTop: 6, borderLeft: '3px solid ' + T.warn, paddingLeft: 8 } },
          h('div', null, '本机声纹现在是关的：会后整理会跳过认人（已录的声纹不会丢，开启后继续可用）'),
          h('button', { type: 'button', style: Object.assign({}, S.btn, { height: 24, marginTop: 4 }), disabled: busy, onClick: enableVoiceprint }, '开启本机声纹')) : null,
        h('div', { role: 'status', style: Object.assign({}, S.note, { marginTop: 4, color: model.installed ? T.muted : T.warn }) }, modelLine),
        needInstall ? h('div', { style: { marginTop: 8 } },
          // 为什么要装 / 能不能不装 / 联网范围：固定在按钮上方，失败与成功态都保留
          h('div', { style: Object.assign({}, S.note, { marginBottom: 4 }) }, '装好后，会后整理多一步「认出说话人」'),
          h('div', { style: S.note }, '不装也能用：说话人保持编号，纪要不写名字'),
          h('div', { style: S.note }, '只有安装要联网下载；声纹计算全在本机'),
          h('div', { style: { display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginTop: 6 } },
            h('button', { type: 'button', style: Object.assign({}, S.btnPrimary, { height: 28 }), disabled: busy || installing, onClick: startInstall },
              installing ? '正在安装…' : ('一键安装' + (chosen ? '（模型 ' + modelMb + ' MB' : '') + (needRuntime ? ' + 运行库' + (runtimeMb ? ' ' + runtimeMb + ' MB' : '') : '') + '）')),
            installing ? h('button', { type: 'button', style: Object.assign({}, S.btn, { height: 28 }), onClick: cancelInstall }, '取消') : null,
            h('span', { style: S.note }, '全部下载带 sha256/sha512 校验；只有校验通过才会落盘')),
          installing || install.phase === 'failed' || install.phase === 'done' ? h('div', { style: { marginTop: 6 } },
            h('div', { style: { display: 'flex', justifyContent: 'space-between', fontSize: 11, color: T.muted } },
              h('span', null, installLabel + (install.stepsTotal > 1 ? '（第 ' + (install.step || 1) + '/' + install.stepsTotal + ' 步）' : '') + (install.message ? ' · ' + install.message : '')),
              h('span', null, (install.percent || 0) + '%')),
            h('div', { role: 'progressbar', 'aria-valuenow': install.percent || 0, 'aria-valuemin': 0, 'aria-valuemax': 100, style: { height: 6, background: T.bg2, borderRadius: 3, marginTop: 4, overflow: 'hidden' } },
              h('div', { style: { width: (install.percent || 0) + '%', height: '100%', background: install.phase === 'failed' ? T.err : T.brand, transition: 'width .2s' } }))) : null,
          install.phase === 'failed' && install.error ? h('div', { role: 'alert', style: Object.assign({}, S.note, { color: T.err, marginTop: 4 }) },
            '安装失败：' + install.error, install.hint ? h('div', { style: S.note }, install.hint) : null) : null,
          !model.installed && !installing ? h('div', { style: { marginTop: 4 } },
            h('div', { style: Object.assign({}, S.note, { overflowWrap: 'anywhere' }) },
              '也可以自己放模型文件：' + ((model.file && model.file.path) || '<数据目录>/voiceprint/models/')),
            h('button', { type: 'button', style: Object.assign({}, S.btn, { height: 24, marginTop: 4 }), onClick: openModelDir }, '打开模型目录')) : null) : null,
        (data.staleSpaces || []).length ? h('div', { role: 'alert', style: Object.assign({}, S.note, { color: T.warn }) },
          '有 ' + data.staleSpaces.map(function (x) { return x.samples + ' 个样本属于旧模型 ' + x.modelId }).join('、') + '，换模型后不能再用，需要重新录。') : null,
        h('div', { style: { marginTop: 8 } },
          // 朗读文本就在录音按钮上方：看得见、读得顺，才知道这 10 秒该说什么。
          // 录音中整块高亮，并只显示**真实已录秒数**（没有进度百分比）。
          current ? h('div', {
            'aria-label': '录声纹时读的这段',
            style: {
              border: '1px solid ' + (recording ? T.brand : T.border),
              background: recording ? (T.bg2 || 'transparent') : 'transparent',
              borderRadius: 6, padding: '8px 10px', marginBottom: 8,
            },
          },
            h('div', { style: { fontSize: 15, lineHeight: 1.75, letterSpacing: 0.3, color: T.text, userSelect: 'text' } }, String(current.text || '')),
            h('div', { style: Object.assign({}, S.note, { marginTop: 4 }) },
              '这段约 ' + (Number(current.estimateSeconds) || 0) + ' 秒 · 说满 ' + minSeconds + ' 秒才能注册'
              + (recording ? ' · 已录 ' + elapsed + ' 秒' : '')),
            h('button', {
              type: 'button',
              style: Object.assign({}, S.btn, { height: 24, marginTop: 6 }),
              disabled: recording || busy,
              onClick: nextPassage,
            }, '换一段'))
            : h('div', { style: Object.assign({}, S.note, { marginBottom: 8 }) },
              '朗读文本没有下发（宿主版本可能较旧）：重启 DSH 后再试。'),
          h('label', { style: Object.assign({}, S.note, { display: 'flex', alignItems: 'center', gap: 6 }) },
            h('input', {
              type: 'checkbox', checked: consented, disabled: busy || recording,
              'aria-label': '同意在本机保存声纹',
              onChange: function (e) { setConsented(!!(e.target && e.target.checked)) },
            }),
            '我同意在本机保存这个人的声纹，仅用于会后认人'),
          h('div', { style: { display: 'flex', gap: 6, alignItems: 'center', marginTop: 4, flexWrap: 'wrap' } },
            h('input', { 'aria-label': '要注册的人名', list: 'sm-people-vp', value: name, placeholder: '人名（如：李亚峰）', disabled: busy || recording,
              onChange: function (e) { setName(e.target.value) }, style: Object.assign({}, S.field, { width: 150 }) }),
            h('button', { type: 'button', 'aria-disabled': canRecord || recording ? 'false' : 'true', style: Object.assign({}, usable ? S.btnPrimary : S.btn, { height: 28, opacity: canRecord || recording ? 1 : 0.6 }), disabled: busy || (!recording && !canRecord), onClick: startRecording },
              recordLabel),
            h('span', { style: S.note }, '音频只用来算向量，原始录音不保存；模型与声纹都在本机，音频不上传云端')),
          !usable ? h('div', { style: Object.assign({}, S.note, { color: T.warn, marginTop: 4 }) },
            '录音按钮已禁用：' + (data.notReadyHint || '先装模型/运行库，避免说满 12 秒才发现用不了'))
            : (!consented ? h('div', { style: Object.assign({}, S.note, { color: T.warn, marginTop: 4 }) }, '录音按钮已禁用：先勾选上面的同意') : null)),
        msg ? h('div', { role: 'status', style: Object.assign({}, S.note, { marginTop: 6 }) }, msg) : null,
        people.length ? h('div', { style: { marginTop: 10 } }, people.map(function (p) {
          var confirming = confirmId === p.personId
          return h('div', { key: p.personId, style: { display: 'flex', gap: 8, alignItems: 'center', padding: '6px 0', borderTop: '1px solid ' + T.border } },
            h('span', { style: { flex: 1, fontWeight: 600, fontSize: 12 } }, p.displayName),
            h('span', { style: S.note }, p.samples + ' 个样本 · ' + p.seconds + ' 秒'),
            h('button', { type: 'button', style: Object.assign({}, confirming ? S.btnPrimary : S.btn, { height: 24 }), disabled: busy, onClick: function () { remove(p.personId, p.displayName) } },
              confirming ? '确认删除' : '删除'))
        })) : h('div', { style: Object.assign({}, S.note, { marginTop: 10 }) }, '还没有录过人。录一次以后，会后整理就能把说话人认成名字。'),
        // 给以前的会补声纹：默认折叠，展开时才去读录音清单；与名册每行的「存成声纹」走同一个接口
        h('details', {
          style: { marginTop: 10, borderTop: '1px dashed ' + T.border, paddingTop: 6 },
          onToggle: function (e) {
            var isOpen = !!(e && e.target && e.target.open)
            if (isOpen && !fromRecs && !fromLoading) loadFromRecordings()
          },
        },
          h('summary', { style: { cursor: 'pointer', color: T.muted, fontSize: 12 } }, '从会议录音添加（给以前的会补声纹）'),
          h('div', { style: { marginTop: 6, display: 'flex', flexDirection: 'column', gap: 4 } },
            h('div', { style: S.note }, '用这场会里这个人的干净发言算声纹；只存向量，音频不保留'),
            fromLoading ? h('div', { role: 'status', style: S.note }, '正在读取录音列表…') : null,
            fromErr ? h('div', { role: 'status', style: Object.assign({}, S.note, { color: T.warn }) }, fromErr) : null,
            fromRecs && fromRecs.length
              ? h('div', { style: S.formRow },
                h('span', { style: S.formLabel }, '选会议'),
                h('select', {
                  'aria-label': '要补声纹的会议',
                  value: fromDir,
                  disabled: fromBusy,
                  onChange: function (e) { pickFromDir(e.target.value) },
                  style: Object.assign({}, S.field, { width: 190 }),
                },
                  h('option', { value: '' }, '选一场有录音的会'),
                  fromMeetingOptions))
              : null,
            fromDir
              ? h('div', { style: S.formRow },
                h('span', { style: S.formLabel }, '选说话人'),
                h('select', {
                  'aria-label': '要补声纹的说话人',
                  value: fromSpeaker,
                  disabled: fromBusy,
                  onChange: function (e) { setFromSpeaker(e.target.value); setFromMsg('') },
                  style: Object.assign({}, S.field, { width: 190 }),
                },
                  h('option', { value: '' }, fromSpeakers.length ? '选这场会里的一个人' : '这场会还没分出说话人'),
                  fromSpeakerOptions))
              : null,
            fromDir ? h('div', { style: S.formRow },
              h('span', { style: S.formLabel }, '姓名'),
              h('input', {
                'aria-label': '从会议录音入库的人名',
                value: fromName,
                placeholder: '人名（如：李亚峰）',
                disabled: fromBusy,
                onChange: function (e) { setFromName(e.target.value) },
                style: Object.assign({}, S.field, { width: 150 }),
              })) : null,
            fromDir ? h('label', { style: Object.assign({}, S.note, { display: 'flex', alignItems: 'center', gap: 6 }) },
              h('input', {
                type: 'checkbox', checked: fromConsent, disabled: fromBusy,
                'aria-label': '同意在本机保存声纹（从会议录音）',
                onChange: function (e) { setFromConsent(!!(e.target && e.target.checked)) },
              }),
              '我同意在本机保存这个人的声纹，仅用于会后认人') : null,
            fromDir ? h('div', { style: { display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' } },
              h('button', {
                type: 'button',
                'aria-label': '保存从会议录音入库的声纹',
                style: Object.assign({}, canSubmitFrom() ? S.btnPrimary : S.btn, { height: 26, opacity: canSubmitFrom() ? 1 : 0.6 }),
                disabled: !canSubmitFrom(),
                onClick: submitFromMeeting,
              }, fromBusy ? '正在保存…' : '保存'),
              !fromConsent ? h('span', { style: Object.assign({}, S.note, { color: T.warn }) }, '保存已禁用：先勾选上面的同意')
                : (!String(fromName || '').trim() ? h('span', { style: Object.assign({}, S.note, { color: T.warn }) }, '先填这个人的名字') : null)) : null,
            fromMsg ? h('div', {
              role: 'status',
              style: Object.assign({}, S.note, { marginTop: 2, color: fromMsg.indexOf('已入库：') === 0 ? T.ok : (fromMsg.indexOf('没存成：') === 0 || fromMsg.indexOf('没有保存：') === 0 ? T.warn : T.muted) }),
            }, fromMsg) : null)),
        // 声纹库的人 ≠ 名册的人：这里只列出**已入库**的人，名册那边另有自己的清单
        h('datalist', { id: 'sm-people-vp' }, (data.people || []).map(function (p) { return h('option', { key: p.personId, value: p.displayName }) })))
    }

    /**
     * 说话人名册：云端识别能分人，但只给"说话人1/2/3"，不会告诉你这是谁。
     * 这里让用户把编号映射成姓名，写进这场会的 speaker-map.json；
     * 保存后重新整理纪要，正文里就会出现真实姓名（没有映射就不编造）。
     */
    function SpeakersCard(props) {
      var h = React.createElement
      var v = (props && props.view) || {}
      var runDir = v.run && v.run.dir || ''
      var ds = React.useState(null), data = ds[0], setData = ds[1]
      var es = React.useState({}), edits = es[0], setEdits = es[1]
      var ms = React.useState(''), msg = ms[0], setMsg = ms[1]
      var bs = React.useState(false), busy = bs[0], setBusy = bs[1]
      var dsRef = React.useRef('')
      // 「存成声纹」的行内表单：一次只展开一行（存 label），同意是硬门槛。
      // 全部 hook 必须在下面两个提前 return 之前（tests/hooks-order）。
      var eo = React.useState(''), enrollOpen = eo[0], setEnrollOpen = eo[1]
      var en = React.useState(''), enrollName = en[0], setEnrollName = en[1]
      var ec = React.useState(false), enrollConsent = ec[0], setEnrollConsent = ec[1]
      var eb = React.useState(false), enrollBusy = eb[0], setEnrollBusy = eb[1]
      var er = React.useState({}), enrollResult = er[0], setEnrollResult = er[1]
      // 刚入库的行：接口成功后 speakers.json 不一定立刻带上名字，界面先记住这次事实
      var ep = React.useState({}), enrollPrints = ep[0], setEnrollPrints = ep[1]
      React.useEffect(function () {
        if (!runDir) return
        var alive = true
        // 只有**换了会议目录**时才清空用户已编辑但未保存的名字。
        // 会后整理期间 durableSeq 每秒都变；以前跟着清空，用户正在打字就被吃了。
        var newRun = dsRef.current !== runDir
        dsRef.current = runDir
        fetch('/api/soulmirror/speakers?dir=' + encodeURIComponent(runDir))
          .then(function (r) { return r.json() })
          .then(function (j) {
            if (!(alive && j && j.ok)) return
            setData(j)
            if (newRun) setEdits({})
          })
          .catch(function (e) { if (alive) setMsg('读不到说话人：' + e.message) })
        return function () { alive = false }
      }, [runDir, v.durableSeq])
      if (!runDir) {
        return h('section', { 'aria-label': '说话人名册', style: { border: '1px solid ' + T.border, borderRadius: 8, padding: '10px 12px', marginBottom: 12 } },
          h('div', { style: { fontWeight: 600 } }, '这场会谁是谁'),
          h('div', { style: Object.assign({}, S.note, { marginTop: 4 }) }, '这场会还没有转写结果，整理后才能填名字。'))
      }
      var speakers = (data && data.speakers) || []
      if (!data) return h('div', { style: S.note }, '正在读取这场会的说话人…')
      if (!speakers.length) return h('div', { style: S.note }, '这场会没有分出说话人（单人会议或云端未返回）。')
      function nameOf(sp) { return edits[sp.label] !== undefined ? edits[sp.label] : (sp.name || '') }
      function save(sp) {
        if (busy) return
        setBusy(true); setMsg('正在保存…')
        fetch('/api/soulmirror/speakers', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ dir: runDir, label: sp.label, name: nameOf(sp) }),
        }).then(function (r) { return r.json() }).then(function (j) {
          setBusy(false)
          if (!j || !j.ok) { setMsg('保存失败：' + ((j && j.error) || '未知原因')); return }
          // 名册变了：来源标记也应跟着变（先落盘后展示，重新读一次接口）
          setMsg('已保存。点「用录音重新整理」后，纪要里就会用这些名字。')
          if (typeof fetch === 'function') fetch('/api/soulmirror/speakers?dir=' + encodeURIComponent(runDir))
            .then(function (r2) { return r2.json() })
            .then(function (j2) { if (j2 && j2.ok) setData(j2) })
            .catch(function () {})
        }).catch(function (e) { setBusy(false); setMsg('保存失败：' + e.message) })
      }
      // 重新读一次名册：入库成功后 hasPrint/autoName 可能已经变了（先落盘后展示，不猜）
      function refreshSpeakers() {
        if (typeof fetch !== 'function') return
        fetch('/api/soulmirror/speakers?dir=' + encodeURIComponent(runDir))
          .then(function (r) { return r.json() })
          .then(function (j) { if (j && j.ok) setData(j) })
          .catch(function () {})
      }
      function putRowMsg(label, text, isErr) {
        var next = {}
        next[label] = { text: text, err: !!isErr }
        setEnrollResult(Object.assign({}, enrollResult, next))
      }
      /**
       * 展开一行的「存成声纹」表单。
       * 姓名默认用这行已有的名字；没有就用自动认出的名字（autoName）。
       * 同意每次都重新勾：绝不把上一个人的同意沿用到下一个人。
       */
      function openEnroll(sp) {
        var def = String(sp.name || '').trim() || String(sp.autoName || '').trim()
        setEnrollOpen(sp.label)
        setEnrollName(def)
        setEnrollConsent(false)
        setEnrollBusy(false)
      }
      function closeEnroll() {
        setEnrollOpen(''); setEnrollName(''); setEnrollConsent(false); setEnrollBusy(false)
      }
      function submitEnroll(sp) {
        if (enrollBusy) return
        var theName = String(enrollName || '').trim()
        // 同意是硬门槛：没勾就一个字都不发（不靠后端兜底）
        if (!enrollConsent) { putRowMsg(sp.label, '没有保存：先勾选「我同意在本机保存这个人的声纹，仅用于会后认人」', true); return }
        if (!theName) { putRowMsg(sp.label, '没有保存：先填这个人的名字（会显示在「我认识的人」里）', true); return }
        setEnrollBusy(true)
        putRowMsg(sp.label, '正在把「' + sp.label + '」的发言存成声纹…', false)
        fetch('/api/soulmirror/voiceprint-enroll', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          // dir + speaker：宿主按这场会的录音切这个人的证据窗；consent 必须显式 granted
          body: JSON.stringify({
            dir: runDir, speaker: sp.label, name: theName,
            consent: { granted: true, noticeVersion: 'v1' },
            captureMethod: 'meeting-recording',
          }),
        }).then(function (r) { return r.json() }).then(function (j) {
          setEnrollBusy(false)
          if (!j || !j.ok) {
            var f = enrollFailText(j)
            putRowMsg(sp.label, '没存成：' + f.text + (f.reason ? '（原因：' + f.reason + '）' : '') + (f.hint ? '｜' + f.hint : ''), true)
            return
          }
          var printed = {}
          printed[sp.label] = String(j.personName || theName)
          setEnrollPrints(Object.assign({}, enrollPrints, printed))
          putRowMsg(sp.label, '已入库：' + j.personName + ' · ' + j.seconds + ' 秒 · ' + j.windows + ' 段窗口', false)
          setEnrollOpen(''); setEnrollName(''); setEnrollConsent(false)
          refreshSpeakers()
        }).catch(function (e) { setEnrollBusy(false); putRowMsg(sp.label, '没存成：' + e.message, true) })
      }
      var has = function (sp) { var n = nameOf(sp); return !!(n && String(n).trim()) }
      var idn = (data && data.identity) || null
      // 没有可用录音（宿主 /status 的 recording.ok === false）：按钮直接禁用并说明原因，不让人白点
      var recInfo = (v && v.recording) || null
      var audioMissing = !!(recInfo && recInfo.ok === false)
      var audioReason = recInfo ? String(recInfo.message || recInfo.hint || recInfo.reason || '这场会没有可用的录音') : ''
      return h('section', { 'aria-label': '说话人名册', style: { border: '1px solid ' + T.border, borderRadius: 8, padding: '10px 12px', marginBottom: 12 } },
        h('div', { style: S.rowBetween },
          h('span', { style: { fontWeight: 600 } }, '这场会谁是谁'),
          h('span', { style: S.note }, speakers.length + ' 位 · 已命名 ' + speakers.filter(has).length
            + (idn ? ' · 认出 ' + idn.assigned + '/' + idn.total : ''))),
        h('div', { style: Object.assign({}, S.note, { marginTop: 4 }) }, '填名字只对这场会有效，不建立声纹；想让下次会也认出这个人，点右边「存成声纹」（勾选同意后才会存）'),
        audioMissing ? h('div', { role: 'status', style: Object.assign({}, S.note, { color: T.warn, marginTop: 2 }) }, '「存成声纹」已禁用：' + audioReason) : null,
        h('div', { style: Object.assign({}, S.note, { marginTop: 2 }) },
          '云端识别只能分出"说话人' + '1/2/3"，不会说明这是谁，也不返回声纹；'
          + '「谁在说话」只能靠这里填一次名字，纪要正文才会写姓名，不填就保持匿名，不会编造。'),
        h('div', { style: Object.assign({}, S.note, { marginTop: 2, fontWeight: 600 }) }, '我填的优先，自动认出的不会覆盖；保存后点「用录音重新整理」生效。'),
        data.printsError ? h('div', { role: 'status', style: Object.assign({}, S.note, { color: T.warn }) }, data.printsError) : null,
        speakers.map(function (sp, i) {
          var autoName = String(sp.autoName || '')
          var reasonText = String(sp.reasonText || '')
          var tag = sp.source === 'auto'
            ? { text: '自动认出', color: T.brand }
            : sp.source === 'manual' ? { text: '我填的', color: T.muted } : null
          var printTag = sp.hasPrint
            ? null
            : (has(sp) ? { text: '无本机声纹', color: T.muted } : null)
          var enrolling = enrollOpen === sp.label
          var inLibrary = !!(sp.hasPrint || enrollPrints[sp.label])
          var enrollNameEmpty = !String(enrollName || '').trim()
          var canEnroll = !enrollNameEmpty && enrollConsent && !enrollBusy
          var rowMsg = enrollResult[sp.label] || null
          return h('div', { key: sp.label, style: { padding: '7px 0', borderTop: '1px solid ' + T.border } },
            h('div', { style: { display: 'flex', gap: 8, alignItems: 'center' } },
              h('div', { style: { flex: 1, minWidth: 0 } },
                h('div', { style: { fontWeight: 600, fontSize: 12, display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' } },
                  h('span', null, sp.label),
                  tag ? h('span', { style: { fontSize: 10, fontWeight: 600, color: tag.color } }, tag.text) : null,
                  printTag ? h('span', { style: { fontSize: 10, color: printTag.color } }, printTag.text) : null),
                h('div', { style: S.note }, sp.sentences + ' 句 · ' + Math.round(sp.seconds) + ' 秒' + (sp.sample ? ' · ' + String(sp.sample).slice(0, 24) : '')),
                // 没认出来的原因（人话，由宿主按 speakers.json 的 reason+detail 生成）
                reasonText ? h('div', { style: Object.assign({}, S.note, { color: T.warn }) }, '未认出：' + reasonText) : null,
                autoName && sp.source === 'manual' && autoName !== nameOf(sp)
                  ? h('div', { style: S.note }, '自动认出的是「' + autoName + '」，被你填的名字覆盖了') : null),
              h('input', {
                'aria-label': '给' + sp.label + '填姓名',
                list: 'sm-people-map',
                value: nameOf(sp),
                placeholder: '填姓名（可留空）',
                disabled: busy,
                onChange: function (e) { var n = {}; n[sp.label] = e.target.value; setEdits(Object.assign({}, edits, n)) },
                style: Object.assign({}, S.field, { width: 140 }),
              }),
              h('button', { type: 'button', style: Object.assign({}, S.btn, { height: 26 }), disabled: busy, onClick: function () { save(sp) } }, '保存'),
              // 已入库：静态标签（不可点）；没入库且这场会有音频：可以就地存成声纹
              inLibrary
                ? h('span', {
                  'aria-label': sp.label + '已在声纹库',
                  style: { fontSize: 10, color: T.ok, flex: '0 0 auto', border: '1px solid ' + T.border, borderRadius: 4, padding: '0 5px', lineHeight: '18px' },
                  title: '这个人的声纹已在本机库：下次会后整理会自动认出',
                }, '已在声纹库')
                : h('button', {
                  type: 'button',
                  'aria-label': '把' + sp.label + '的发言存成声纹',
                  style: Object.assign({}, S.btn, { height: 26, flex: '0 0 auto' }),
                  disabled: busy || enrollBusy || audioMissing,
                  title: audioMissing
                    ? ('「存成声纹」已禁用：' + audioReason)
                    : '用这场会里这个人的干净发言算声纹；下次会后整理就能认出这个人',
                  onClick: function () { if (enrolling) closeEnroll(); else openEnroll(sp) },
                }, enrolling ? '收起' : '存成声纹')),
            // 行内展开的小表单（不弹窗）：姓名 + 同意 + 保存/取消
            enrolling ? h('div', { style: { marginTop: 6, padding: '6px 8px', border: '1px solid ' + T.border, borderRadius: 8, background: T.bg2, display: 'flex', flexDirection: 'column', gap: 4 } },
              h('div', { style: Object.assign({}, S.note, { fontWeight: 600, color: T.text }) }, '把「' + sp.label + '」在这场的发言存成声纹'),
              h('div', { style: S.note }, '只存向量，音频不保留；下次会后整理就能认出这个人'),
              h('input', {
                'aria-label': '要存成声纹的人名',
                value: enrollName,
                placeholder: '人名（如：李亚峰）',
                disabled: enrollBusy,
                onChange: function (e) { setEnrollName(e.target.value) },
                style: Object.assign({}, S.field, { width: 200, maxWidth: '100%' }),
              }),
              h('label', { style: Object.assign({}, S.note, { display: 'flex', alignItems: 'center', gap: 6 }) },
                h('input', {
                  type: 'checkbox', checked: enrollConsent, disabled: enrollBusy,
                  'aria-label': '同意在本机保存' + sp.label + '的声纹',
                  onChange: function (e) { setEnrollConsent(!!(e.target && e.target.checked)) },
                }),
                '我同意在本机保存这个人的声纹，仅用于会后认人'),
              h('div', { style: { display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' } },
                h('button', {
                  type: 'button',
                  'aria-label': '保存' + sp.label + '的声纹',
                  style: Object.assign({}, canEnroll ? S.btnPrimary : S.btn, { height: 26, opacity: canEnroll ? 1 : 0.6 }),
                  disabled: !canEnroll,
                  onClick: function () { submitEnroll(sp) },
                }, enrollBusy ? '正在保存…' : '保存'),
                h('button', { type: 'button', 'aria-label': '取消存成声纹', style: Object.assign({}, S.btn, { height: 26 }), disabled: enrollBusy, onClick: closeEnroll }, '取消')),
              !enrollConsent ? h('div', { role: 'status', style: Object.assign({}, S.note, { color: T.warn }) }, '保存已禁用：先勾选「我同意在本机保存这个人的声纹」') : null,
              enrollNameEmpty ? h('div', { role: 'status', style: Object.assign({}, S.note, { color: T.warn }) }, '先填这个人的名字（会显示在「我认识的人」里）') : null,
              audioMissing ? h('div', { role: 'status', style: Object.assign({}, S.note, { color: T.warn }) }, '这场会没有可用录音，存成声纹会被禁用：' + audioReason) : null) : null,
            rowMsg && rowMsg.text
              ? h('div', { role: 'status', style: Object.assign({}, S.note, { marginTop: 4, color: rowMsg.err ? T.err : T.ok }) }, rowMsg.text)
              : null)
        }),
        // 名册的提示来自"本机人名清单"（people.json），与声纹库的提示是两份
        h('datalist', { id: 'sm-people-map' }, ((data && data.people) || []).map(function (n) { return h('option', { key: n, value: n }) })),
        msg ? h('div', { role: 'status', style: Object.assign({}, S.note, { marginTop: 6 }) }, msg) : null)
    }

    /**
     * 「之前的录音」：选一场旧会议或粘贴本机音频路径（输入框有 placeholder），点「导入并整理」，
     * 走同一套会后整理。列表来自 GET /api/soulmirror/recordings（unsupportedCount / hasAudio 决定按钮），
     * 导入或重整走 POST /api/soulmirror/import-recording；无音频时显示宿主给的提示（hint），不显示必败按钮。
     */
    // ── 历史录音清单与导入（纯展示，状态来自宿主）──
    function recTime(iso) {
      if (!iso) return ''
      var d = new Date(iso)
      if (isNaN(d.getTime())) return ''
      return d.toLocaleString()
    }
    function recDuration(seconds) {
      var n = Math.max(0, Math.round(Number(seconds) || 0))
      return Math.floor(n / 60) + ' 分 ' + (n % 60) + ' 秒'
    }
    function recSize(bytes) {
      var n = Math.max(0, Number(bytes) || 0)
      if (n >= 1048576) return (n / 1048576).toFixed(1) + ' MB'
      return Math.round(n / 1024) + ' KB'
    }
    /**
     * 「之前的录音」：把历史会议录音与导入的音频文件接进同一套会后整理。
     *
     * 状态只来自两处磁盘事实：/recordings（目录扫描）与 /status（已落盘事件投影）。
     * 「整理中」显示的是真实的当前步骤，不做本地进度动画，也不猜百分比。
     */
    /**
     * 「之前的录音」顶部的位置说明：列表是默认位置 + 自定义位置**合并**的，
     * 换保存位置不会让旧会议消失；配置失效时这里也要说清"已回退"。
     *
     * 放在组件外：卡片本身已经很挤，这段逻辑单独一份，两个位置（列表头 / 说明）共用。
     */
    function recRootLine(h, data) {
      var storage = (data && data.storage) || null
      if (!storage) return null
      var text = ''
      var tone = T.muted
      if (storage.fallback) {
        text = '配置的保存位置不可用，已回退到默认位置：' + (storage.message || '原因见「保存位置」卡') + (storage.hint ? '｜' + storage.hint : '')
        tone = T.warn
      } else if (storage.custom) {
        var n = Number((data && data.byRoot && data.byRoot['default']) || 0)
        text = '新会议写到自定义位置 ' + storage.recordsRoot + '；已有 ' + n + ' 场仍在默认位置，仍可查看与整理（列表合并显示）'
      } else {
        text = '会议保存位置：' + storage.recordsRoot + '（可在「保存位置」卡里改）'
      }
      return h('div', { role: 'status', style: Object.assign({}, S.note, { color: tone }) }, text)
    }
    /** 某条记录在自定义保存位置时的标记（默认位置不加噪音） */
    function recRootTag(h, rec) {
      return rec && rec.root === 'custom' ? h('span', { style: Object.assign({}, S.tag, { color: T.brand }) }, '自定义位置') : null
    }

    function RecordingsCard() {
      var h = React.createElement
      var STEP_TEXT = { offline: '整段转写', identify: '认出说话人', minutes: '生成纪要', knowledge: '写入知识库', persona: '更新画像' }
      var ls = React.useState(null), data = ls[0], setData = ls[1]
      var ms = React.useState(''), msg = ms[0], setMsg = ms[1]
      var bs = React.useState(false), busy = bs[0], setBusy = bs[1]
      var bd = React.useState(''), busyDir = bd[0], setBusyDir = bd[1]
      var ps = React.useState(''), pathText = ps[0], setPathText = ps[1]
      var qs = React.useState(null), pending = qs[0], setPending = qs[1]
      var lv = useLive()
      var doneRef = React.useRef('')

      function load() {
        if (typeof fetch !== 'function') return
        fetch('/api/soulmirror/recordings').then(function (r) { return r.json() }).then(function (j) {
          if (j && j.ok) setData(j)
          else setMsg('读不到录音列表：' + ((j && (j.message || j.error)) || '宿主没有返回数据'))
        }).catch(function (e) { setMsg('读不到录音列表：' + e.message) })
      }
      React.useEffect(function () { load() }, [])
      // 整理完成/失败后刷新列表：只认已落盘的事件投影，不靠本地计时
      React.useEffect(function () {
        if (!pending || !lv.journal) return
        var run = (lv.journal.runs || {})[pending] || null
        if (!run || run.phase !== 'done' && run.phase !== 'error') return
        if (doneRef.current === pending + ':' + run.phase) return
        doneRef.current = pending + ':' + run.phase
        setPending(null)
        setMsg(run.phase === 'done' ? '整理完成：纪要已落盘，列表已刷新' : '整理失败：' + (run.error || '原因见事件日志'))
        load()
      }, [lv.durableSeq, lv.journal, pending])

      function failText(j) {
        return ((j && (j.message || j.error)) || '未知原因') + (j && j.hint ? '｜' + j.hint : '')
      }
      function organize(rec) {
        if (busy || !rec) return
        setBusy(true)
        setBusyDir(rec.dir)
        setMsg('已提交：' + (rec.title || ''))
        fetch('/api/soulmirror/import-recording', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ recordDir: rec.dir }),
        }).then(function (r) { return r.json() }).then(function (j) {
          setBusy(false); setBusyDir('')
          if (j && j.ok) { setPending(j.dir); setMsg('已入队整理：' + (rec.title || '') + '（进展来自已落盘事件）'); load() }
          else setMsg('不能整理：' + failText(j))
        }).catch(function (e) { setBusy(false); setBusyDir(''); setMsg('提交失败：' + e.message) })
      }
      function importFile() {
        var p = String(pathText || '').trim()
        if (busy || !p) return
        setBusy(true)
        setMsg('正在导入并整理：' + p)
        fetch('/api/soulmirror/import-recording', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ path: p }),
        }).then(function (r) { return r.json() }).then(function (j) {
          setBusy(false)
          if (j && j.ok) {
            setPending(j.dir)
            setPathText('')
            // 配置的保存位置不可用时宿主写默认根：如实标注，不假装写到了自定义位置
            setMsg('已导入并排队整理：' + Math.round(Number(j.seconds) || 0) + ' 秒 · ' + recSize(j.bytes) + (j.storageFallback ? '（已回退默认位置）' : ''))
            load()
          } else setMsg('导入失败：' + failText(j))
        }).catch(function (e) { setBusy(false); setMsg('导入失败：' + e.message) })
      }

      var list = (data && data.recordings) || []
      if (!data) return h('div', { style: S.note }, '正在读取录音列表…')
      var queue = (lv && lv.pipelineQueue) || {}
      var cur = queue.current || null
      var pendingRun = pending && lv.journal && lv.journal.runs ? (lv.journal.runs[pending] || null) : null
      var pendingText = ''
      if (cur && pending && cur.dir === pending) pendingText = '正在整理：' + (STEP_TEXT[cur.step] || cur.step || '处理中')
      else if (pendingRun) {
        pendingText = '这一场：' + (pendingRun.phase === 'running' ? ('整理中 · ' + (STEP_TEXT[pendingRun.step] || pendingRun.step || '')) : pendingRun.phase === 'queued' ? '排队中' : pendingRun.phase === 'done' ? '已完成' : pendingRun.phase === 'error' ? ('失败 · ' + (pendingRun.error || '')) : '等待')
        if (pendingRun.stepDetail) pendingText = pendingText + '（' + pendingRun.stepDetail + '）'
      }
      function row(rec) {
        var canOrganize = !!rec.hasAudio && !rec.reason
        return h('div', { key: rec.dir, style: { display: 'flex', flexDirection: 'column', gap: 3, padding: '8px 0', borderBottom: '1px solid ' + T.border } },
          h('div', { style: { display: 'flex', gap: 6, alignItems: 'center', minWidth: 0 } },
            h('span', { title: rec.dir, style: { fontSize: 12, fontWeight: 600, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, rec.title || rec.dir),
            rec.kind === 'import' ? h('span', { style: Object.assign({}, S.tag, { color: T.brand }) }, '导入') : null,
            recRootTag(h, rec),
            rec.hasAudio === false ? h('span', { style: Object.assign({}, S.tag, { color: T.warn }) }, '没有音频') : null,
            rec.hasMinutes ? h('span', { style: S.tag }, '已有纪要') : h('span', { style: S.tag }, '未整理')),
          h('div', { style: S.note }, (recTime(rec.startedAt || rec.endedAt) || '时间未知') + (rec.seconds ? ' · ' + recDuration(rec.seconds) : '') + (rec.bytes ? ' · ' + recSize(rec.bytes) : '') + (rec.hasTranscript ? ' · 已有转写' : '')),
          rec.reason ? h('div', { style: S.warn }, '不能整理：' + (rec.message || '') + (rec.hint ? '｜' + rec.hint : '')) : null,
          h('div', { style: { display: 'flex', gap: 6, alignItems: 'center', marginTop: 2, minWidth: 0 } },
            canOrganize ? h('button', { type: 'button', style: Object.assign({}, S.btn, { height: 24 }), disabled: busy, onClick: function () { organize(rec) } }, busyDir === rec.dir ? '已提交…' : '转写并出纪要') : null,
            rec.kind === 'import' && rec.originalPath ? h('span', { style: Object.assign({}, S.note, { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }) }, '来自：' + rec.originalPath) : null,
            rec.hasMinutes && rec.minutesAt ? h('span', { style: S.note }, '纪要 ' + recTime(rec.minutesAt)) : null))
      }
      var unsupported = data.unsupportedCount || 0
      var silentCount = data.silentCount || 0
      var usableCount = list.filter(function (r) { return r.hasAudio && !r.reason }).length
      return h('section', { 'aria-label': '之前的录音', style: { border: '1px solid ' + T.border, borderRadius: 8, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8 } },
        h('div', { style: { display: 'flex', gap: 6, alignItems: 'center' } },
          h('span', { style: { fontWeight: 600 } }, '之前的录音'),
          h('span', { style: Object.assign({}, S.note, { flex: 1, minWidth: 0 }) }, '可整理 ' + usableCount + ' 场' + (unsupported ? ' · 还有 ' + unsupported + ' 条没音频' : '') + (silentCount ? ' · ' + silentCount + ' 条几乎静音' : '')),
          h('button', { type: 'button', style: Object.assign({}, S.btn, { height: 24 }), onClick: load }, '刷新')),
        h('div', { style: S.note }, '选一场旧会议，或导入本机音频文件，走同一套会后整理：整段转写 → 认出说话人 → 生成纪要 → 写入知识库。'),
        recRootLine(h, data),
        h('div', { style: { display: 'flex', gap: 6, alignItems: 'center' } },
          h('input', {
            'aria-label': '音频文件绝对路径',
            placeholder: '本机音频文件绝对路径，如 C:\\Users\\你\\Downloads\\meeting.wav',
            value: pathText,
            onChange: function (e) { setPathText(e.target.value) },
            onKeyDown: function (e) { if (e.key === 'Enter') importFile() },
            style: Object.assign({}, S.field, { height: 26, fontSize: 12, fontFamily: 'ui-monospace, Consolas, monospace' }),
          }),
          h('button', { type: 'button', style: Object.assign({}, S.btnPrimary, { height: 26 }), disabled: busy || !String(pathText || '').trim(), onClick: importFile }, busy ? '处理中…' : '导入并整理')),
        h('div', { style: S.note }, '支持 .wav（16k / 16bit / 单声道）与 .pcm（按 16k 裸 PCM 处理）；其它格式先用 ffmpeg 转一下（不自动执行）：ffmpeg -i in.wav -ac 1 -ar 16000 -sample_fmt s16 out.wav'),
        msg ? h('div', { role: 'status', style: S.note }, msg) : null,
        pendingText ? h('div', { role: 'status', style: S.note }, pendingText + '（来自已落盘事件与 /status，不是估算进度）') : null,
        !list.length
          ? h('div', { style: { fontSize: 11, color: T.muted } }, '还没有可整理的录音' + (unsupported ? '；另有 ' + unsupported + ' 条会议记录没留下音频（可在「会后整理」里查看原因）' : '。先录一场会，或导入一段音频文件。'))
          : h('div', { style: { display: 'flex', flexDirection: 'column' } }, list.map(row)))
    }

    /**
     * 「会后整理」上的无音频说明：说清是哪一类问题、下一步怎么修。
     * 三类都可能是"0 字节 / 没有音频文件 / 整场静音"，修法不同，所以分开显示；
     * 只有"没采到音频"这类空记录才给「删除这条空记录」的出口（删除前会先写事件日志）。
     */
    function RecordingProblem(props) {
      var h = React.createElement
      var rec = (props && props.recording) || {}
      var dir = (props && props.dir) || rec.dir || ''
      var ms = React.useState(''), msg = ms[0], setMsg = ms[1]
      var bs = React.useState(false), busy = bs[0], setBusy = bs[1]
      var os = React.useState(false), openTech = os[0], setOpenTech = os[1]
      var deletable = rec.reason === 'no-capture' || rec.reason === 'no-audio-file'
      function del() {
        if (busy || !dir) return
        var tip = '删除这条空记录？\n' + dir + '\n\n这条记录没有可用的音频，删除后不可恢复；删除前的原因会记进事件日志。'
        try {
          // 二次确认：没有 confirm 能力（或用户取消）就什么都不做，绝不"没问就删"
          if (typeof confirm !== 'function' || !confirm(tip)) return setMsg('未确认，已取消删除')
        } catch { return setMsg('浏览器不允许确认框，已取消删除') }
        setBusy(true)
        setMsg('正在删除…')
        fetch('/api/soulmirror/records/delete', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ dir: dir, confirm: true }),
        }).then(function (r) { return r.json() }).then(function (j) {
          setBusy(false)
          if (j && j.ok) setMsg('已删除这条空记录')
          else setMsg('删除失败：' + ((j && (j.message || j.error)) || '未知原因') + (j && j.hint ? '｜' + j.hint : ''))
        }).catch(function (e) { setBusy(false); setMsg('删除失败：' + e.message) })
      }
      return h('div', { role: 'status', style: { borderLeft: '3px solid ' + T.warn, paddingLeft: 8, marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 } },
        h('div', null, '没有可用录音：' + (rec.message || '这段录音不能整理')),
        rec.hint ? h('div', { style: S.note }, '怎么办：' + rec.hint) : null,
        h('div', { style: { display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginTop: 2 } },
          h('button', { type: 'button', style: Object.assign({}, S.btn, { height: 24 }), onClick: function () { setOpenTech(!openTech) } }, openTech ? '收起原因' : '查看原因'),
          deletable ? h('button', { type: 'button', style: Object.assign({}, S.btn, { height: 24 }), disabled: busy, onClick: del }, '删除这条空记录') : null,
          msg ? h('span', { style: S.note }, msg) : null),
        openTech ? h('div', { style: { fontSize: 11, color: T.muted, overflowWrap: 'anywhere' } }, 'reason=' + (rec.reason || '—') + ' · audio.wav ' + (rec.wavBytes || 0) + ' 字节 · audio.pcm ' + (rec.pcmBytes || 0) + ' 字节 · 采集写入 ' + (rec.captureBytes || 0) + ' 字节' + (rec.silentRatio != null ? ' · 静音占比 ' + Math.round(Number(rec.silentRatio) * 100) + '%' : '') + (rec.verdict ? ' · 判定：' + rec.verdict : '')) : null)
    }


    function PipelineSteps(props) {
      var h = React.createElement, v = props.view
      return h('ol', { 'aria-label': '会后整理步骤', style: { listStyle: 'none', padding: 0, margin: 0 } },
        (v.steps || []).map(function (s, i) {
          return h('li', { key: s.id, style: { padding: '10px 0', borderBottom: '1px solid ' + T.border } },
            h('div', { style: S.rowBetween }, h('span', { style: { fontWeight: 600 } }, (i + 1) + '. ' + s.label),
              h('span', { style: { fontSize: 11, color: toneColor(s.state === 'error' ? 'error' : s.state === 'done' ? 'success' : 'neutral') } }, s.stateLabel)),
            s.detail ? h('div', { style: Object.assign({}, S.muted, { marginTop: 4, overflowWrap: 'anywhere' }) }, s.detail) : null,
            s.progress != null ? h('progress', { value: s.progress, max: 100, 'aria-label': s.label + '进度', style: { width: '100%', accentColor: T.brand } }) : null)
        }))
    }
    function ConnectionControls() {
      var h = React.createElement, lv = useLive(), app = lv.view && lv.view.app || pickActiveApp(lv)
      var cs = React.useState(''), code = cs[0], setCode = cs[1]
      var ns = React.useState(''), notice = ns[0], setNotice = ns[1]
      function openApp() {
        setNotice('正在启动会议软件…')
        fetch('/api/soulmirror/open', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ app: app.name === '—' ? '' : app.name }) })
          .then(function (r) { return r.json() })
          .then(function (r) { setNotice(r && r.ok ? (r.launched ? '已启动会议软件' : '会议软件已在运行') : ((r && r.result) || (r && r.error) || '启动失败')) })
          .catch(function (e) { setNotice('启动失败：' + e.message) })
      }
      function join() {
        setNotice('正在提交入会…')
        fetch('/api/soulmirror/join', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: code || lv.meeting && lv.meeting.code || '', app: app.name === '—' ? '' : app.name }) }).then(function (r) { return r.json() }).then(function (r) { setNotice(r.ok ? '入会操作已受理' : '入会失败：' + (r.error || r.result || '未知原因')) }).catch(function (e) { setNotice('入会失败：' + e.message) })
      }
      return h('details', { style: { padding: '8px 16px', borderBottom: '1px solid ' + T.border } },
        h('summary', { style: { cursor: 'pointer', color: T.muted } }, '会议接入 · 软件：' + app.name),
        h('div', { style: { display: 'flex', gap: 6, padding: '8px 0' } }, h('label', { style: S.note }, '会议号', h('input', { 'aria-label': '会议号', style: S.field, value: code, placeholder: lv.meeting && lv.meeting.code || '自动识别会议号 / 手动输入', onChange: function (e) { setCode(e.target.value) } })), h('button', { style: S.btn, onClick: join }, '入会'), h('button', { style: S.btn, onClick: openApp }, '打开软件')),
        h('div', { style: { display: 'flex', gap: 6 } }, h('button', { style: S.btn, 'aria-pressed': lv.mode !== 'agent', onClick: function () { switchMode('transcribe') } }, '只转录'), h('button', { style: S.btn, 'aria-pressed': lv.mode === 'agent', onClick: function () { switchMode('agent') } }, 'Agent 自动回复')),
        notice ? h('div', { role: 'status', style: S.note }, notice) : null)
    }

    function MeetingWorkspace(props) {
      var h = React.createElement, lv = useLive(), v = getView(lv)
      var ts = React.useState('transcript'), tab = ts[0], setTab = ts[1]
      var ms = React.useState(''), notice = ms[0], setNotice = ms[1]
      var bs = React.useState(false), busy = bs[0], setBusy = bs[1]
      var rs = React.useState(null), record = rs[0], setRecord = rs[1]
      var xf = React.useState(0), focusSeq = xf[0], setFocusSeq = xf[1]
      var runDir = v.run && v.run.dir || ''
      // 状态卡上的声纹提示只做一件事：把用户带到声纹卡（不新建第二个入口/第二个页面）
      function goVoiceprint() {
        setTab('minutes')
        setFocusSeq(focusSeq + 1)
      }
      React.useEffect(function () {
        if (!runDir || tab !== 'minutes') return
        var alive = true
        fetch('/api/soulmirror/record?dir=' + encodeURIComponent(runDir)).then(function (r) { return r.json() }).then(function (r) { if (alive) setRecord(r.record || null) }).catch(function (e) { if (alive) setNotice('读取纪要失败：' + e.message) })
        return function () { alive = false }
      }, [runDir, tab, v.durableSeq])
      /**
       * 总开关：关掉就真的不检测不录音；开启后由服务端先写盘再生效。
       *
       * 三个真实毛病都在这段：
       *  ① 请求没有序号 → 连点时旧响应后到，会把"已关闭"写在新状态下面（现场就是这样）。
       *  ② 状态全靠下一次轮询回显 → 宿主探测慢时看起来"点了没反应"。
       *     服务端已经在响应里给了**已落盘**的 enabled，直接用它更新，不算乐观假设。
       *  ③ 提示语不清空 → 状态变了还留着上一句相反的话。
       */
      var toggleSeq = 0
      function toggleEnabled(currentlyOn) {
        var seq = ++toggleSeq
        setBusy(true)
        var want = !currentlyOn
        setNotice(want ? '正在开启…' : '正在关闭…')
        fetch('/api/soulmirror/auto', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action: want ? 'start' : 'off' }),
        }).then(function (r) { return r.json() }).then(function (r) {
          if (seq !== toggleSeq) return        // 已经有更新的点击，丢弃这次结果
          setBusy(false)
          if (!r || r.ok === false) { setNotice('没有生效：' + ((r && r.error) || '未知原因')); return }
          // 响应里的 enabled 是服务端写完盘之后的值，可以立即采用
          var nowOn = r.enabled === true
          var view = Object.assign({}, v || {})
          view.enabled = nowOn
          view.headline = nowOn ? '等待会议' : '会议助手已关闭'
          view.detail = nowOn ? '检测到会议时自动录音，也可立即开始。' : '开启后可自动检测会议；不会自动加入会议。'
          live.set({ view: view, enabled: nowOn })
          setNotice(nowOn ? '已开启：检测到会议会自动录音' : '已关闭：不再自动检测')
          // 开关变了就立刻拉一次完整状态，让按钮/卡片马上对齐（失败也不影响）
          if (typeof fetch === 'function') fetch('/api/soulmirror/status').then(function (x) { return x.json() }).then(function (j) { if (j && j.view && seq === toggleSeq) live.set({ view: j.view, enabled: j.enabled, journal: j.journal, pipelineQueue: j.pipelineQueue }) }).catch(function () {})
        }).catch(function (e) { if (seq === toggleSeq) { setBusy(false); setNotice('操作失败：' + e.message) } })
      }
      function act(action) {
        if (!action || action.disabled) return
        // 「看纪要」「去配置」只是切页面，不发请求 —— 不新增协议，也不伪造动作
        if (action.action === 'minutes') { setTab('minutes'); setNotice(''); return }
        if (action.action === 'settings') { setTab('settings'); setNotice(''); return }
        if (busy) return
        setBusy(true); setNotice('正在提交操作…')
        var url = action.action === 'offline' ? '/api/soulmirror/offline' : '/api/soulmirror/auto'
        var body = action.action === 'offline' ? { dir: action.dir || runDir, restart: !!action.restart } : { action: action.action }
        fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
          .then(function (r) { return r.json() }).then(function (r) {
            setBusy(false)
            setNotice(r && r.ok !== false ? (r.queued ? '已入队，进展将从事件日志同步。' : '操作已受理，等待已落盘状态。') : '操作失败：' + ((r && (r.message || r.error)) || '未知原因') + (r && r.hint ? '｜' + r.hint : ''))
          }).catch(function (e) { setBusy(false); setNotice('操作失败：' + e.message) })
      }
      // 显示配置只有一份（服务端归一化后下发），这里全部照它执行：
      // 关掉诊断就真的不显示诊断，而不是留个假的开关
      var disp = v.display || {}
      var dense = disp.density === 'compact'
      var pad = dense ? 10 : 16
      var tabs = [['transcript','实时转写'],['minutes','纪要与产物'],['activity','运行轨迹'],['settings', disp.showDiagnostics === false ? '设置' : '设置与诊断']]
      var lines = lv.transcript || []
      return h('section', { 'aria-label': 'SoulMirror 会议工作台', style: { display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, color: T.text, background: T.bg, fontSize: 13 } },
        h('header', { style: Object.assign({}, S.header, { height: 52 }) }, h('div', null, h('div', { style: { fontWeight: 600, fontSize: 14 } }, 'SoulMirror'), h('div', { style: S.note }, '会议助手 · 会议工作台')), h('span', { style: { flex: 1 } }), !props.full ? h('button', { type: 'button', 'aria-label': '收起会议工作台', style: S.iconBtn, onClick: function () { store.set(false) } }, '×') : null),
        h('div', { style: { padding: pad, borderBottom: '1px solid ' + T.border } },
          h('div', { role: 'status', 'aria-live': 'polite', style: { color: toneColor(v.tone), fontWeight: 600, fontSize: 16, marginBottom: 6 } }, v.headline),
          h('div', { style: S.muted }, v.detail),
          v.run && v.run.name ? h('div', { style: Object.assign({}, S.note, { marginTop: 6, overflowWrap: 'anywhere' }) }, v.run.name) : null,
          // 演练中要一眼看出来：它不会碰真实录音，也不该被当成真的在开会
          lv.demo && lv.demo.running ? h('div', { role: 'status', style: { marginTop: 6, color: T.warn, fontSize: 11 } }, '演练中（不影响真实录音）') : null,
          h('div', { style: { display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' } },
            h('button', { type: 'button', disabled: busy || v.primary.disabled, style: Object.assign({}, S.btnPrimary, { height: 34, flex: 1, minWidth: 140, opacity: busy || v.primary.disabled ? 0.6 : 1 }), onClick: function () { act(v.primary) } }, busy ? '正在提交…' : v.primary.label),
            // 次级操作：不抢主按钮，但"手动开始录音"任何时候都在（用户反馈过它一度消失）
            (v.secondary || []).map(function (b, i) {
              return h('button', { key: 'sec-' + i, type: 'button', disabled: busy, title: '不用等自动检测，现在就开始录', style: Object.assign({}, S.btn, { height: 34 }), onClick: function () { act(b) } }, b.label)
            }),
            h('button', { type: 'button', style: Object.assign({}, S.btn, { height: 34 }), onClick: function () { setTab('settings') } }, '诊断')),
          // 总开关必须就在面板上：状态和它的开关放在一起，用户不用去设置页找。
          h('div', { role: 'group', 'aria-label': '会议助手总开关', style: { display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 } },
            h('button', {
              type: 'button',
              role: 'switch',
              'aria-checked': v.enabled ? 'true' : 'false',
              'aria-label': v.enabled ? '关闭会议助手' : '开启会议助手',
              disabled: busy,
              style: Object.assign({}, v.enabled ? S.btn : S.btnPrimary, { height: 28, minWidth: 92 }),
              onClick: function () { toggleEnabled(v.enabled) },
            }, v.enabled ? '会议助手：开' : '会议助手：关'),
            h('span', { style: S.note }, v.enabled ? '检测到会议自动录音（不自动入会）' : '现在是关的：不会自动检测，也不会录音')),
          notice ? h('div', { role: 'status', style: Object.assign({}, S.note, { marginTop: 8 }) }, notice) : null,
          // 声纹就绪状态：就绪时不显示（不常驻噪音）；未就绪时说清原因并可一步跳到安装处
          v.voiceprint && v.voiceprint.ready !== true ? h('div', {
            role: 'status',
            style: { borderLeft: '3px solid ' + T.warn, marginTop: 10, paddingLeft: 8 },
          },
            h('div', { style: { overflowWrap: 'anywhere' } }, '声纹未就绪：' + (v.voiceprint.hint || '会后不会自动认人')),
            h('div', { style: { display: 'flex', gap: 6, alignItems: 'center', marginTop: 6 } },
              h('button', { type: 'button', style: Object.assign({}, S.btn, { height: 24 }), onClick: goVoiceprint },
                v.voiceprint.reason === 'disabled' ? '去开启' : '去安装'),
              h('span', { style: S.note }, v.voiceprint.reason === 'disabled' ? '开启后，会后整理才会认人' : '装好后自动生效'))) : null,
          // 问题必须在管线步骤之前：先看哪里坏了，再看进度。
          // 复用 IssueBanner（第一条 + 展开全部 + 复制排查文本），不再在这里重复一份内联渲染。
          // 有 error/warn 时外面套 role="alert"（新问题立即播报）；只有 info 提示时不报警。
          (v.issues || []).length
            ? h('div', { role: 'alert', style: { marginTop: 10 } }, h(IssueBanner, { issues: v.issues || [], notices: v.notices || [] }))
            : h(IssueBanner, { issues: [], notices: v.notices || [] })),
        // 「已用 N 秒」原本是墙钟：会议结束后还在涨。现在只在采集中显示录音时长，
        // 非采集中改为显示这场会真正录了多久（来自录音文件/开始结束时间）。
        v.capturing && v.elapsedSec != null
          ? h('div', { style: { padding: '6px 16px', color: T.muted, fontSize: 11 } }, '录音 ' + fmtDuration(v.elapsedSec))
          : (!v.capturing && v.meetingDurationSec != null
            ? h('div', { style: { padding: '6px 16px', color: T.muted, fontSize: 11 } }, '录音 ' + fmtDuration(v.meetingDurationSec))
            : null),
        v.captureActivity && v.capturing ? h('div', { style: { padding: '0 16px 6px', color: T.muted, fontSize: 11 } }, v.captureActivity.lines + ' 句 · 已识别 ' + v.captureActivity.sentSec + ' 秒' + (v.captureActivity.lastAt ? ' · 最近一句 ' + v.captureActivity.lastAt.replace('T', ' ').slice(0, 19) : '')) : null,
        v.working ? h('div', { style: { padding: '0 16px', borderBottom: '1px solid ' + T.border } }, h(PipelineSteps, { view: v })) : null,
        h(ConnectionControls),
        h('nav', { 'aria-label': '会议工作台内容', style: { display: 'flex', gap: 2, padding: '8px 10px', borderBottom: '1px solid ' + T.border, flexWrap: 'wrap' } }, tabs.map(function (t) { return h('button', { key: t[0], type: 'button', 'aria-pressed': tab === t[0], style: Object.assign({}, S.btn, { background: tab === t[0] ? T.bg2 : 'transparent', borderColor: tab === t[0] ? T.brand : 'transparent', color: tab === t[0] ? T.brand : T.muted }), onClick: function () { setTab(t[0]) } }, t[1]) })),
        h('div', { style: { flex: 1, minHeight: 0, overflowY: 'auto', padding: pad } },
          tab === 'transcript' ? h('div', null,
            h('div', { style: Object.assign({}, S.note, { marginBottom: 12 }) }, v.transcriptNote || '实时转写是会中草稿；会后纪要使用整段非流式转写。'),
            !lines.length ? h('div', { style: S.empty }, v.capturing ? '音频采集中，等待第一句已保存的转写。' : '开始录音后，转写会显示在这里。') : lines.map(function (l,i) { return h('div', { key: l.id || i, style: S.row }, h('time', { style: S.time }, (l.t || '').slice(11,19)), l.demo ? h('span', { style: Object.assign({}, S.speaker, { color: T.warn }) }, '演练') : null, l.speaker ? h('span', { style: S.speaker }, l.speaker) : null, h('div', { style: S.text }, l.text)) }),
            h('details', { style: { marginTop: 18 } }, h('summary', { style: S.muted }, '会前准备与建议'), h(PrepareCard), h(AdviceViews), h(ReplyPanel))) : null,
          tab === 'minutes' ? h('div', null,
            h(ArtifactsCard, { artifacts: v.artifacts, view: v }),
            h(VoiceprintCard, { focusSeq: focusSeq }),
            h(SpeakersCard, { view: v }),
            h('h2', { style: { fontSize: 14, margin: '16px 0 8px' } }, '之前的录音'), h(RecordingsCard),
            h('h2', { style: { fontSize: 14, margin: '16px 0 8px' } }, '会后整理'), h(PipelineSteps, { view: v }),
            v.queueCount ? h('div', { style: S.note }, '另有 ' + v.queueCount + ' 场等待整理') : null,
            record && (record.minutes || record.markdown) ? h('pre', { style: { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', font: 'inherit', lineHeight: 1.75, marginTop: 16 } }, record.minutes || record.markdown) : h('p', { style: S.muted }, '纪要完成并落盘后将在此展示。失败时可重试，不会把实时草稿冒充整段转写结果。'),
            // 没有可用录音时说清是哪一类问题 + 下一步；不再放一个点了必然失败的按钮
            v.recording && !v.recording.ok ? h(RecordingProblem, { recording: v.recording, dir: runDir }) : null,
            runDir && (!v.recording || v.recording.ok) && !v.working && !v.capturing ? h('button', { style: S.btn, disabled: busy, onClick: function () { act({ action: 'offline', dir: runDir, restart: true }) } }, '用录音重新整理') : null,
            h('details', { style: { marginTop: 20 } }, h('summary', null, '历史会议与恢复'), h(RecordsCard), h(RecoveryCard))) : null,
          tab === 'activity' ? h('div', null, h('h2', { style: { fontSize: 14, margin: '0 0 12px' } }, '已落盘的运行轨迹'), !(v.activity || []).length ? h('p', { style: S.muted }, '暂无事件。操作被持久化后才会出现在这里。') : h('ol', { style: { listStyle: 'none', padding: 0, margin: 0 } }, v.activity.map(function (e,i) { return h('li', { key: e.seq || i, style: { borderLeft: '2px solid ' + T.border, padding: '0 0 18px 12px' } }, h('time', { style: S.note }, String(e.at || '').replace('T',' ').slice(0,19)), h('div', { style: { marginTop: 3, overflowWrap: 'anywhere' } }, e.text), h('div', { style: S.note }, '#' + e.seq + ' · ' + e.type)) }))) : null,
          tab === 'settings' ? h('div', null, h('h2', { style: { fontSize: 14, margin: '0 0 8px' } }, disp.showDiagnostics === false ? '诊断已关闭（display.showDiagnostics=false）' : '运行诊断'), disp.showDiagnostics === false ? null : (v.diagnostics || []).map(function (d) { return h('div', { key: d.id, style: Object.assign({}, S.rowBetween, { padding: '8px 0', borderBottom: '1px solid ' + T.border }) }, h('span', { style: S.note }, d.label), h('span', { style: { color: toneColor(d.tone), overflowWrap: 'anywhere', textAlign: 'right' } }, d.value)) }), h(HealthCheck), h('details', { style: { marginTop: 16 } }, h('summary', null, '设备与模型设置'), React.createElement(DevicePicker, { wide: true }), h(ConfigTab)), h('details', { style: { marginTop: 16 } }, h('summary', null, '保存位置（录音 / 纪要 / 导出）'), h(StorageCard)), h('details', { style: { marginTop: 16 } }, h('summary', null, '自动化与功能开关'), h(SwitchesCard)), h('details', { style: { marginTop: 16 } }, h('summary', null, '安装与依赖'), h(SetupCard), h(DepsCard))) : null),
        h('footer', { style: { padding: '9px 16px', borderTop: '1px solid ' + T.border, fontSize: 10, color: T.muted } }, v.persistence + (v.durableSeq ? ' · 事件 #' + v.durableSeq : '')))
    }

    /**
     * 问题横幅：默认只显示第一条，其余折成"还有 N 个问题"，可展开全部并复制排查文本。
     *
     * 页面里只有这一份（工作台在管线步骤之前复用它），不再各自写一份内联渲染。
     * issues 只含 error/warn；info 级上下文进 notices，用中性色，正常状态不再报警。
     */
    function IssueBanner(props) {
      var h = React.createElement
      var lv = useLive()
      // 优先用调用方给的服务端视图（view.issues / view.notices）；没有就退回 live 原始清单
      var list = (props && props.issues) || (lv && lv.issues) || []
      var notices = (props && props.notices) || (lv && lv.notices) || []
      // D1b：提交中的即时反馈（"正在提交操作…"）走跟 captureNotice 同一条状态行。
      // 它是"过程"而不是错误：按 info 提示走，不染红、不计入问题数，响应回来就清空。
      if (lv && lv.commandNotice) {
        notices = [{ id: 'command-notice', level: 'info', tone: 'info', text: lv.commandNotice }].concat(notices)
      }
      // 前端即时反馈（点「开始录音」但没起来时）：跟服务端 issues 合并展示
      if (lv && lv.captureNotice) {
        list = [{ id: 'capture-notice', level: 'error', title: lv.captureNotice, detail: '', fix: '看下面「一键体检」的结论' }].concat(list)
      }
      var open = React.useState(false), expanded = open[0], setExpanded = open[1]
      var cp = React.useState(''), copied = cp[0], setCopied = cp[1]
      if (!list.length && !notices.length) return null

      var first = list[0] || null
      var all = list.concat(notices)
      var more = Math.max(0, list.length - 1)
      var noticeLabel = function (it) { return (it.text || it.title || '') + (it.detail ? '：' + it.detail : '') }
      var isErr = !!(first && (first.level === 'error' || first.tone === 'error'))
      var color = !first ? T.muted : (isErr ? T.err : T.warn)
      var visible = first || notices[0]
      // 折叠文案：首屏只留第一条，其余折成"还有 N 个问题"（提示与问题分开数）
      var foldLabel = more > 0
        ? ('还有 ' + more + ' 个问题')
        : (notices.length > (first ? 0 : 1) ? ('还有 ' + (notices.length - (first ? 0 : 1)) + ' 条提示') : '')
      var totalLabel = '全部 ' + all.length + ' 条（' + list.length + ' 个问题 · ' + notices.length + ' 条提示）'
      var btn = function (label, onClick) { return h('button', { style: Object.assign({}, S.btn, { height: 20, padding: '0 6px' }), onClick: onClick }, label) }
      var head = h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
        h('span', { style: { color: color, fontWeight: 600, flex: '0 0 auto' } }, isErr ? '⚠ 转录异常' : '提示'),
        h('span', { style: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, noticeLabel(visible)),
        foldLabel ? btn(expanded ? '收起' : foldLabel, function () { setExpanded(!expanded) }) : null,
        btn(copied || '复制排查信息', copy))

      function reportText() {
        var lines = []
        for (var i = 0; i < all.length; i++) {
          var it = all[i]
          lines.push((i + 1) + '. [' + (it.level || it.tone || 'warn') + '] ' + (it.text || it.title || ''))
          if (it.detail) lines.push('   - ' + it.detail)
          if (it.fix) lines.push('   → ' + it.fix)
        }
        return lines.join('\n')
      }

      function copy() {
        var text = reportText()
        try {
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(function () { setCopied('已复制') }).catch(function () { setCopied('复制失败') })
          } else { setCopied('当前浏览器不支持剪贴板') }
        } catch { setCopied('复制失败') }
      }

      var body = h('div', { style: { display: 'flex', flexDirection: 'column', gap: 4, marginTop: 2 } },
        h('div', { style: { color: T.muted } }, totalLabel),
        all.map(function (it, i) {
          return h('div', { key: it.id || i, style: { borderTop: '1px solid ' + T.border, paddingTop: 4 } },
            h('div', { style: { color: it.tone === 'info' || it.level === 'info' ? T.muted : T.text } }, (i + 1) + '. ' + (it.text || it.title || '')),
            it.detail ? h('div', { style: { color: T.muted } }, '· ' + it.detail) : null,
            it.fix ? h('div', { style: { color: T.muted } }, '→ ' + it.fix) : null)
        }))
      return h('div', {
        style: { border: '1px solid ' + color, background: isErr ? 'rgba(208,51,51,.06)' : (first ? 'rgba(230,152,0,.08)' : 'transparent'), borderRadius: 8, padding: '7px 10px', margin: '6px 0', display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11 },
      },
        head,
        first && first.fix ? h('div', { style: { color: color, opacity: 0.95 } }, '→ ' + first.fix) : null,
        expanded ? body : null)
    }

    /**
     * 一键体检：不依赖 curl / 终端。
     *
     * 用户直接跑 curl 会遇到两个坑：
     *   · /api/* 在没重启宿主时会 404（新接口还没加载）
     *   · 有人机器上没有 curl（PowerShell 里 curl 是别名，参数行为不同）
     * 所以把体检做成按钮：点一下就跑 /preflight?net=1，结果直接显示在页面上。
     */
    function HealthCheck(props) {
      var h = React.createElement
      var st = React.useState(null), result = st[0], setResult = st[1]
      var bs = React.useState(false), busy = bs[0], setBusy = bs[1]

      function run() {
        if (busy) return
        setBusy(true)
        setResult({ pending: true })
        if (typeof fetch !== 'function') { setBusy(false); return }
        fetch('/api/soulmirror/preflight?net=1')
          .then(function (r) { return r.json() })
          .then(function (j) {
            setBusy(false)
            setResult(j || { ok: false, verdict: '返回为空' })
          })
          .catch(function (e) {
            setBusy(false)
            setResult({ ok: false, verdict: '体检请求失败：' + ((e && e.message) || '') })
          })
      }

      var res = result
      var color = res ? (res.ok === true ? T.ok : T.err) : T.muted
      var text = res
        ? (res.pending ? '体检中…（会连一次识别服务）' : (res.verdict || (res.ok ? '全部通过' : '有问题')))
        : ''

      return h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '4px 0' } },
        h('button', {
          style: Object.assign({}, S.btn, { height: 22, padding: '0 8px', fontSize: 11 }),
          disabled: busy,
          title: '检查平台/桥接/采集端点/密钥/网络，直接说出卡在哪',
          onClick: run,
        }, busy ? '体检中…' : '一键体检'),
        text ? h('span', { style: { fontSize: 11, color: color, flex: 1, minWidth: 0 } }, text) : null,
        (res && res.checks && res.checks.length)
          ? h('span', { style: { fontSize: 10, color: T.muted } }, res.checks.filter(function (c) { return c.ok }).length + '/' + res.checks.length + ' 项通过')
          : null)
    }

    /**
     * 悬浮监视窗：会议进行中/收尾时一直在，只看状态，不做配置。
     *
     * 用户的取舍："悬浮页面还是要有的，但不要有配置之类的了。"
     * 所以这里只放四件事：
     *   ① 状态行（转录中 / 整理中 · 时长 · 句数）
     *   ② 问题横幅（有故障就红着，说明原因）
     *   ③ 进度条（会后整理进行到什么阶段）
     *   ④ 最近一句（确认真的在转写）
     * 没有任何输入框、设备选择、密钥、模型设置——那些只在设置页里。
     */
    /**
     * 悬浮窗 = 大页面去掉配置。
     *
     * 用户要求："展示的也不全啊，是大页面除了配置之外的所有东西，参考之前的小页面。"
     * 所以这里给：状态 / 控制（开始·结束录音）/ 问题横幅 / 体检 / 进度 /
     * 转写列表（可滚动跟随）/ 状态横条 / 会后整理 / 未整理补救。
     * 唯独不放：设备选择、模型、密钥、模式之外的各种设置——那些在 设置 → 会议助手。
     */
    /**
     * 侧栏入口按钮：点一下展开 / 收起悬浮侧栏。
     *
     * 用户要求："就像之前一样，加入按钮啊"——以前 footer 上有个 🎙 会议 按钮，
     * 重构时被一并删掉了，于是关掉侧栏后就再也打不开。
     * 这个按钮只做两件事：显示状态点、切换侧栏。
     */
    function EntryButton() {
      var h = React.createElement
      var s = useStore()
      var lv = useLive()
      var v = getView(lv)
      var dotColor = toneColor(v.tone)

      return h('button', {
        style: {
          display: 'flex', alignItems: 'center', gap: 5, padding: '5px 9px',
          border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 12,
          background: s.open ? T.bg2 : 'transparent',
          color: s.open ? T.text : 'inherit',
        },
        title: s.open ? '收起会议助手侧栏' : '展开会议助手侧栏',
        onClick: function () { store.set(!s.open) },
      },
        h('span', { style: { fontSize: 13 } }, '🎙'),
        h('span', null, '会议'),
        h('span', { style: { fontSize: 10, color: dotColor } }, v.headline))
    }

    function shouldAutoOpen(v) { return v.display.autoOpen !== false && !!(v.capturing || v.working) }
    function FloatPanel() {
      var lv = useLive(), ui = useStore(), v = getView(lv)
      React.useEffect(function () { if (shouldAutoOpen(v)) store.set(true) }, [v.capturing, v.working, v.run && v.run.dir, v.display.autoOpen])
      if (!ui.open) return null
      return React.createElement('aside', { 'aria-label': '会议助手侧栏', style: { position: 'fixed', top: 0, right: 0, bottom: 0, width: v.display.width || 420, maxWidth: '96vw', zIndex: 9500, background: T.bg, borderLeft: '1px solid ' + T.border, overflow: 'hidden' } }, React.createElement(MeetingWorkspace, { full: false }))
    }

    function ProgressBar(props) {
      var lv = useLive(), v = (props && props.state && props.state.view) || lv.view
      return v ? React.createElement(PipelineSteps, { view: v }) : React.createElement('div', { style: S.note }, '等待持久化管线视图，请更新并重启 DSH。')
    }
    // 测试出口：让冒烟测试能直接渲染各面板，抓出"组件里用了未声明变量"这类白屏问题
    exports.__test = {
      get cfgStore() { return cfgStore },
      get ConfigTab() { return ConfigTab },
      get MeetingPage() { return MeetingPage },
      get MeetingWorkspace() { return MeetingWorkspace },
      get PipelineSteps() { return PipelineSteps },
      get ArtifactsCard() { return ArtifactsCard },
      get StorageCard() { return StorageCard },
      get RecordingsCard() { return RecordingsCard },
      get RecordingProblem() { return RecordingProblem },
      get SpeakersCard() { return SpeakersCard },
      get VoiceprintCard() { return VoiceprintCard },
      get getView() { return getView },
      get shouldAutoOpen() { return shouldAutoOpen },
    get FloatPanel() { return FloatPanel },
      get PanelIcon() { return PanelIcon },
      get LiveDock() { return LiveDock },
      get SettingsSection() { return SettingsSection },
      get SetupCard() { return SetupCard },
      get DepsCard() { return DepsCard },
      get StatusStrip() { return StatusStrip },
      get pickActiveApp() { return pickActiveApp },
      get AfterMeetingCard() { return AfterMeetingCard },
      get PrepareCard() { return PrepareCard },
      get RecordsCard() { return RecordsCard },
      get TypeLine() { return TypeLine },
      get AdviceViews() { return AdviceViews },
      get ReplyPanel() { return ReplyPanel },
      get SwitchesCard() { return SwitchesCard },
      get DevicePicker() { return DevicePicker },
      get live() { return live },
      get store() { return store },
      get callAuto() { return callAuto },
      get enrollFailText() { return enrollFailText },
    }



    // ── 会前准备：会邀 / 目标 / 背景，目标可 AI 润色（选一个"采用"）──
    function PrepareCard() {
      var h = React.createElement
      var st = React.useState({ invite: '', goal: '', background: '' }), prep = st[0], setPrep = st[1]
      var ms = React.useState(''), msg = ms[0], setMsg = ms[1]
      var cs = React.useState([]), cands = cs[0], setCands = cs[1]
      var bs = React.useState(false), busy = bs[0], setBusy = bs[1]

      React.useEffect(function () {
        if (typeof fetch !== 'function') return
        fetch('/api/soulmirror/prepare').then(function (r) { return r.json() })
          .then(function (j) { if (j) setPrep({ invite: j.invite || '', goal: j.goal || '', background: j.background || '' }) })
          .catch(function () {})
      }, [])

      function set(k, v) { setPrep(Object.assign({}, prep, { [k]: v })) }

      function save() {
        if (typeof fetch !== 'function') return
        fetch('/api/soulmirror/prepare', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify(prep),
        }).then(function (r) { return r.json() }).then(function (j) {
          setMsg(j && j.ok ? '已保存' : ('保存失败：' + ((j && j.error) || '')))
        }).catch(function (e) { setMsg('保存失败：' + e.message) })
      }

      function polish() {
        if (!prep.goal.trim()) { setMsg('先写一句目标再润色'); return }
        setBusy(true); setMsg('润色中…'); setCands([])
        if (typeof fetch !== 'function') { setBusy(false); return }
        fetch('/api/soulmirror/polish', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ goal: prep.goal }),
        }).then(function (r) { return r.json() }).then(function (j) {
          setBusy(false)
          if (j && j.ok) { setCands(j.candidates || []); setMsg('选一个点「采用」') }
          else { setMsg('润色失败：' + ((j && j.error) || '')) }
        }).catch(function (e) { setBusy(false); setMsg('润色失败：' + e.message) })
      }

      var field = function (label, key, placeholder, rows) {
        var props = {
          value: prep[key],
          placeholder: placeholder,
          onChange: function (e) { set(key, e.target.value) },
          style: Object.assign({}, S.field, { width: '100%', boxSizing: 'border-box', resize: 'vertical' }),
        }
        if (rows) props.rows = rows
        return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 4 } },
          h('span', { style: { fontSize: 11, color: T.muted } }, label),
          rows ? h('textarea', props) : h('input', props))
      }

      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
        field('会邀', 'invite', '会议主题 / 谁参加（可留空）'),
        field('会议目标', 'goal', '这次会议要达成的结论（可留空，AI 可润色）', 2),
        h('div', { style: { display: 'flex', gap: 6, justifyContent: 'flex-end' } },
          h('button', { style: Object.assign({}, S.btn, { height: 24 }), onClick: polish }, busy ? '润色中…' : 'AI 润色'),
          h('button', { style: Object.assign({}, S.btnPrimary, { height: 24 }), onClick: save }, '保存')),
        cands.length
          ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: 4, marginTop: 2 } },
            cands.map(function (c, i) {
              return h('div', { key: i, style: { display: 'flex', gap: 6, alignItems: 'center', fontSize: 12 } },
                h('span', { style: { flex: 1 } }, c),
                h('button', {
                  style: Object.assign({}, S.btn, { height: 22, padding: '0 8px' }),
                  onClick: function () { set('goal', c); setCands([]); setMsg('已采用（记得点保存）') },
                }, '采用'))
            }))
          : null,
        h('details', { style: { fontSize: 11 } },
          h('summary', { style: { cursor: 'pointer', color: T.muted } }, '更多背景（角色 / 立场 / 已知信息）'),
          field('背景', 'background', '例如：我是甲方，关注交付时间', 3)),
        msg ? h('div', { style: { fontSize: 11, color: T.muted } }, msg) : null)
    }

    // 导出：没设导出位置时取文本 → 前端生成下载（不写后端临时文件）；
    //       设了导出位置时由宿主真的写到那个目录，这里只显示真实落盘路径（可「在文件夹中显示」）。
    function exportRecord(dir, format) {
      if (typeof fetch !== 'function' || typeof document === 'function' === false) {
        // document 不存在时（测试环境）直接跳过
        if (typeof document === 'undefined') return Promise.resolve({ ok: false, error: '当前环境不支持下载' })
      }
      return fetch('/api/soulmirror/record/export?dir=' + encodeURIComponent(dir) + '&format=' + encodeURIComponent(format))
        .then(function (r) { return r.json() })
        .then(function (j) {
          if (!j || !j.ok) {
            return {
              ok: false,
              error: (j && (j.message || j.error)) || '导出失败',
              hint: (j && j.hint) || '',
              // 宿主写了文件但失败：仍然把文本带回来，界面可以回退用浏览器下载
              text: (j && j.text) || '',
              fileName: (j && j.fileName) || '',
            }
          }
          if (j.written && j.path) {
            // 真实落盘：不再触发浏览器下载，路径与字节数都是宿主 stat 出来的
            return { ok: true, fileName: j.fileName, written: true, path: j.path, bytes: Number(j.bytes) || 0 }
          }
          try {
            var blob = new Blob([j.text], { type: format === 'txt' ? 'text/plain;charset=utf-8' : 'text/markdown;charset=utf-8' })
            var url = URL.createObjectURL(blob)
            var a = document.createElement('a')
            a.href = url
            a.download = j.fileName || ('meeting.' + (format === 'txt' ? 'txt' : 'md'))
            document.body.appendChild(a)
            a.click()
            document.body.removeChild(a)
            setTimeout(function () { URL.revokeObjectURL(url) }, 3000)
            return { ok: true, fileName: j.fileName, written: false, note: j.message || '' }
          } catch (e) {
            return { ok: false, error: e.message, text: j.text }
          }
        })
        .catch(function (e) { return { ok: false, error: e.message } })
    }

    // ── 回看：历史会议 + 纪要 + 带说话人的转写 ──
    // ── 两个独立开关（用户明确要求分开）：
    //    建议卡片 = 给用户看，Agent 发言 = 说给会议里所有人听
    function SwitchesCard() {
      var h = React.createElement
      var csCard = useConfig()
      var cfg = csCard.data
      var setCfg = csCard.set
      var ms = React.useState(''), msg = ms[0], setMsg = ms[1]

      React.useEffect(function () {
        if (typeof fetch !== 'function') return
        csCard.reload()
      }, [])

      function patch(url, body, key) {
        if (typeof fetch !== 'function') return
        fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
          .then(function (r) { return r.json() })
          .then(function (j) {
            if (j && j.ok) {
              setCfg(Object.assign({}, cfg, { [key]: j[key] || Object.assign({}, cfg[key], body) }))
              setMsg('')
            } else setMsg((j && j.error) || '设置失败')
          })
          .catch(function (e) { setMsg('设置失败：' + e.message) })
      }

      var advice = (cfg && cfg.advice) || {}
      var reply = (cfg && cfg.reply) || {}
      var row = function (title, desc, on, onToggle) {
        return h('div', { style: { display: 'flex', gap: 8, alignItems: 'flex-start', padding: '6px 0' } },
          h('div', { style: { flex: 1 } },
            h('div', { style: { fontSize: 12 } }, title),
            h('div', { style: { fontSize: 11, color: T.muted, marginTop: 2 } }, desc)),
          h('button', {
            style: Object.assign({}, on ? S.btnPrimary : S.btn, { height: 24, minWidth: 52 }),
            onClick: onToggle,
          }, on ? '已开启' : '已关闭'))
      }

      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 4 } },
        row('建议卡片', '给你边开会边看：按 500 字 / 5 分钟自动更新追问与回应，不进入会议音频',
          advice.enabled !== false, function () { patch('/api/soulmirror/advice', { enabled: advice.enabled === false }, 'advice') }),
        row('Agent 发言', '全自动，不需要你操作：听到点名/问句就生成回复并直接说给会议，必要时自己开任务',
          !!reply.enabled, function () { patch('/api/soulmirror/reply', { enabled: !reply.enabled }, 'reply') }),
        row('预览模式（不自动说）', '默认关闭。开启后 Agent 只给候选、由你点「就说这句」，适合先观察效果',
          reply.autoSpeak === false, function () { patch('/api/soulmirror/reply', { autoSpeak: reply.autoSpeak === false }, 'reply') }),
        msg ? h('div', { style: { fontSize: 11, color: T.warn } }, msg) : null)
    }

    // ── Agent 发言候选词：生成 + 一键说出 ──
    function ReplyPanel() {
      var h = React.createElement
      var st = React.useState(null), s = st[0], setS = st[1]
      var ms = React.useState(''), msg = ms[0], setMsg = ms[1]

      function load() {
        if (typeof fetch !== 'function') return
        fetch('/api/soulmirror/reply').then(function (r) { return r.json() })
          .then(function (j) { if (j && j.ok) setS(j) }).catch(function () {})
      }
      React.useEffect(load, [])

      function say(text) {
        if (typeof fetch !== 'function') return
        setMsg('正在说…')
        fetch('/api/soulmirror/reply', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ speak: text }) })
          .then(function (r) { return r.json() })
          .then(function (j) { setMsg(j && j.ok ? ('已说出：' + text) : ('发言失败：' + ((j && j.error) || '未知'))) })
          .catch(function (e) { setMsg('发言失败：' + e.message) })
      }

      var cands = (s && s.candidates) || []
      var err = (s && s.error) || ''

      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
        h('div', { style: { display: 'flex', gap: 8, alignItems: 'center' } },
          h('span', { style: { fontSize: 11, color: T.muted, flex: 1 } },
            s && s.line ? ('针对：' + String(s.line).slice(0, 40)) : '还没有候选词（命中点名或问句时自动生成）'),
          h('button', { style: Object.assign({}, S.btn, { height: 22 }), onClick: load }, '刷新')),
        err ? h('div', { style: { fontSize: 11, color: T.err } }, err) : null,
        cands.length === 0
          ? h('div', { style: S.empty }, '等待被点名或出现问句')
          : cands.map(function (c, i) {
            return h('div', { key: i, style: { display: 'flex', gap: 8, alignItems: 'center', padding: '6px 8px', border: '1px solid ' + T.border, borderRadius: 6, background: T.bg2 } },
              h('span', { style: { flex: 1, fontSize: 12 } }, c),
              h('button', {
                style: Object.assign({}, S.btnPrimary, { height: 22, padding: '0 8px' }),
                onClick: function () { say(c) },
              }, '就说这句'))
          }),
        (s && s.needsTask) ? h('div', { style: { fontSize: 11, color: T.muted } }, '需要实际执行：' + (s.task || '')) : null,
        msg ? h('div', { style: { fontSize: 11, color: T.muted } }, msg) : null)
    }

    // ── 会中建议：追问 / 回应 / 转写 三视图    // ── 会中建议：追问 / 回应 / 转写 三视图（参考 dsh-plugin-meeting-assistant）──
    function AdviceViews(props) {
      var h = React.createElement
      var ts = React.useState('questions'), tab = ts[0], setTab = ts[1]
      var as = React.useState(null), advice = as[0], setAdvice = as[1]
      var bs = React.useState(false), busy = bs[0], setBusy = bs[1]
      var ms = React.useState(''), msg = ms[0], setMsg = ms[1]

      function load() {
        if (typeof fetch !== 'function') return
        fetch('/api/soulmirror/advice').then(function (r) { return r.json() })
          .then(function (j) { if (j && j.ok) setAdvice(j) })
          .catch(function () {})
      }
      React.useEffect(load, [])

      function refresh() {
        if (busy) return
        setBusy(true)
        setMsg('正在结合讨论生成建议…')
        if (typeof fetch !== 'function') { setBusy(false); return }
        fetch('/api/soulmirror/advice', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ force: true }) })
          .then(function (r) { return r.json() })
          .then(function (j) {
            setBusy(false)
            if (j && j.ok) { setAdvice(j); setMsg('') }
            else setMsg('生成失败：' + ((j && j.error) || '未知原因'))
          })
          .catch(function (e) { setBusy(false); setMsg('生成失败：' + e.message) })
      }

      var tabBtn = function (id, label, count) {
        var on = tab === id
        return h('button', {
          key: id,
          style: {
            flex: 1, height: 26, border: 'none', borderRadius: 5, cursor: 'pointer',
            background: on ? T.bg : 'transparent', color: on ? T.text : T.muted,
            fontWeight: on ? 600 : 400, fontSize: 12,
          },
          onClick: function () { setTab(id) },
        }, label + (count ? ' ' + count : ''))
      }

      var questions = (advice && advice.questions) || []
      var replies = (advice && advice.replies) || []
      var lines = (props && props.lines) || []

      var body
      if (tab === 'transcript') {
        body = h('div', { style: { display: 'flex', flexDirection: 'column', gap: 4 } },
          lines.length === 0
            ? h('div', { style: S.empty }, '还没有转写')
            : lines.slice(-80).map(function (l, i) {
              var bot = l.role === 'assistant'
              return h('div', { key: i, style: { display: 'flex', gap: 8, padding: '3px 0', borderBottom: '1px solid ' + T.border, fontSize: 12 } },
                h('span', { style: { color: T.muted, width: 50, flex: '0 0 auto', fontSize: 10 } }, (l.t || '').slice(11, 16)),
                h('span', { style: { color: bot ? T.ok : T.brand, maxWidth: 90, flex: '0 0 auto', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 11 } }, bot ? 'SoulMirror' : (l.speaker || '—')),
                h('span', { style: { flex: 1 } }, l.text))
            }))
      } else if (tab === 'questions') {
        body = questions.length === 0
          ? h('div', { style: S.empty }, busy ? '生成中…' : '还没有建议，点右上角「刷新建议」')
          : h('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
            questions.map(function (q, i) {
              return h('div', { key: i, style: { padding: '8px 10px', border: '1px solid ' + T.border, borderRadius: 6, background: T.bg2 } },
                h('div', { style: { fontSize: 13, marginBottom: 4 } }, q.q),
                q.why ? h('div', { style: { fontSize: 11, color: T.muted } }, '为什么值得问：' + q.why) : null)
            }))
      } else {
        body = replies.length === 0
          ? h('div', { style: S.empty }, busy ? '生成中…' : '还没有预判，点右上角「刷新建议」')
          : h('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
            replies.map(function (r, i) {
              return h('div', { key: i, style: { padding: '8px 10px', border: '1px solid ' + T.border, borderRadius: 6, background: T.bg2 } },
                h('div', { style: { fontSize: 12, color: T.muted, marginBottom: 4 } }, '可能被问：' + r.q),
                r.short ? h('div', { style: { fontSize: 13 } }, '简短：' + r.short) : null,
                r.smooth ? h('div', { style: { fontSize: 12, color: T.muted, marginTop: 3 } }, '委婉：' + r.smooth) : null)
            }))
      }

      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
        h('div', { style: { display: 'flex', gap: 4, alignItems: 'center', background: T.bg2, borderRadius: 6, padding: 3 } },
          tabBtn('questions', '追问', questions.length),
          tabBtn('replies', '回应', replies.length),
          tabBtn('transcript', '转写', lines.length),
          h('button', {
            style: Object.assign({}, S.btn, { height: 24, marginLeft: 6 }),
            disabled: busy,
            onClick: refresh,
          }, busy ? '生成中…' : '刷新建议')),
        msg ? h('div', { style: { fontSize: 11, color: T.warn } }, msg) : null,
        advice && advice.at
          ? h('div', { style: { fontSize: 10, color: T.muted } }, '建议生成于 ' + new Date(advice.at).toLocaleTimeString() + '（覆盖最近 ' + advice.lines + ' 句）')
          : null,
        h('div', { style: { minHeight: 40 } }, body))
    }

    // ── 回看：搜索 / 打开 / 导出 ──    // ── 回看：搜索 / 打开 / 导出 ──
    function RecordsCard() {
      var h = React.createElement
      var ls = React.useState([]), list = ls[0], setList = ls[1]
      var rs = React.useState(null), cur = rs[0], setCur = rs[1]
      var ms = React.useState(''), msg = ms[0], setMsg = ms[1]
      var qs = React.useState(''), q = qs[0], setQ = qs[1]
      // 导出真的落盘时的路径（宿主返回），用来给「在文件夹中显示」
      var eps = React.useState(''), exportPath = eps[0], setExportPath = eps[1]

      function load(query) {
        if (typeof fetch !== 'function') return
        var url = '/api/soulmirror/records' + (query ? ('?q=' + encodeURIComponent(query)) : '')
        fetch(url).then(function (r) { return r.json() })
          .then(function (j) {
            if (!j) return
            setList(j.records || [])
            setMsg(query ? ('命中 ' + (j.records || []).length + ' 场') : '')
          })
          .catch(function () {})
      }
      React.useEffect(function () { load('') }, [])

      function open(rec) {
        setMsg('读取中…')
        if (typeof fetch !== 'function') return
        fetch('/api/soulmirror/record?dir=' + encodeURIComponent(rec.dir))
          .then(function (r) { return r.json() })
          .then(function (j) {
            if (j && j.ok) { setCur(j.record); setMsg('') }
            else setMsg('读取失败：' + ((j && j.error) || ''))
          })
          .catch(function (e) { setMsg('读取失败：' + e.message) })
      }

      function doExport(format) {
        exportRecord(cur.dir, format).then(function (r) {
          if (!r.ok) {
            setExportPath('')
            setMsg('导出失败：' + r.error + (r.hint ? '｜' + r.hint : ''))
            return
          }
          setExportPath(r.written ? r.path : '')
          setMsg(r.written
            ? ('已导出到 ' + r.path + (r.bytes ? '（' + Math.round(r.bytes / 1024) + ' KB）' : ''))
            : ('已导出 ' + r.fileName + (r.note ? '｜' + r.note : '')))
        })
      }
      function revealExport() {
        if (!exportPath || typeof fetch !== 'function') return
        fetch('/api/soulmirror/open-path', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ path: exportPath, reveal: true }),
        }).then(function (r) { return r.json() }).then(function (j) {
          if (!(j && j.ok)) setMsg('打不开：' + ((j && j.error) || '未知原因'))
        }).catch(function (e) { setMsg('打不开：' + e.message) })
      }

      if (cur) {
        return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
          h('div', { style: { display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' } },
            h('button', { style: Object.assign({}, S.btn, { height: 24 }), onClick: function () { setCur(null) } }, '返回'),
            h('span', { style: { fontSize: 12, flex: 1, minWidth: 80, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
              (cur.preparation && cur.preparation.goal) || cur.dir.split(/[\\/]/).pop()),
            h('span', { style: S.tag }, cur.source === 'offline' ? '会后版' : '实时版'),
            cur.speakers ? h('span', { style: S.tag }, cur.speakers + ' 位说话人') : null),
          h('div', { style: { display: 'flex', gap: 6 } },
            h('button', { style: Object.assign({}, S.btn, { height: 24 }), onClick: function () { doExport('md') } }, '导出 Markdown'),
            h('button', { style: Object.assign({}, S.btn, { height: 24 }), onClick: function () { doExport('txt') } }, '导出文本'),
            exportPath ? h('button', { style: Object.assign({}, S.btn, { height: 24 }), onClick: revealExport }, '在文件夹中显示') : null),
          exportPath ? h('div', { style: Object.assign({}, S.note, { overflowWrap: 'anywhere' }) }, '导出位置：' + exportPath) : null,
          cur.minutes
            ? h('pre', {
              style: {
                margin: 0, padding: 8, background: T.bg2, border: '1px solid ' + T.border, borderRadius: 6,
                fontSize: 11, lineHeight: '16px', whiteSpace: 'pre-wrap', maxHeight: 260, overflow: 'auto',
              },
            }, cur.minutes)
            : h('div', { style: { fontSize: 11, color: T.muted } }, '还没有纪要'),
          h('div', { style: { fontSize: 11, color: T.muted } }, '转写（尾部 ' + cur.lines.length + ' 句）'),
          h('div', { style: { maxHeight: 220, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 3 } },
            cur.lines.slice(-80).map(function (l, i) {
              return h('div', { key: i, style: { display: 'flex', gap: 6, fontSize: 12 } },
                h('span', { style: { color: T.brand, width: 64, flex: '0 0 auto', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
                  l.speaker || '—'),
                h('span', { style: { flex: 1 } }, l.text))
            })),
          msg ? h('div', { style: { fontSize: 11, color: T.muted } }, msg) : null)
      }

      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
        h('div', { style: { display: 'flex', gap: 6, alignItems: 'center' } },
          h('input', {
            style: Object.assign({}, S.field, { height: 24, flex: 1, fontSize: 12 }),
            value: q,
            placeholder: '搜索：目标 / 纪要 / 原话',
            onChange: function (e) { setQ(e.target.value) },
            onKeyDown: function (e) { if (e.key === 'Enter') load(q) },
          }),
          h('button', { style: Object.assign({}, S.btn, { height: 24 }), onClick: function () { load(q) } }, '搜索'),
          h('button', { style: Object.assign({}, S.btn, { height: 24 }), onClick: function () { setQ(''); load('') } }, '刷新')),
        msg ? h('div', { style: { fontSize: 11, color: T.muted } }, msg) : null,
        list.length === 0
          ? h('div', { style: { fontSize: 11, color: T.muted } }, '还没有记录')
          : list.map(function (rec) {
            return h('div', {
              key: rec.id,
              style: { display: 'flex', gap: 6, alignItems: 'center', fontSize: 12, padding: '3px 0', borderBottom: '1px solid ' + T.border },
            },
              h('span', { style: { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
                rec.title || rec.id),
              (rec.match && rec.match.where && rec.match.where.length)
                ? h('span', { style: Object.assign({}, S.tag, { color: T.brand }) }, rec.match.where.join('·'))
                : null,
              h('span', { style: { color: T.muted, fontSize: 11 } }, rec.durationMin ? rec.durationMin + ' 分' : ''),
              rec.hasMinutes ? h('span', { style: S.tag }, '纪要') : null,
              h('button', { style: Object.assign({}, S.btn, { height: 22, padding: '0 8px' }), onClick: function () { open(rec) } }, '打开'))
          }))
    }

    // ── 会后：用录音重转写    // ── 会后：用录音重转写（云端文件识别，带说话人）并生成纪要 ──
      /**
   * 未整理会议的补救入口。
   *
   * 场景：进程被强杀 / 用户直接关窗口 —— 账本在、纪要没生成。
   * 这里只做两件事：提示有几场、点一下从账本补出纪要（不重转写，几秒完成）。
   */
  function RecoveryCard() {
    var h = React.createElement
    var s = React.useState(null), data = s[0], setData = s[1]
    var b = React.useState(''), busy = b[0], setBusy = b[1]
    var m = React.useState(''), msg = m[0], setMsg = m[1]

    function load() {
      fetch('/api/soulmirror/recover').then(function (r) { return r.json() })
        .then(setData).catch(function () {})
    }
    React.useEffect(function () { load() }, [])

    function recover(dir) {
      if (busy) return
      setBusy(dir); setMsg('正在用账本补出纪要…')
      fetch('/api/soulmirror/recover', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ dir: dir }),
      }).then(function (r) { return r.json() }).then(function (j) {
        setBusy('')
        if (j && j.ok) {
          setMsg('✅ 已补出纪要（' + j.sentences + ' 句）' + (j.knowledge ? ' · ' + j.knowledge : ''))
          load()
        } else {
          setMsg('❌ ' + ((j && j.error) || '补整理失败'))
        }
      }).catch(function (e) {
        setBusy('')
        setMsg('❌ ' + ((e && e.message) || '请求失败'))
      })
    }

    var list = (data && data.pending) || []
    if (!list.length && !msg) return null

    return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
      list.length ? h('div', { style: { fontSize: 12, color: T.warn } },
        '有 ' + list.length + ' 场会议没整理完（数据都在，可直接补出纪要）') : null,
      list.map(function (it) {
        return h('div', {
          key: it.dir,
          style: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, padding: '3px 0' },
        },
          h('span', { style: { flex: 1, color: T.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
            it.name + ' · ' + it.ageMin + ' 分钟前 · ' + Math.round((it.bytes || 0) / 1024) + 'KB 账本'),
          h('button', {
            style: Object.assign({}, S.btn, { height: 22, padding: '0 8px' }),
            onClick: function () { recover(it.dir) },
          }, busy === it.dir ? '整理中…' : '补出纪要'))
      }),
      msg ? h('div', { style: { fontSize: 11, color: /❌/.test(msg) ? T.warn : T.muted } }, msg) : null,
    )
  }

    /**
   * 错误边界：渲染期抛错时显示错误，而不是整页白屏。
   *
   * 为什么要这个：白屏时用户和我都没有任何线索——
   * 上次就是因为 AfterMeetingCard 里一次重复声明，整页空白，只能靠翻代码猜。
   * 有了它，错误信息、组件栈会直接显示在页面上，可一键复制。
   */
  /**
   * 错误边界：渲染期抛错时把错误显示出来，而不是整页白屏。
   *
   * 注意：不能无条件 extends React.Component。
   * 宿主可能只提供部分 React（没有 Component），那样会以 undefined 作为基类，
   * 在加载期抛 TypeError —— 整个客户端注册失败，表现为白屏。
   * 所以这里按能力探测：没有 Component 就退化为直通组件。
   */
  const PluginErrorBoundary = (function () {
    var Base = React.Component
    if (typeof Base !== 'function') {
      return function PassThrough(props) { return props && props.children ? props.children : null }
    }
    function Boundary(props) {
      Base.call(this, props)
      this.state = { error: null, info: '' }
    }
    Boundary.prototype = Object.create(Base.prototype)
    Boundary.prototype.constructor = Boundary
    Boundary.getDerivedStateFromError = function (error) { return { error: error } }
    Boundary.prototype.componentDidCatch = function (error, info) {
      try { console.error('[soulmirror] 界面渲染失败：', error, info && info.componentStack) } catch { /* ignore */ }
      this.setState({ info: (info && info.componentStack) || '' })
    }
    Boundary.prototype.render = function () {
      if (!this.state.error) return this.props.children
      var msg = String((this.state.error && this.state.error.message) || this.state.error || '未知错误')
      var stack = String((this.state.error && this.state.error.stack) || '')
      return React.createElement('div', {
        style: {
          margin: 16, padding: 12, border: '1px solid #d33', borderRadius: 8,
          background: 'rgba(208, 51, 51, 0.06)', fontSize: 12, lineHeight: '18px',
          whiteSpace: 'pre-wrap',
        },
      },
        React.createElement('div', { style: { fontWeight: 600, marginBottom: 6, color: '#d33' } },
          '会议助手界面出错了（渲染抛错，不是白屏）'),
        React.createElement('div', { style: { marginBottom: 8 } }, '错误：' + msg),
        React.createElement('textarea', {
          readOnly: true,
          value: msg + '\n\n' + stack + '\n\n' + this.state.info,
          style: {
            width: '100%', height: 160, fontSize: 11,
            border: '1px solid #ccc', borderRadius: 6, padding: 8, background: '#fff',
          },
        }),
        React.createElement('div', { style: { marginTop: 6, color: '#666' } },
          '把上面这段发给我就能定位；也可以按 F12 看 Console。'),
      )
    }
    return Boundary
  })()

  function AfterMeetingCard(props) {
      var lv = useLive(), v = getView(lv)
      return React.createElement('div', null, React.createElement('h3', { style: S.cardTitle }, v.headline), React.createElement('p', { style: S.muted }, v.detail), React.createElement(PipelineSteps, { view: v }))
  }
    function StatusStrip(props) {
      var lv = useLive(), v = (props && props.state && props.state.view) || lv.view
      if (!v) return React.createElement('div', null, React.createElement('div', { style: S.note }, '旧宿主状态 · 请更新并重启 DSH'), React.createElement(StatusStripLegacy, props))
      return React.createElement('div', { role: 'status', style: { display: 'flex', gap: 8, flexWrap: 'wrap', padding: '6px 12px', fontSize: 11 } }, React.createElement('span', { style: { color: toneColor(v.tone) } }, v.headline), (v.diagnostics || []).slice(0, 2).map(function (d) { return React.createElement('span', { key: d.id, style: { color: toneColor(d.tone) } }, d.label + '：' + d.value) }))
    }
    function StatusStripLegacy(props) {
      var h = React.createElement
      var lv = useLive()
      var s = (props && props.state) || lv || {}
      var asr = (s.session && s.session.asr) || s.asr || {}
      var llmErr = s.lastLlmError || (lv && lv.lastLlmError) || null
      var cap = (s.session && s.session) || {}
      var now = Date.now()
      var lastAt = s.transcript && s.transcript.length
        ? Date.parse(s.transcript[s.transcript.length - 1].t || '') || 0
        : 0
      var lastAge = lastAt ? Math.max(0, Math.round((now - lastAt) / 1000)) : null
      var sentS = Math.floor((asr.sentMs || 0) / 1000)

      var conn, connColor
      if (asr.failed) { conn = '连接失败'; connColor = T.err }
      else if (asr.online) { conn = '百炼已连接'; connColor = T.ok }
      else if (asr.phase === 'connecting' || asr.phase === 'degraded') { conn = '重连中'; connColor = T.warn }
      else { conn = '未连接'; connColor = T.muted }

      // 采集状态：这条最关键——"看着连着"其实没在采，是最容易误导人的状态
      var capFailed = !!cap.captureFailed
      var silentSec = cap.silentSec || 0
      var capText = capFailed ? '采集已停止'
        : (!cap.capturing ? '未在采集'
          : (silentSec >= 10 ? ('端点静音 ' + silentSec + ' 秒') : '采集中'))
      var capColor = capFailed ? T.err
        : (!cap.capturing ? T.muted
          : (silentSec >= 10 ? T.warn : T.ok))
      var audio = sentS > 0 ? ('已送 ' + sentS + ' 秒音频') : '还没收到音频'
      var audioColor = sentS > 0 ? T.muted : T.warn
      var lineText = lastAge === null ? '还没有转写' : ('最后一句 ' + lastAge + ' 秒前')

      var chip = function (text, color, title) {
        return h('span', { title: title || '', style: Object.assign({}, S.tag, { color: color, whiteSpace: 'nowrap' }) }, text)
      }

      return h('div', {
        style: {
          display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap',
          padding: (props && props.padding) || '6px 12px',
          borderBottom: '1px solid ' + T.border, fontSize: 11,
        },
      },
        chip(conn, connColor),
        (s.replyState && (s.replyState.candidates || []).length && !(s.reply && s.reply.autoSpeak))
          ? h('span', {
            title: '点「就说这句」才会出声；想让它自己说，去开关里打开「自动开口」',
            style: Object.assign({}, S.tag, { color: T.warn, whiteSpace: 'nowrap' }),
          }, '候选待确认 ' + s.replyState.candidates.length)
          : null,
        // 音频进了虚拟声卡、但会议还在用物理麦克风 —— 对方听不到，必须显式告警

    // 会后整理进度：点"结束录音"后自动跑，必须能看见在哪一步
        (s.postMeeting && s.postMeeting.phase && s.postMeeting.phase !== 'idle')
          ? (function () {
            var pm = s.postMeeting
            var label = pm.phase === 'stopping' ? '结束中'
              : pm.phase === 'offline' ? '会后转写中'
              : pm.phase === 'minutes' ? '生成纪要中'
              : pm.phase === 'done' ? ('整理完成 ' + (pm.sentences || 0) + ' 句' + (pm.speakers ? ' · ' + pm.speakers + ' 位' : ''))
              : pm.phase === 'error' ? ('整理失败：' + String(pm.error || '').slice(0, 24))
              : pm.phase
            var color = pm.phase === 'error' ? T.err : (pm.phase === 'done' ? T.ok : T.warn)
            return h('span', { title: pm.minutesPath || '', style: Object.assign({}, S.tag, { color: color, whiteSpace: 'nowrap' }) }, label)
          })()
          : null,
        (s.lastSpeakInfo && s.lastSpeakInfo.switched && !s.lastSpeakInfo.verified)
          ? h('span', {
            title: '把会议软件的麦克风改成「与系统默认相同」，插件才能在发言时切到虚拟麦克风',
            style: Object.assign({}, S.tag, { color: T.warn, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 240 }),
          }, '会议未用虚拟麦克风（当前：' + String(s.lastSpeakInfo.activeDevice || '未知').slice(0, 18) + '）')
          : null,
        (s.lastSpeakError && s.lastSpeakError.message)
          ? h('span', {
            title: s.lastSpeakError.at || '',
            style: Object.assign({}, S.tag, {
              color: T.err, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 200,
            }),
          }, '发言失败：' + String(s.lastSpeakError.message).slice(0, 30))
          : null,
        (llmErr && llmErr.message)
          ? h('span', {
            title: (llmErr.stage || '') + ' · ' + (llmErr.at || ''),
            style: Object.assign({}, S.tag, {
              color: T.err, borderColor: T.err, whiteSpace: 'nowrap',
              overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 240,
            }),
          }, '模型调用失败：' + String(llmErr.message).slice(0, 40))
          : null,
        chip(capText, capColor, capFailed ? '采集进程连续失败已暂停，60 秒后自动重试' : '采集是否在进行；端点静音说明会议声音没进这个设备'),
        chip(audio, audioColor, '送进语音识别的音频时长；一直是 0 说明采集没出数据'),
        chip(lineText, lastAge !== null && lastAge > 60 ? T.warn : T.muted),
        (asr.reconnects > 0) ? chip('重连 ' + asr.reconnects + ' 次', T.warn) : null,
        asr.lastError ? h('span', { style: { color: T.err, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 220 } }, asr.lastError) : null)
    }

    // ── 采集设备手动切换 ───────────────────────────────────────────    // ── 采集设备手动切换 ───────────────────────────────────────────
    var deviceCache = { at: 0, list: [] }
    function useDevices() {
      var s = React.useState(deviceCache), set = s[1]
      React.useEffect(function () {
        if (typeof fetch !== 'function') return
        fetch('/api/soulmirror/devices').then(function (r) { return r.json() }).then(function (j) {
          if (!j) return
          deviceCache = { at: Date.now(), list: (j.render || []), current: j.current || '', def: j.defaultDevice || '', auto: !!j.auto, note: j.note || '' }
          set(deviceCache)
        }).catch(function () {})
      }, [])
      return deviceCache
    }

    /** 手动选采集设备；选"自动跟随"则清空固定值 */
    function switchCapture(name) {
      var payload = name
        ? { devices: { capture: name, captureAuto: false } }
        : { devices: { capture: '', captureAuto: true } }
      return fetch('/api/soulmirror/config', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
      }).then(function (r) { return r.json() })
        .then(function (j) {
          // 保存后写回共享 store：另一个页面（大页/小窗）立刻跟着变
          if (j && !j.error) cfgStore.set(j)
          return j
        })
        .catch(function () { return null })
    }

    function DevicePicker(props) {
      var h = React.createElement
      var d = useDevices()
      var st = React.useState(0), bump = st[1]
      var msgState = React.useState(''), msg = msgState[0], setMsg = msgState[1]
      var cur = props && props.value !== undefined ? props.value : (d.current || '')
      var list = (d.list && d.list.length) ? d.list : []
      // slim：小窗用。不占一整行标签，也不放刷新按钮，只留"换一个声卡"这一件事
      var slim = !!(props && props.slim)
      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 3 } },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 6 } },
          slim ? null : h('span', { style: Object.assign({}, S.metaLabel, { width: props && props.wide ? 72 : 34 }) }, '采集'),
          slim ? h('span', { style: { color: T.muted, fontSize: 11, flex: '0 0 auto' } }, '🎧') : null,
          h('select', {
            style: Object.assign({}, S.field, { height: slim ? 22 : 24, flex: 1, minWidth: 0, fontSize: slim ? 11 : undefined }),
            value: cur,
            title: cur || '自动跟随',
            onChange: function (e) {
              var v = e.target.value
              setMsg('切换中…')
              switchCapture(v).then(function () {
                setMsg(v ? '已切到：' + v : '已改为自动跟随')
                bump(Date.now())
              })
            },
          },
            h('option', { value: '' }, '自动跟随'),
            list.map(function (name) { return h('option', { key: name, value: name }, name) })),
          slim ? null : h('button', {
            style: Object.assign({}, S.btn, { height: 24, flex: '0 0 auto' }),
            onClick: function () {
              if (typeof fetch !== 'function') return
              fetch('/api/soulmirror/devices').then(function (r) { return r.json() }).then(function (j) {
                deviceCache = { at: Date.now(), list: (j.render || []), current: j.current || '', def: j.defaultDevice || '', auto: !!j.auto, note: j.note || '' }
                bump(Date.now())
                setMsg(j.note || '')
              }).catch(function () {})
            },
          }, '刷新')),
        msg ? h('div', { style: { fontSize: 11, color: T.muted, paddingLeft: slim ? 18 : (props && props.wide ? 78 : 40) } }, msg)
          : (props && props.showNote && d.note ? h('div', { style: { fontSize: 11, color: T.muted, paddingLeft: 40 } }, d.note) : null))
    }

    // ── 安装体检：缺什么就列出来，每项配一个按钮（密钥可留空）──────────    // ── 安装体检：缺什么就列出来，每项配一个按钮（密钥可留空）──────────
    var setupState = { rows: [], hint: '', ok: true, loading: true }

    function fetchSetup() {
      if (typeof fetch !== 'function') return Promise.resolve(null)
      return fetch('/api/soulmirror/setup').then(function (r) { return r.json() }).then(function (j) {
        if (j && j.rows) {
          setupState = {
            rows: j.rows, hint: j.hint || '', ok: !!j.ok, loading: false,
            probe: j.probe || setupState.probe,
          }
        }
        return j
      }).catch(function () { return null })
    }

    function useSetup() {
      var s = React.useState(setupState), set = s[1]
      React.useEffect(function () {
        var alive = true
        fetchSetup().then(function () { if (alive) set(setupState) })
        return function () { alive = false }
      }, [])
      return setupState
    }

    function runSetup(action, value) {
      if (typeof fetch !== 'function') return Promise.resolve(null)
      return fetch('/api/soulmirror/setup', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: action, value: value }),
      }).then(function (r) { return r.json() }).then(function (j) {
        if (j && j.rows) {
          setupState = { rows: j.rows, hint: j.hint || '', ok: !!j.ok, loading: false, message: j.message || '' }
        }
        return j
      }).catch(function () { return null })
    }

    var SETUP_LABEL = { config: '生成', bridge: '编译', key: '填写', device: '检测', vm: '安装', calib: '标定' }

    /** 可选插件体检：缺什么、为什么缺、装它的命令是什么 */
    function useDeps() {
      var s = React.useState({ loading: true, deps: [], profile: '', profileDir: '', error: '', busy: '' })
      var st = s[0], set = s[1]
      var bump = React.useState(0), setBump = bump[1]

      function load() {
        fetch('/api/soulmirror/deps')
          .then(function (r) { return r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status)) })
          .then(function (j) {
            set({
              loading: false,
              deps: (j && j.deps) || [],
              profile: (j && j.profile) || '',
              profileDir: (j && j.profileDir) || '',
              error: '',
              busy: '',
            })
          })
          .catch(function (e) { set({ loading: false, deps: [], profile: '', profileDir: '', error: e.message, busy: '' }) })
      }

      React.useEffect(function () { load() }, [bump[0]])

      function install(pkg) {
        set({ loading: false, deps: st.deps, profile: st.profile, profileDir: st.profileDir, error: '', busy: pkg })
        fetch('/api/soulmirror/deps', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ pkg: pkg }),
        })
          .then(function (r) { return r.json() })
          .then(function (j) {
            set({
              loading: false,
              deps: (j && j.deps) || [],
              profile: (j && j.profile) || st.profile,
              profileDir: st.profileDir,
              error: j && j.ok ? '' : ((j && (j.error || j.output)) || '安装失败'),
              busy: '',
            })
          })
          .catch(function (e) {
            set({ loading: false, deps: st.deps, profile: st.profile, profileDir: st.profileDir, error: e.message, busy: '' })
          })
      }

      return { loading: st.loading, deps: st.deps, profile: st.profile, profileDir: st.profileDir, error: st.error, busy: st.busy, reload: function () { setBump(Date.now()) }, install: install }
    }

    /**
     * 可选插件卡：缺什么、装了有什么好处、以及**可以照着敲的命令**。
     *
     * 为什么要给出命令而不只给按钮：用户可能想在终端里自己装、或者装到别的 profile；
     * 也可能自动安装被策略拦住。命令是唯一一定有效的兜底。
     */
    function DepsCard(props) {
      var h = React.createElement
      var d = useDeps()
      var missing = (d.deps || []).filter(function (x) { return !x.installed })

      // 全装好了就收成一行，别占地方
      if (!d.loading && !d.error && missing.length === 0) {
        return h('div', { style: S.rowBetween },
          h('span', { style: S.muted }, '可选插件：全部就绪'),
          h('button', { style: S.btnGhost, onClick: d.reload }, '重新检测'))
      }

      function cmdOf(dep) {
        return dep.command || ('dsh plugin --profile ' + (d.profile || 'web') + ' add ' + dep.pkg)
      }

      return h('div', { style: S.card },
        h('div', { style: S.rowBetween },
          h('div', { style: S.cardTitle }, '可选插件'),
          h('button', { style: S.btnGhost, onClick: d.reload }, d.loading ? '检测中…' : '重新检测')),

        d.error ? h('div', { style: { fontSize: 12, color: T.err, lineHeight: 1.6 } }, '检测失败：' + d.error) : null,

        d.loading ? h('div', { style: S.muted }, '正在检测…') : null,

        !d.loading && missing.length ? h('div', { style: S.muted },
          '以下插件未安装，对应功能不会启动。装好后重启 DSH 生效。') : null,

        (missing || []).map(function (dep) {
          var cmd = cmdOf(dep)
          return h('div', { key: dep.key, style: S.depRow },
            h('div', { style: S.depHead },
              h('span', { style: S.depName }, dep.name),
              h('span', { style: S.tag }, dep.pkg)),
            h('div', { style: S.muted }, dep.why),
            // 命令给全：可以复制到终端里自己跑
            h('div', { style: S.cmd },
              h('code', { style: S.cmdCode }, cmd),
              h('button', {
                style: S.btnGhost,
                onClick: function () {
                  try {
                    // 不用 window.prompt（沙箱里会被拦），直接写剪贴板
                    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(cmd)
                  } catch (e) { /* 复制失败也不影响看命令 */ }
                },
              }, '复制')),
            h('button', {
              style: S.btnPrimary,
              disabled: d.busy === dep.pkg,
              onClick: function () { d.install(dep.pkg) },
            }, d.busy === dep.pkg ? '安装中…' : '一键安装'))
        })
      )
    }

    function SetupCard(props) {
      var h = React.createElement
      var st = useSetup()
      var bump = React.useState(0), setBump = bump[1]
      var msgState = React.useState(''), msg = msgState[0], setMsg = msgState[1]
      // 密钥用内联输入框：DSH 沙箱里 window.prompt 会被拦掉，表现为"点了没反应"
      var keyState = React.useState(''), keyDraft = keyState[0], setKeyDraft = keyState[1]
      // 联通性测试：会真的连一次 ASR / 合成一小段 TTS，所以要给"测试中"状态
      var probeState = React.useState(false), probing = probeState[0], setProbing = probeState[1]
      var probeMsgState = React.useState(''), probeMsg = probeMsgState[0], setProbeMsg = probeMsgState[1]
      function probeModels() {
        if (probing) return
        setProbing(true)
        setProbeMsg('正在连接模型…')
        runSetup('probe-models').then(function (j) {
          setProbing(false)
          // 后端没给 message 时不能只说"测试完成"——那会把真正的失败原因吞掉：
          // 例如旧版本会回 { ok:false, error:'未知动作：probe-models' }，
          // 用户只看到"测试完成"就完全不知道发生了什么。
          if (j && j.message) { setProbeMsg(j.message); setBump(Date.now()); return }
          if (j && j.error) { setProbeMsg('❌ ' + j.error + '\n   → 如果刚升级插件，请重启 DSH 后重试'); setBump(Date.now()); return }
          setProbeMsg('❌ 探测没有返回结果\n   → 若刚升级插件，请重启 DSH 后重试')
          setBump(Date.now())
        }).catch(function (e) {
          setProbing(false)
          setProbeMsg('❌ 测试失败：' + (e && e.message ? e.message : e))
        })
      }

      // 不用"加载中直接 return 整个卡片"：那样既会闪空，也让渲染测试
      // 覆盖不到下半段代码（props 未接线这类错就漏掉了）。
      var loading = !!st.loading

      function pollProbe() {
        // 试听要十几秒：先给反馈，再轮询，绝不让按钮"点了没反应"
        var tries = 0
        var timer = setInterval(function () {
          tries += 1
          fetchSetup().then(function () {
            setBump(Date.now())
            var pj = setupState.probe
            if (!pj || !pj.running || tries > 40) {
              clearInterval(timer)
              if (pj) {
                setMsg(pj.error ? pj.error
                  : pj.picked ? '已选中：' + pj.picked
                  : '所有设备都静音：先让会议出声，再点一次')
              }
            } else {
              setMsg('正在试听 ' + (pj.done || 0) + '/' + (pj.total || '?') + (pj.last ? ' · 刚测完 ' + pj.last : ''))
            }
          })
        }, 1500)
      }

      function saveKey() {
        setMsg('正在保存密钥…')
        runSetup('key', keyDraft).then(function (j) {
          setMsg((j && j.message) || '已保存')
          setKeyDraft('')
          setBump(Date.now())
        })
      }

      function click(row) {
        if (row.id === 'key') {
          // 输入框常驻在行下方，这里只提示怎么用
          setMsg('在下面输入框里粘贴密钥后点「保存」；留空保存等于清空')
          return
        }
        setMsg(row.id === 'device' ? '正在启动试听…' : '正在处理…')
        setBump(Date.now())
        runSetup(row.action).then(function (j) {
          setMsg((j && j.message) || '')
          setBump(Date.now())
          if (j && j.download) window.open(j.download, '_blank')
          if (row.id === 'device' && j && j.started) pollProbe()
        })
      }

      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
          h('span', { style: { fontSize: 13, fontWeight: 600 } }, '安装体检'),
          loading ? h('span', { style: { fontSize: 11, color: T.muted } }, '检查中…') : null,
          (function () {
            var miss = (st.rows || []).filter(function (r) { return (r.state || (r.ok ? 'ok' : 'missing')) === 'missing' }).length
            var auto = (st.rows || []).filter(function (r) { return (r.state) === 'auto' }).length
            var label = miss ? ('缺 ' + miss + ' 项') : (auto ? (auto + ' 项自动接管') : '已就绪')
            var color = miss ? T.warn : (auto ? T.muted : T.ok)
            return h('span', { style: Object.assign({}, S.tag, { color: color }) }, label)
          })(),
          h('span', { style: { flex: 1 } }),
          h('button', {
            style: Object.assign({}, S.btn, { height: 24 }),
            title: '真的连一次语音识别与合成，确认 Key 与网络都通',
            onClick: function () { probeModels() },
          }, probing ? '测试中…' : '测模型'),
          h('button', {
            style: Object.assign({}, S.btn, { height: 24 }),
            onClick: function () { setupState.loading = true; setBump(Date.now()); runSetup('config').then(function () { setBump(Date.now()) }) },
          }, '刷新')),
        st.hint ? h('div', { style: { fontSize: 12, color: st.ok ? T.muted : T.warn } }, st.hint) : null,
        // 模型联通性结果：多行，不合格的地方直接写"该怎么做"
        probeMsg ? h('pre', {
          style: {
            margin: 0, padding: '6px 8px', background: T.bg2, border: '1px solid ' + T.border,
            borderRadius: 6, fontSize: 11, lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
            color: /❌|失败/.test(probeMsg) ? T.warn : T.muted,
          },
        }, probeMsg) : null,
        (function () {
          var all = (st.rows || [])
          var compact = !!(props && props.compact)
          return compact ? all.filter(function (r) { return (r.state || (r.ok ? 'ok' : 'missing')) !== 'ok' }) : all
        })().map(function (row) {
          // 三态：ok=你配好了；auto=环境/系统替你接管；missing=没有
          var st2 = row.state || (row.ok ? 'ok' : 'missing')
          var mark = st2 === 'ok' ? '✓' : (st2 === 'auto' ? '·' : '✗')
          var color = st2 === 'ok' ? T.ok : (st2 === 'auto' ? T.muted : T.warn)
          var text = st2 === 'missing' ? row.fix : (row.detail || '')
          return h('div', {
            key: row.id,
            style: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, padding: '4px 0', borderBottom: '1px solid ' + T.border },
          },
            h('span', { style: { color: color, width: 14, flex: '0 0 auto', textAlign: 'center' } }, mark),
            h('span', { style: { flex: '0 0 auto' } }, row.what),
            h('span', { style: { flex: 1, color: T.muted, fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, text),
            h('button', {
              style: Object.assign({}, S.btn, { height: 22, padding: '0 8px', flex: '0 0 auto' }),
              onClick: function () { click(row) },
            }, st2 === 'ok' ? '重设' : (SETUP_LABEL[row.id] || '处理')))
        }),
        h('div', { style: { display: 'flex', gap: 6, alignItems: 'center', marginTop: 4 } },
          h('input', {
            type: 'password',
            value: keyDraft,
            placeholder: 'DASHSCOPE_API_KEY（留空保存 = 清空）',
            onChange: function (e) { setKeyDraft(e.target.value) },
            style: {
              flex: 1, height: 26, padding: '0 8px', fontSize: 12, borderRadius: 6,
              border: '1px solid ' + T.border, background: T.bg2, color: T.text, outline: 'none',
            },
          }),
          h('button', { style: Object.assign({}, S.btnPrimary, { height: 26 }), onClick: saveKey }, '保存密钥')),
        msg ? h('div', { style: { fontSize: 11, color: T.muted } }, msg) : null)
    }

    // ── 侧栏图标：让"会议"在侧栏有一等入口（之前只有页脚小按钮，用户找不到）──
    function PanelIcon(props) {
      var h = React.createElement
      var s = useLive()
      var size = (props && props.size) || 16
      var v = getView(s)
      var busy = v.capturing || v.working
      // 只画图形：外层按钮是侧栏自己的，这里多套一个 button 会造成缩进与点击冲突
      return h('span', {
        style: {
          position: 'relative', width: size, height: size, lineHeight: size + 'px',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          fontSize: Math.round(size * 0.92), color: 'inherit',
        },
      },
        '🎙',
        busy
          ? h('span', {
            style: {
              position: 'absolute', right: -1, top: -1, width: 5, height: 5, borderRadius: 3,
              background: s.demo && s.demo.running ? T.warn : T.ok,
            },
          })
          : null)
    }

    // ── 会话输入框上方：实时字幕条（滚动一行，不打断输入）──────────────
    function LiveDock() {
      var h = React.createElement, s = useLive(), v = getView(s)
      var last = (s.transcript || [])[s.transcript.length - 1]
      if (v.version && !v.enabled && !v.working) return null
      return h('button', { type: 'button', style: { display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '8px 10px', marginBottom: 6, background: T.bg2, border: '1px solid ' + T.border, borderRadius: 8, fontSize: 12, color: T.text, cursor: 'pointer', textAlign: 'left' }, onClick: function () { store.set(true) }, title: '打开会议助手' }, h('span', { style: { color: toneColor(v.tone), flex: '0 0 auto' } }, v.headline), h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, last && last.text || v.detail))
    }

    // ── 设置页：原生 settings.section ────────────────────────────────
    function SettingsSection() {
      var h = React.createElement
      var s = useLive(), v = getView(s)
      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 680 } },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 10 } },
          h('span', { style: { fontSize: 13 } }, '会议助手'),
          h('span', { style: Object.assign({}, S.tag, { color: s.enabled ? T.ok : T.muted }) },
            v.headline),
          h('span', { style: { flex: 1 } }),
          h('button', {
            style: s.enabled ? S.btn : S.btnPrimary,
            onClick: function () { callAuto(v.enabled ? 'off' : 'start') },
          }, v.enabled ? '关闭自动检测' : '开启自动检测')),

        h(SetupCard),

        // 保存位置：会议（录音/纪要/转写）与导出文件写到哪，用户可以手动改
        h(StorageCard),

        h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
          h('span', { style: { fontSize: 12, color: T.muted, width: 72 } }, '模式'),
          h('button', {
            style: Object.assign({}, s.mode === 'agent' ? S.btn : S.btnPrimary, { height: 26 }),
            onClick: function () { switchMode('transcribe') },
          }, '只转录'),
          h('button', {
            style: Object.assign({}, s.mode === 'agent' ? S.btnPrimary : S.btn, { height: 26 }),
            onClick: function () { switchMode('agent') },
          }, 'Agent 自动回复')),

        h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
          h('span', { style: { fontSize: 12, color: T.muted, width: 72 } }, '采集设备'),
          h('span', { style: { fontSize: 12 } }, (s.session && s.session.captureDevice) || '（自动：系统默认播放设备）')),
        // 采集通道：只采环回时转写里没有用户自己的发言（会议软件不把自己的声音放到输出）
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
          h('span', { style: { fontSize: 12, color: T.muted, width: 72 } }, '采集通道'),
          h('span', { style: { fontSize: 12, color: (s.session && s.session.mixMic && !s.session.micRunning) ? T.warn : T.text } },
            !s.session
              ? '（未开始采集）'
              : s.session.mixMic
                ? ('环回 + 麦克风（' + (s.session.micDeviceLabel || '系统默认采集设备') + '）' + (s.session.micRunning ? '' : ' · 麦克风那一路没在跑'))
                : '只采环回（不含你自己的发言）')),
        (s.session && s.session.mixStats && s.session.mixStats.dropped > 0)
          ? h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
            h('span', { style: { fontSize: 12, color: T.muted, width: 72 } }, '混音'),
            h('span', { style: { fontSize: 11, color: T.warn } },
              '丢弃 ' + Math.round((Number(s.session.mixStats.dropped) || 0) / 32) + ' ms（有一路过慢/中断，那段可能缺了一路的声音）'))
          : null,
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
          h('span', { style: { fontSize: 12, color: T.muted, width: 72 } }, '工作目录'),
          h('span', { style: { fontSize: 12, wordBreak: 'break-all' } },
            (s.workspace && s.workspace.cwd) || '（未确定：开会后继承当前会话目录）')),
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
          h('span', { style: { fontSize: 12, color: T.muted, width: 72 } }, '去重'),
          h('span', { style: { fontSize: 12 } },
            '已跳过 ' + ((s.session && s.session.dupSkipped) || 0) + ' 条重复转写')),

        h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
          h('span', { style: { fontSize: 12, color: T.muted, width: 72 } }, '语音识别'),
          h('span', { style: { fontSize: 12 } },
            (s.session && s.session.asr && s.session.asr.online) ? '已连接' : '未连接'),
          (s.session && s.session.asr && s.session.asr.reconnects > 0)
            ? h('span', { style: { fontSize: 11, color: T.warn } }, '重连 ' + s.session.asr.reconnects + ' 次')
            : null),

        h('div', { style: { borderTop: '1px solid ' + T.border, paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 8 } },
          h('span', { style: { fontSize: 12, color: T.muted } }, '演练（不需要会议软件，用于自检与演示）'),
          h('div', { style: { display: 'flex', gap: 8 } },
            h('button', { style: S.btn, onClick: function () { fetch('/api/soulmirror/demo', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'start', speed: 2 }) }).catch(function () {}) } }, '开始演练'),
            h('button', { style: S.btn, onClick: function () { fetch('/api/soulmirror/demo', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'stop' }) }).catch(function () {}) } }, '停止演练')),
          (s.demo && s.demo.running)
            ? h('span', { style: { fontSize: 11, color: T.warn } }, '演练中（不连接真实会议、不会发言）')
            : null),
      )
    }

  // 光标闪烁动画：只注入一次，避免闪烁效果在部分浏览器里失效
  function ensureStyle() {
    try {
      if (typeof document === 'undefined' || !document.head) return
      if (document.getElementById('sm-caret-style')) return
      var el = document.createElement('style')
      el.id = 'sm-caret-style'
      el.textContent = '@keyframes smCaret{0%,50%{opacity:1}50.01%,100%{opacity:0}}'
      document.head.appendChild(el)
    } catch { /* ignore */ }
  }

    exports.apply = function (ctx) {
    ensureStyle()
      if (ctx.effect) ctx.effect(function () { return stopPolling }, 'soulmirror: status polling')
      var slots = ctx.slots
      if (!slots) return
      slots.inject('sidebar.panellist', function () {
        return slots.register(
          { name: 'sidebar.panellist', id: 'soulmirror', order: 12, label: '会议' },
          function () { return React.createElement(PanelIcon) },
        )
      })
      // 主面板：侧栏选中「会议」时，中间的 keyed slot「main」用它渲染。
      // 没有这一段，点图标只会高亮而右侧仍是首页。
      slots.inject('main', function () {
        return slots.register(
          { name: 'main', key: 'soulmirror', label: '会议' },
          function () {
        return React.createElement(PluginErrorBoundary, null,
          React.createElement(MeetingPage, { embedded: true }))
      },
        )
      })
      slots.inject('conversation.input.dock', function () {
        return slots.register(
          { name: 'conversation.input.dock', id: 'soulmirror-live', order: 30, label: '会议字幕' },
          function () { return React.createElement(LiveDock) },
        )
      })
      // 侧栏入口按钮：点一下展开/收起悬浮侧栏（以前 footer 上那个 🎙 会议）
    slots.inject('sidebar.footer.action', function () {
      return slots.register(
        { name: 'sidebar.footer.action', id: 'soulmirror', order: 11, label: '会议' },
        function () {
          return React.createElement(EntryButton)
        },
      )
    })
    // 悬浮监视窗：只看状态，不含配置（配置统一在 设置 → 会议助手）
    slots.inject('shell.overlay', function () {
      return slots.register(
        { name: 'shell.overlay', id: 'soulmirror', order: 11, label: 'SoulMirror' },
        function () {
          return React.createElement(PluginErrorBoundary, null,
            React.createElement(FloatPanel))
        },
      )
    })
    slots.inject('settings.section', function () {
        return slots.register(
          { name: 'settings.section', id: 'soulmirror', order: 40, label: '会议助手' },
          function () {
        return React.createElement(PluginErrorBoundary, null,
          React.createElement(SettingsSection))
      },
        )
      })
    }

    return module.exports
  },
})
