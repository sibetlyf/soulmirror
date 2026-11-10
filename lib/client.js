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

    var T = {
      bg: 'var(--dsw-alias-bg-layer-1)',
      bg2: 'var(--dsw-alias-bg-layer-2)',
      border: 'var(--dsw-alias-border-l1)',
      brand: 'var(--dsw-alias-brand-primary)',
      text: 'var(--dsw-alias-label-primary)',
      muted: 'var(--dsw-alias-label-secondary)',
      ok: 'var(--dsw-alias-state-success-primary)',
      warn: 'var(--dsw-alias-state-warn-primary)',
      err: 'var(--dsw-alias-state-error-primary)',
      idle: 'var(--dsw-alias-state-idle-primary)',
    }

    var S = {
      dock: {
        position: 'fixed', top: 0, right: 0, bottom: 0, width: 400, maxWidth: '92vw', zIndex: 9000,
        display: 'flex', flexDirection: 'column',
        background: T.bg, color: T.text,
        borderLeft: '1px solid ' + T.border,
        boxShadow: '-8px 0 24px rgba(0,0,0,.10)',
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
        border: '1px solid ' + T.brand, background: T.brand, color: '#fff',
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
      auto: false, armed: false, enabled: false, mode: 'transcribe', state: 'idle', capturing: false, asr: null, lastLlmError: null,
      transcript: [], partial: '', meeting: null, models: null, devices: null, peak: 0, since: null, tasks: [], apps: [], activeApp: '', autoAppSelect: true,
      listeners: [],
      set: function (v) {
        live.auto = !!v.auto
        live.state = v.state || 'idle'
        live.capturing = !!v.capturing
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
        live.listeners.forEach(function (f) { f() })
      },
    }

    var liveTimer = null
    function ensurePolling() {
      if (liveTimer) return
      liveTimer = setInterval(function () {
        fetch('/api/soulmirror/status')
          .then(function (r) { return r.ok ? r.json() : null })
          .then(function (j) {
            if (!j) return
            live.set({
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
            })
          })
          .catch(function () {})
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
      ensure: function (force) {
        if (typeof fetch !== 'function') return
        if (cfgStore.loading) return
        if (cfgStore.data && !force) return
        cfgStore.loading = true
        fetch('/api/soulmirror/config')
          .then(function (r) { return r.json() })
          .then(function (c) { cfgStore.data = c || null; cfgStore.error = ''; cfgStore.emit() })
          .catch(function (e) { cfgStore.error = (e && e.message) || '读取配置失败' })
          .then(function () { cfgStore.loading = false })
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
        reload: function () { cfgStore.ensure(true) },
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
      fetch('/api/soulmirror/auto', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: action }),
      })
        .then(function (r) { return r.json() })
        .then(function (j) {
          if (!j) return
          // 关键：必须同步 enabled/armed，否则按钮不会从"开启"切到"关闭"，看起来像点了没反应
          live.set({
            enabled: j.enabled,
            armed: j.armed,
            auto: j.auto,
            state: j.lifecycle && j.lifecycle.state,
            capturing: j.enabled ? live.capturing : false,
          })
        })
        .catch(function () {})
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
        React.createElement(Row, { label: '策略' }, React.createElement(Field, { value: cfg.policy, options: ['observe', 'suggest', 'auto'], onChange: function (v) { set('policy', v) } })),
        React.createElement(Row, { label: '自动监听' }, React.createElement(Field, { value: cfg.autoWatch ? 'true' : 'false', options: ['true', 'false'], onChange: function (v) { set('autoWatch', v === 'true') } })),

        React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginTop: 14 } },
          React.createElement('button', { style: S.btnPrimary, onClick: save }, '保存'),
          React.createElement('span', { style: S.note }, msg))
      )
    }

    function Panel() {
      var cf = React.useState(false), showCfg = cf[0], setShowCfg = cf[1]
      var cs = React.useState(''), codeInput = cs[0], setCodeInput = cs[1]
      var ms = React.useState(''), joinMsg = ms[0], setJoinMsg = ms[1]
      var lv = useLive()

      React.useEffect(function () {
        var c = lv.meeting && lv.meeting.code
        if (c && !codeInput) setCodeInput(c)
      }, [lv.meeting && lv.meeting.code])

      function detectCode() {
        setJoinMsg('识别中…（先读界面，读不到会打开「会议信息」看一眼）')
        // active=true：允许在被动扫描失败后去点开会议信息面板读一次
        fetch('/api/soulmirror/meeting', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ detect: true, active: true }),
        })
          .then(function (r) { return r.json() })
          .then(function (j) {
            if (j && j.code) {
              setCodeInput(j.code)
              setJoinMsg('自动识别：' + j.code + '（' + (j.app || '') + '）' + (j.reason ? ' · ' + j.reason : ''))
            } else {
              setJoinMsg((j && (j.reason || j.hint)) || '未识别到会议号；可复制会议号/链接到剪贴板后重试')
            }
          })
          .catch(function (e) { setJoinMsg('识别失败：' + e.message) })
      }

      function joinByCode() {
        var code = String(codeInput || '').replace(/[^0-9]/g, '')
        if (!code) { setJoinMsg('请先输入会议号'); return }
        setJoinMsg('正在加入 ' + code + ' …')
        fetch('/api/soulmirror/join', {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: code }),
        })
          .then(function (r) { return r.json() })
          .then(function (j) { setJoinMsg((j.ok ? '已加入：' : '加入失败：') + (j.result || '')) })
          .catch(function (e) { setJoinMsg('加入失败：' + e.message) })
      }

      React.useEffect(function () {
        function onKey(e) { if (e.key === 'Escape') store.set(false) }
        window.addEventListener('keydown', onKey)
        return function () { window.removeEventListener('keydown', onKey) }
      }, [])

      var inMeeting = lv.state === 'in-meeting'
      var dotColor = !lv.auto ? T.idle : (inMeeting ? T.ok : T.warn)
      var stateLabel = !lv.auto ? '未监听' : (inMeeting ? '会议中' : '监听中')
      var lines = lv.transcript || []
      var follow = useFollowBottom(lines.length)
      var startedAt = lv.since ? new Date(lv.since) : null

      return React.createElement('div', { style: S.dock },
        React.createElement('div', { style: S.header },
          React.createElement('span', { style: Object.assign({}, S.dot, { background: dotColor }) }),
          React.createElement('span', { style: S.title }, 'SoulMirror'),
          React.createElement('span', { style: Object.assign({}, S.tag, { color: dotColor }) }, stateLabel),
          React.createElement('span', { style: { flex: 1 } }),
          React.createElement('button', { style: Object.assign({}, S.btn, { height: 24 }), onClick: function () { setShowCfg(!showCfg) } }, showCfg ? '返回' : '配置'),
          React.createElement('button', { style: S.iconBtn, title: '关闭（Esc）', onClick: function () { store.set(false) } }, '✕')
        ),
        React.createElement(React.Fragment, null,
          React.createElement(StatusStrip, {}),
          React.createElement(DepsCard, {}),
          (!lv.models) ? React.createElement('div', { style: { padding: '8px 12px', borderBottom: '1px solid ' + T.border, color: T.warn, fontSize: 11 } }, '宿主未提供实时数据（旧版本），重启 DSH 后生效') : null,
          React.createElement('div', { style: S.meta },
            React.createElement('div', { style: S.metaRow },
              React.createElement('span', { style: S.metaLabel }, '模式'),
              React.createElement('button', {
                style: Object.assign({}, lv.mode === 'agent' ? S.btn : S.btnPrimary, { height: 24, flex: 1 }),
                onClick: function () { switchMode('transcribe') },
              }, '只转录'),
              React.createElement('button', {
                style: Object.assign({}, lv.mode === 'agent' ? S.btnPrimary : S.btn, { height: 24, flex: 1 }),
                onClick: function () { switchMode('agent') },
              }, 'Agent 自动回复')),
            React.createElement('div', { style: S.metaRow },
              React.createElement('span', { style: S.metaLabel }, '接入'),
              React.createElement('span', { style: S.metaValue }, cur.name),
              React.createElement('span', { style: S.tag }, cur.source),
              React.createElement('span', { style: S.tag }, (lv.meeting && lv.meeting.title) || '无会议')),
            React.createElement('div', { style: S.metaRow },
              React.createElement('span', { style: S.metaLabel }, '抓取'),
              React.createElement('select', {
                style: Object.assign({}, S.field, { height: 24 }),
                value: lv.activeApp || '',
                onChange: function (e) { switchApp(e.target.value) },
              },
                React.createElement('option', { value: '' }, '自动跟随'),
                (lv.apps || []).map(function (a) {
                  return React.createElement('option', { key: a.name, value: a.name }, a.name + (a.proc ? ' · ' + a.proc : ''))
                })),
              React.createElement('span', { style: S.tag }, lv.activeApp ? '手动' : '自动')),
            React.createElement('div', { style: Object.assign({}, S.note, { padding: '4px 0', color: lv.armed ? T.ok : T.muted }) }, lv.armed ? '● 会议功能已开启：会自动采集、入会、标定' : '○ 会议功能未开启（不会自动操作）'),
            React.createElement('div', { style: S.metaRow },
              React.createElement('span', { style: S.metaLabel }, '会议号'),
              React.createElement('input', {
                style: Object.assign({}, S.field, { height: 24 }),
                value: codeInput,
                placeholder: '自动识别或手动输入',
                onChange: function (e) { setCodeInput(e.target.value) },
              }),
              React.createElement('span', { style: S.tag }, (lv.meeting && lv.meeting.codeSource) === 'manual' ? '手动' : ((lv.meeting && lv.meeting.codeSource) === 'auto' ? '自动' : '未识别')),
              React.createElement('button', { style: Object.assign({}, S.btn, { height: 24 }), onClick: detectCode }, '识别'),
              React.createElement('button', {
              style: Object.assign({}, lv.meeting && lv.meeting.inMeeting ? S.btn : S.btnPrimary, { height: 24 }),
              onClick: joinByCode,
              disabled: !!(lv.meeting && lv.meeting.inMeeting),
            }, (lv.meeting && lv.meeting.inMeeting) ? '已在会中' : '确认入会')),
            joinMsg ? React.createElement('div', { style: Object.assign({}, S.note, { lineHeight: '17px' }) }, joinMsg) : null,
            React.createElement('div', { style: S.metaRow },
              React.createElement('span', { style: S.metaLabel }, '时长'),
              React.createElement('span', { style: S.metaValue }, startedAt ? Math.max(0, Math.round((Date.now() - startedAt.getTime()) / 60000)) + ' 分钟' : '—'),
              React.createElement('span', { style: S.tag }, '峰值 ' + Number(lv.peak || 0).toFixed(3)),
              React.createElement('span', { style: S.tag }, lines.length + ' 句')),
            React.createElement('div', { style: S.metaRow },
              React.createElement('span', { style: S.metaLabel }, '模型'),
              React.createElement('span', { style: S.metaValue }, (lv.models && lv.models.asr) || '—')),
            React.createElement(DevicePicker, { value: (lv.devices && lv.devices.capture) || '' })
          ),
          (lv.tasks && lv.tasks.length) ? React.createElement('div', { style: { padding: '6px 12px', borderBottom: '1px solid ' + T.border } },
            React.createElement('div', { style: { fontSize: 11, color: T.muted, marginBottom: 4 } }, '任务'),
            lv.tasks.slice(0, 3).map(function (x, i) {
              var st = x.status === 'running' ? '执行中' : (x.ok ? '完成' : '失败')
              var color = x.status === 'running' ? T.warn : (x.ok ? T.ok : T.err)
              return React.createElement('div', { key: i, style: { display: 'flex', gap: 6, fontSize: 11, lineHeight: '18px' } },
                React.createElement('span', { style: { color: color, flex: '0 0 auto' } }, st),
                React.createElement('span', { style: { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: T.muted } }, x.prompt))
            })
          ) : null,
          React.createElement('div', { style: S.list, ref: follow.elRef, onScroll: follow.onScroll },
            lines.length === 0
              ? React.createElement('div', { style: S.empty }, lv.auto ? '等待会议里的声音…' : '点击下方「开始监听」')
              : null,
            lines.map(function (l, i) {
              var isBot = l.role === 'assistant'
              return React.createElement('div', {
                key: i,
                style: Object.assign({}, S.row, isBot ? { background: T.bg2, borderRadius: 6, padding: '6px 8px' } : {}),
              },
                React.createElement('span', { style: S.time }, (l.t || '').slice(11, 19)),
                React.createElement('span', { style: Object.assign({}, S.speaker, isBot ? { color: T.ok } : {}) }, isBot ? 'SoulMirror' : (l.speaker || '—')),
                React.createElement('span', { style: Object.assign({}, S.text, isBot ? { color: T.text, fontWeight: 500 } : {}) }, l.text))
            }),
            lv.partial
              ? React.createElement('div', { style: Object.assign({}, S.row, { opacity: 0.85 }) },
                React.createElement('span', { style: S.time }, (new Date()).toTimeString().slice(0, 8)),
                React.createElement('span', { style: Object.assign({}, S.speaker, { color: T.warn }) }, '识别中'),
                React.createElement(TypeLine, { text: lv.partial }))
              : null
          ),
          React.createElement('div', { style: S.footer },
            React.createElement('button', {
              style: lv.enabled ? S.btn : S.btnPrimary,
              onClick: function () { callAuto(lv.enabled ? 'stop' : 'start') },
            }, lv.enabled ? '● 已开启（点击关闭）' : '○ 开启会议插件'),
            React.createElement('span', { style: Object.assign({}, S.note, { color: lv.enabled ? T.ok : T.muted }) },
              lv.enabled ? '各路功能已生效' : '未开启：不采集、不发言、不操作桌面'),
            React.createElement('span', { style: { flex: 1 } }),
            React.createElement('span', { style: S.note }, 'Esc 关闭')
          ),
          showCfg ? React.createElement('div', { style: { flex: '0 1 auto', minHeight: 0, overflowY: 'auto', borderTop: '1px solid ' + T.border } },
            React.createElement(ConfigTab)) : null
        )
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

    function MeetingPage(props) {
      var h = React.createElement
      var lv = useLive()
    var cur = pickActiveApp(lv)
      var cfgState = React.useState(false), showCfg = cfgState[0], setShowCfg = cfgState[1]
      var codeState = React.useState(''), code = codeState[0], setCode = codeState[1]
      var msgState = React.useState(''), pageMsg = msgState[0], setPageMsg = msgState[1]
      var modelsState = React.useState(null), models = modelsState[0], setModels = modelsState[1]
      var audioState = React.useState(''), audio = audioState[0], setAudio = audioState[1]
      var recState = React.useState(false), recording = recState[0], setRecording = recState[1]
      var recRef = React.useRef(null)
      var chunkRef = React.useRef([])
      // 共享配置（大小页面同一个来源）
      var csPage = useConfig()
      var cfg = csPage.data
      var setCfg = csPage.set

      React.useEffect(function () {
        // 配置由 useConfig() 统一加载，这里不再单独请求
        fetch('/api/soulmirror/models').then(function (r) { return r.json() }).then(setModels).catch(function () {})
      }, [])

      React.useEffect(function () {
        var c = lv.meeting && lv.meeting.code
        if (c && !code) setCode(c)
      }, [lv.meeting && lv.meeting.code])

      function joinNow() {
        var v = String(code || '').replace(/[^0-9]/g, '')
        if (!v) { setPageMsg('请先输入会议号'); return }
        setPageMsg('正在加入 ' + v + ' …')
        fetch('/api/soulmirror/join', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: v }) })
          .then(function (r) { return r.json() })
          .then(function (j) { setPageMsg((j.ok ? '已加入：' : '加入失败：') + (j.result || '')) })
          .catch(function (e) { setPageMsg('加入失败：' + e.message) })
      }

      function detectAll() {
        setPageMsg('探测模型中…')
        fetch('/api/soulmirror/models').then(function (r) { return r.json() }).then(function (j) {
          setModels(j)
          var d = j.llm && j.llm.default
          setPageMsg('探测完成：' + (d ? d.provider + '/' + d.model + '；' : '') + 'TTS 音色 ' + ((j.tts && j.tts.voices) || []).length + ' 个')
        }).catch(function (e) { setPageMsg('探测失败：' + e.message) })
      }

      function pickFile(e) {
        var f = e.target.files && e.target.files[0]
        if (!f) return
        var rd = new FileReader()
        rd.onload = function () { setAudio(String(rd.result || '')); setPageMsg('已选择 ' + f.name) }
        rd.readAsDataURL(f)
      }

      function toggleRecord() {
        if (recording) { try { recRef.current && recRef.current.stop() } catch { /* ignore */ } setRecording(false); return }
        navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
          var mr = new MediaRecorder(stream)
          chunkRef.current = []
          mr.ondataavailable = function (ev) { if (ev.data && ev.data.size) chunkRef.current.push(ev.data) }
          mr.onstop = function () {
            stream.getTracks().forEach(function (t) { t.stop() })
            setRecording(false); setPageMsg('录音结束，转 WAV…')
            blobToWavDataUrl(new Blob(chunkRef.current, { type: 'audio/webm' }))
              .then(function (url) { setAudio(url); setPageMsg('录音已转 WAV') })
              .catch(function (e) { setPageMsg('转 WAV 失败：' + e.message) })
          }
          recRef.current = mr; mr.start(); setRecording(true); setPageMsg('录音中…再次点击停止')
        }).catch(function (e) { setPageMsg('无法录音：' + e.message) })
      }

      function cloneNow() {
        if (!audio) { setPageMsg('请先选择文件或录音'); return }
        setPageMsg('克隆中…')
        fetch('/api/soulmirror/voice/clone', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ audio: audio, prefix: cfg && cfg.tts && cfg.tts.clonePrefix, targetModel: cfg && cfg.tts && cfg.tts.model, workspaceId: cfg && cfg.tts && cfg.tts.workspaceId }),
        }).then(function (r) { return r.json() }).then(function (j) {
          if (!j.ok) { setPageMsg('克隆失败：' + (j.error || '')); return }
          setPageMsg('已创建音色 ' + j.voiceId + (j.workspaceId ? '，WorkspaceId=' + j.workspaceId : '') + '，已写入默认配置')
        }).catch(function (e) { setPageMsg('克隆失败：' + e.message) })
      }

      var inMeeting = !!(lv.meeting && lv.meeting.inMeeting)
      var appOptions = [{ name: '腾讯会议', proc: 'wemeetapp' }, { name: '移动会议', proc: 'CloudVideo' }]
      ;(lv.apps || []).forEach(function (a) {
        if (a && a.name && !appOptions.some(function (x) { return x.name === a.name })) appOptions.push(a)
      })
      var tasks = lv.tasks || []
      var lines = lv.transcript || []
      var tts = (models && models.tts) || {}
      var voices = tts.voices || []

      return h('div', { style: { height: '100%', overflowY: 'auto', display: 'flex', flexDirection: 'column', background: T.bg, color: T.text, padding: '20px clamp(16px,3vw,36px) 44px', boxSizing: 'border-box' } },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 16 } },
          h('h1', { style: { margin: 0, fontSize: 20, fontWeight: 500 } }, '会议助手'),
          h('span', { style: Object.assign({}, S.tag, { color: lv.enabled ? T.ok : T.muted }) }, lv.enabled ? (inMeeting ? '会议中' : '已启用') : '未启用'),
          h('span', { style: S.note }, lv.meeting ? ((lv.meeting.app || '') + ' · ' + (lv.meeting.title || '')) : '未检测到会议'),
          h('span', { style: { flex: 1 } }),
          // 模式开关（大页面）
          h('button', {
            style: Object.assign({}, lv.mode === 'agent' ? S.btn : S.btnPrimary,
              { background: lv.mode === 'agent' ? undefined : T.brand, color: lv.mode === 'agent' ? undefined : '#fff' }),
            onClick: function () { switchMode('transcribe') },
          }, '只转录'),
          h('button', {
            style: Object.assign({}, lv.mode === 'agent' ? S.btnPrimary : S.btn,
              { background: lv.mode === 'agent' ? T.brand : undefined, color: lv.mode === 'agent' ? '#fff' : undefined }),
            onClick: function () { switchMode('agent') },
          }, 'Agent 自动回复'),
          h('button', { style: lv.enabled ? S.btn : S.btnPrimary, onClick: function () { callAuto(lv.enabled ? 'stop' : 'start') } }, lv.enabled ? '停止会议助手' : '启用会议助手'),
          h('button', { style: lv.mode ? S.btn : S.btn, onClick: function () { setShowCfg(!showCfg) } }, showCfg ? '收起设置' : '设置'),
          props && props.onCompact ? h('button', { style: S.btn, onClick: props.onCompact }, '小窗') : null,
          props && props.onClose ? h('button', { style: S.btn, onClick: props.onClose }, '关闭') : null),

        h(SetupCard, { compact: true }),
        h('div', { style: { marginBottom: 12 } }, h(StatusStrip, { padding: 0 })),
        showCfg ? h('div', { style: { marginBottom: 12 } }, h(Card, { title: '设置' }, h(ConfigTab))) : null,
        h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 10, marginBottom: 12 } },
          h(Stat, { label: '接入软件', value: (lv.meeting && lv.meeting.app) || '—' }),
          h(Stat, { label: '会议号', value: (lv.meeting && lv.meeting.code) || '未识别' }),
          h(Stat, { label: '转写', value: lines.length + ' 句' }),
          h(Stat, { label: '任务', value: tasks.length + ' 个' }),
          h(Stat, { label: 'TTS 音色', value: (cfg && cfg.tts && (cfg.tts.cloneVoiceId || cfg.tts.voice)) || '—' })),

        h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(320px,1fr))', gap: 12, alignItems: 'start' } },
          h(Card, { title: '会中建议', style: { gridColumn: '1 / -1' } },
            h(AdviceViews, { lines: lines })),

          h(Card, { title: 'Agent 发言', style: { gridColumn: '1 / -1' } },
            h(ReplyPanel)),

          h(Card, { title: '开关', style: { gridColumn: '1 / -1' } },
            h(SwitchesCard)),

          h(Card, { title: '会前准备' }, h(PrepareCard)),

          h(Card, { title: '会议接入' },
            h('div', { style: { display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 } },
              h('span', { style: { color: T.muted, fontSize: 11, width: 40, flex: '0 0 auto' } }, '软件'),
              h('select', {
                style: Object.assign({}, S.field, { height: 30 }),
                value: lv.activeApp || '',
                onChange: function (e) { switchApp(e.target.value); setPageMsg(e.target.value ? '已切换到 ' + e.target.value : '已切换为自动跟随') },
              },
                h('option', { value: '' }, '自动跟随（腾讯会议 / 移动会议）'),
                appOptions.map(function (a) {
                  return h('option', { key: a.name, value: a.name }, a.name + (a.proc ? ' · ' + a.proc : ''))
                })),
              h('span', { style: S.tag }, lv.activeApp ? '手动' : '自动')),
            h('div', { style: { display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 } },
              h('span', { style: { color: T.muted, fontSize: 11, width: 40, flex: '0 0 auto' } }, '会议号'),
              h('input', { style: Object.assign({}, S.field, { height: 30 }), value: code, placeholder: '自动识别或手动输入会议号', onChange: function (e) { setCode(e.target.value) } }),
              h('span', { style: S.tag }, (lv.meeting && lv.meeting.codeSource) === 'manual' ? '手动' : ((lv.meeting && lv.meeting.codeSource) === 'auto' ? '自动' : '未识别')),
              h('button', { style: inMeeting ? S.btn : S.btnPrimary, disabled: inMeeting, onClick: joinNow }, inMeeting ? '已在会中' : '入会')),
            h('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap' } },
              h('button', { style: S.btn, onClick: function () { fetch('/api/soulmirror/meeting', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ detect: true }) }).then(function (r) { return r.json() }).then(function (j) { if (j.code) setCode(j.code); setPageMsg(j.code ? '自动识别到 ' + j.code + '（' + (j.app || '') + '）' : '未识别到会议号') }) } }, '自动识别会议号'),
              h('button', { style: S.btn, onClick: detectAll }, '探测模型/音色')),
            pageMsg ? h('div', { style: Object.assign({}, S.note, { marginTop: 8, lineHeight: '17px' }) }, pageMsg) : null),

          h('details', { style: { gridColumn: '1 / -1', border: '1px solid ' + T.border, borderRadius: 8, padding: '6px 10px', background: T.bg2 } },
            h('summary', { style: { cursor: 'pointer', fontSize: 12, color: T.muted } }, '更多设置（模型 / 音色 / 任务）'),
            h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))', gap: 12, marginTop: 10 } },
  h(Card, { title: '语音与任务模型' },
              h('div', { style: { display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '6px 10px', fontSize: 12 } },
                h('span', { style: { color: T.muted } }, 'ASR'), h('span', null, (lv.models && lv.models.asr) || '—'),
                h('span', { style: { color: T.muted } }, 'TTS'), h('span', null, (lv.models && lv.models.tts) || '—'),
                h('span', { style: { color: T.muted } }, '默认模型'), h('span', null, (models && models.llm && models.llm.default) ? (models.llm.default.provider + '/' + models.llm.default.model) : '沿用 DSH 默认'),
                h('span', { style: { color: T.muted } }, '音色库'), h('span', null, voices.length ? voices.slice(0, 3).join('、') : '未探测')),
              h('div', { style: { display: 'flex', justifyContent: 'flex-end', marginTop: 10 } },
                h('button', { style: S.btn, onClick: detectAll }, '探测语音模型'))),

            h(Card, { title: '声音克隆' },
              h('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 } },
                h('input', { type: 'file', accept: 'audio/*', onChange: pickFile, style: { fontSize: 11, flex: 1, minWidth: 130, color: T.muted } }),
                h('button', { style: S.btn, onClick: toggleRecord }, recording ? '停止录音' : '录音')),
              h('div', { style: S.note }, audio ? ('已准备参考音频（' + Math.round(audio.length / 1024) + ' KB base64）') : '选择 WAV/MP3 或录音，参考音频会转成 Base64 上传'),
              h('div', { style: { display: 'flex', justifyContent: 'flex-end', marginTop: 10 } },
                h('button', { style: S.btnPrimary, onClick: cloneNow }, '克隆并设为发言音色'))),

            h(Card, { title: '最近任务' },
              tasks.length === 0 ? h('div', { style: S.note }, '暂无任务')
                : tasks.slice(0, 5).map(function (x, i) {
                  var st = x.status === 'running' ? '执行中' : (x.ok ? '完成' : '失败')
                  var color = x.status === 'running' ? T.warn : (x.ok ? T.ok : T.err)
                  return h('div', { key: i, style: { display: 'flex', gap: 8, padding: '3px 0', fontSize: 12 } },
                    h('span', { style: { color: color, flex: '0 0 auto' } }, st),
                    h('span', { style: { color: T.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, x.prompt))
                })))
            )),

          h(IssueBanner, null),
      h(HealthCheck, null),
      h(ProgressBar, null),
      h(Card, { title: '会后整理' }, h('div', { style: { display: 'flex', flexDirection: 'column', gap: 10 } },
            h(AfterMeetingCard),
            h(RecoveryCard))),

          h(Card, { title: '回看' }, h(RecordsCard)),

        h('div', { style: { marginTop: 12, order: -1 } },
          h(Card, { title: '会议内容', extra: h('span', { style: { display: 'flex', gap: 8, alignItems: 'center' } },
            h('button', {
              style: Object.assign({}, S.btn, { height: 22, padding: '0 8px', fontSize: 11 }),
              title: '把最近的转写作为上下文送进当前会议会话（会花一次模型调用）',
              onClick: function () {
                if (typeof fetch !== 'function') return
                fetch('/api/soulmirror/context', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
                  .then(function (r) { return r.json() })
                  .then(function (j) {
                    if (j && j.ok) alert('已把 ' + (j.lines || 0) + ' 句转写送进会话')
                    else alert('发送失败：' + ((j && (j.error || j.skipped)) || '未知'))
                  })
                  .catch(function (e) { alert('发送失败：' + e.message) })
              },
            }, '发给 Agent'),
            h('span', { style: S.note }, lines.length + ' 句'))},
            (lines.length === 0 && !lv.partial) ? h('div', { style: S.note }, lv.enabled ? '等待会议里的声音…' : '启用会议助手后开始采集')
              : h('div', { style: { maxHeight: 460, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 } },
                lines.slice(-80).map(function (l, i) {
                  var bot = l.role === 'assistant'
                  return h('div', { key: i, style: { display: 'flex', gap: 8, padding: '3px 0', borderBottom: '1px solid ' + T.border, fontSize: 12 } },
                    h('span', { style: { color: T.muted, width: 50, flex: '0 0 auto' } }, (l.t || '').slice(11, 19)),
                    h('span', { style: { color: bot ? T.ok : T.brand, maxWidth: 90, flex: '0 0 auto', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, bot ? 'SoulMirror' : (l.speaker || '—')),
                    h('span', { style: { flex: 1 } }, l.text))
                }))))
      )
    }

    // 侧栏小窗：参考 vianvio/dsh-plugin-meeting-assistant 的侧栏结构
    //   顶部 = 会议状态 + 时长 + 展开/关闭
    //   控制条 = 开始/结束录音
    //   内容 = 标签页（转写 / 会后）
    /**
     * 转录 / 会后整理进度条 —— 大页面与小窗都会用到。
     *
     * 用户的抱怨："大小页面都没显示转录进度"。
     * 之前只有「会后整理」卡片里有进度，而且在大页面的某个标签页里，
     * 小窗完全没有。所以抽成一个组件，两处都放。
     *
     * 两种内容：
     *   · 会后整理在跑 → 阶段 / 百分比 / 耗时 / 明细 + 进度条
     *   · 会中转录      → 已识别时长 / 句数 / 最后一句多久前（有活动感）
     */
    /**
     * 问题横幅：把当前故障显式打在页面上，而不是让人去猜。
     *
     * 用户要求："需要及时提示目前转录插件出现的问题，以便排查"。
     * 数据来自 /status.issues（后端用 lib/issues.js 汇总）：
     *   第一条是最该处理的，点"详情"展开全部，点"复制"得到可直接粘给别人的排查文本。
     */
    function IssueBanner(props) {
      var h = React.createElement
      var lv = useLive()
      var list = (lv && lv.issues) || []
      var open = React.useState(false), expanded = open[0], setExpanded = open[1]
      var cp = React.useState(''), copied = cp[0], setCopied = cp[1]
      if (!list.length) return null

      var first = list[0]
      var isErr = first.level === 'error'
      var color = isErr ? T.err : T.warn

      function reportText() {
        var lines = []
        for (var i = 0; i < list.length; i++) {
          var it = list[i]
          lines.push((i + 1) + '. [' + it.level + '] ' + it.title)
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

      return h('div', {
        style: {
          border: '1px solid ' + color, background: isErr ? 'rgba(208,51,51,.06)' : 'rgba(230,152,0,.08)',
          borderRadius: 8, padding: '7px 10px', margin: '6px 0', display: 'flex',
          flexDirection: 'column', gap: 4, fontSize: 11,
        },
      },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
          h('span', { style: { color: color, fontWeight: 600, flex: '0 0 auto' } }, isErr ? '⚠ 转录异常' : '提示'),
          h('span', { style: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
            first.title + (first.detail ? '：' + first.detail : '')),
          list.length > 1
            ? h('button', { style: Object.assign({}, S.btn, { height: 20, padding: '0 6px' }), onClick: function () { setExpanded(!expanded) } },
                expanded ? '收起' : ('全部 ' + list.length + ' 条'))
            : null,
          h('button', { style: Object.assign({}, S.btn, { height: 20, padding: '0 6px' }), onClick: copy },
            copied || '复制排查信息')),
        first.fix ? h('div', { style: { color: color, opacity: 0.95 } }, '→ ' + first.fix) : null,
        expanded
          ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: 4, marginTop: 2 } },
              list.map(function (it, i) {
                return h('div', { key: it.id || i, style: { borderTop: '1px solid ' + T.border, paddingTop: 4 } },
                  h('div', { style: { color: T.text } }, (i + 1) + '. ' + it.title),
                  it.detail ? h('div', { style: { color: T.muted } }, '· ' + it.detail) : null,
                  it.fix ? h('div', { style: { color: T.muted } }, '→ ' + it.fix) : null)
              }))
          : null)
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
    function FloatPanel() {
      var h = React.createElement
      var lv = useLive()
      var st = React.useState(false), closed = st[0], setClosed = st[1]
      var pm = lv.postMeeting || {}
      var phase = pm.phase || 'idle'
      var running = phase === 'stopping' || phase === 'offline' || phase === 'minutes'
      var capturing = !!lv.capturing
      var lines = lv.transcript || []
      var last = lines.length ? lines[lines.length - 1] : null

      // 采集/整理结束后自动复位"已关闭"，下一场会再出现
      React.useEffect(function () {
        if (!capturing && !running) setClosed(false)
      }, [capturing, running])

      if (closed) return null

      // 什么时候显示：
      //   · 只要用户没关掉，就一直显示（用户反馈"没看到"——
      //     之前只在采集/整理时渲染，插件没开就完全看不到，等于没法发现它）
      //   · 未启用时也显示，并直接说明"未启用 · 去设置开启"
      var enabled = !!lv.enabled

      var secs = Math.floor((((lv.asr || {}).sentMs) || 0) / 1000)
      var status = running
        ? ({ stopping: '正在收尾', offline: '转写中', minutes: '生成纪要中' }[phase] || phase)
        : (capturing ? '转录中' : (enabled ? '待命（未在会议中）' : '未启用 · 去设置开启'))

      return h('div', {
        style: {
          position: 'fixed', right: 16, bottom: 16, width: 300, zIndex: 9500,
          background: T.bg, color: T.text, border: '1px solid ' + T.border, borderRadius: 10,
          boxShadow: '0 8px 28px rgba(0,0,0,.18)', font: '12px/1.5 var(--dsw-font-family, system-ui), "Microsoft YaHei", sans-serif',
          display: 'flex', flexDirection: 'column', gap: 4, padding: '8px 10px',
        },
      },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 6 } },
          h('span', { style: Object.assign({}, S.dot, { background: running ? T.warn : (capturing ? T.ok : T.idle) }) }),
          h('span', { style: { fontWeight: 600 } }, status),
          h('span', { style: { color: T.muted, flex: 1 } }, capturing ? (Math.floor(secs / 60) + ':' + String(secs % 60).padStart(2, '0')) : ''),
          (capturing || running) ? h('span', { style: { color: T.muted } }, lines.length + ' 句') : null,
          h('button', { style: Object.assign({}, S.iconBtn, { height: 18, padding: '0 4px' }), title: '关闭（本场不再显示）', onClick: function () { setClosed(true) } }, '✕')),
        h(IssueBanner, null),
        h(ProgressBar, null),
        last ? h('div', { style: { color: T.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
          String(last.text || '').slice(0, 60)) : null,
        h('div', { style: { color: T.muted, opacity: 0.8, fontSize: 10 } }, '点侧栏「会议」看详情 · 配置在 设置 → 会议助手'))
    }

    function ProgressBar(props) {
      var h = React.createElement
      var lv = useLive()
      var s = (props && props.state) || lv || {}
      var pm = s.postMeeting || {}
      var phase = pm.phase || 'idle'
      var running = phase !== 'idle' && phase !== 'done' && phase !== 'error'

      // 会后整理：显示真实阶段
      if (phase && phase !== 'idle') {
        var map = {
          stopping: '正在收尾', offline: '转写中（非流式）',
          minutes: '生成纪要中', done: '整理完成', error: '整理失败',
        }
        var label = map[phase] || phase
        var pct = typeof pm.percent === 'number' ? pm.percent : null
        var stage = pm.stageLabel || ''
        var detail = pm.detail || ''
        var elapsed = typeof pm.elapsedSec === 'number' ? pm.elapsedSec : null

        var head = label
        if (phase === 'done') {
          head += '：' + (pm.sentences || 0) + ' 句' + (pm.speakers ? ' · ' + pm.speakers + ' 位说话人' : '')
        } else if (phase === 'error') {
          head += '：' + String(pm.error || '').slice(0, 40)
        } else if (stage) {
          head += ' · ' + stage
        }
        if (pct != null && running) head += ' · ' + pct + '%'
        if (elapsed != null && running) head += ' · 已用 ' + elapsed + 's'

        return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 3, padding: '6px 0' } },
          h('div', { style: { fontSize: 11, color: phase === 'error' ? T.err : T.muted } }, head),
          (pct != null && running)
            ? h('div', { style: { height: 4, background: T.bg2, borderRadius: 2, overflow: 'hidden' } },
                h('div', { style: { width: Math.max(2, Math.min(100, pct)) + '%', height: '100%', background: T.brand, transition: 'width .4s' } }))
            : null,
          (detail && running) ? h('div', { style: { fontSize: 10, color: T.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, detail) : null)
      }

      // 会中转录：显示"在动"的证据
      var asr = s.asr || (s.session && s.session.asr) || {}
      var sentS = Math.floor((asr.sentMs || 0) / 1000)
      var lines = s.transcript || []
      var last = lines.length ? lines[lines.length - 1] : null
      var lastAt = last ? (Date.parse(last.t || '') || 0) : 0
      var age = lastAt ? Math.max(0, Math.round((Date.now() - lastAt) / 1000)) : null

      if (!s.capturing && !sentS) return null

      var bits = []
      if (s.capturing) bits.push('转录中')
      bits.push(lines.length + ' 句')
      if (sentS) bits.push('已识别 ' + Math.floor(sentS / 60) + ' 分 ' + (sentS % 60) + ' 秒')
      if (age != null) bits.push(age < 60 ? (age + ' 秒前有过转写') : '最近一句 ' + Math.round(age / 60) + ' 分钟前')

      return h('div', { style: { fontSize: 11, color: T.muted, padding: '6px 0' } }, bits.join(' · '))
    }

    // 测试出口：让冒烟测试能直接渲染各面板，抓出"组件里用了未声明变量"这类白屏问题
    exports.__test = {
      get MeetingPage() { return MeetingPage },
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
      get ContextSettings() { return ContextSettings },
      get TypeLine() { return TypeLine },
      get AdviceViews() { return AdviceViews },
      get ReplyPanel() { return ReplyPanel },
      get SwitchesCard() { return SwitchesCard },
      get DevicePicker() { return DevicePicker },
      get live() { return live },
      get store() { return store },
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

    // 导出：取文本 → 前端生成下载（不写后端临时文件）
    function exportRecord(dir, format) {
      if (typeof fetch !== 'function' || typeof document === 'function' === false) {
        // document 不存在时（测试环境）直接跳过
        if (typeof document === 'undefined') return Promise.resolve({ ok: false, error: '当前环境不支持下载' })
      }
      return fetch('/api/soulmirror/record/export?dir=' + encodeURIComponent(dir) + '&format=' + encodeURIComponent(format))
        .then(function (r) { return r.json() })
        .then(function (j) {
          if (!j || !j.ok) return { ok: false, error: (j && j.error) || '导出失败' }
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
            return { ok: true, fileName: j.fileName }
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
          setMsg(r.ok ? ('已导出 ' + r.fileName) : ('导出失败：' + r.error))
        })
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
            h('button', { style: Object.assign({}, S.btn, { height: 24 }), onClick: function () { doExport('txt') } }, '导出文本')),
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
      var h = React.createElement
      var st = React.useState(''), msg = st[0], setMsg = st[1]
      var bs = React.useState(false), busy = bs[0], setBusy = bs[1]
      var rs = React.useState(null), result = rs[0], setResult = rs[1]

      function run() {
        if (busy) return
        setBusy(true)
        setMsg('正在上传录音并识别（分人）…可能需要几十秒')
        if (typeof fetch !== 'function') { setBusy(false); return }
        fetch('/api/soulmirror/offline', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
          .then(function (r) { return r.json() })
          .then(function (j) {
            setBusy(false)
            setResult(j || null)
            if (j && j.ok) {
              setMsg('完成：' + j.sentences + ' 句' + (j.speakers ? ' · ' + j.speakers + ' 位说话人' : '') +
                ' · 用时 ' + j.elapsed + ' 秒' + (j.mode === 'replay' ? '（云端不可用，本地重放）' : ''))
            } else {
              setMsg('失败：' + ((j && j.error) || '未知原因'))
            }
          })
          .catch(function (e) { setBusy(false); setMsg('失败：' + e.message) })
      }

      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
        (function () {
          var lv2 = useLive()
          var pm = lv2 && lv2.postMeeting
          if (!pm || !pm.phase || pm.phase === 'idle') return null
        var map = {
          stopping: '正在收尾', offline: '转写中（非流式）',
          minutes: '生成纪要中', done: '已完成', error: '失败',
        }
        // 阶段 + 明细 + 百分比 + 耗时：用户要能看出"卡在哪、还要多久"
        var stageText = pm.stageLabel || ''
        var detailText = pm.detail || ''
        var pct = typeof pm.percent === 'number' ? pm.percent : null
        var elapsed = typeof pm.elapsedSec === 'number' ? pm.elapsedSec : null
        var head = (map[pm.phase] || pm.phase)
        if (pm.phase === 'done') {
          head += '：' + (pm.sentences || 0) + ' 句' + (pm.speakers ? ' · ' + pm.speakers + ' 位说话人' : '')
        } else if (pm.phase === 'error') {
          head += '：' + (pm.error || '')
        } else if (stageText) {
          head += ' · ' + stageText
        }
        return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 4 } },
          h('div', { style: { fontSize: 11, color: pm.phase === 'error' ? T.err : T.muted } },
            head + (pct != null && pm.phase !== 'done' && pm.phase !== 'error' ? ' · ' + pct + '%' : '') +
            (elapsed && pm.phase !== 'done' ? ' · 已用 ' + elapsed + 's' : '')),
          // 进度条：只在跑的时候显示，避免"完成了还显示 80%"
          (pct != null && pm.phase !== 'done' && pm.phase !== 'error')
            ? h('div', { style: { height: 4, background: T.bg2, borderRadius: 2, overflow: 'hidden' } },
                h('div', { style: { width: Math.max(2, Math.min(100, pct)) + '%', height: '100%', background: T.accent || T.ok, transition: 'width .4s' } }))
            : null,
          detailText ? h('div', { style: { fontSize: 11, color: T.muted } }, detailText) : null)
      })(),
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
          h('span', { style: { fontSize: 12, color: T.muted, flex: 1 } },
            '会后用整段录音重跑一遍识别：能分说话人、补齐实时漏掉的句子，纪要会写进知识库'),
          h('button', {
            style: Object.assign({}, busy ? S.btn : S.btnPrimary, { height: 26 }),
            disabled: busy,
            onClick: run,
          }, busy ? '处理中…' : '用录音重新整理')),
        msg ? h('div', { style: { fontSize: 11, color: T.muted } }, msg) : null,
        (result && result.md)
          ? h('pre', {
            style: {
              margin: 0, padding: 8, background: T.bg2, border: '1px solid ' + T.border, borderRadius: 6,
              fontSize: 11, lineHeight: '16px', whiteSpace: 'pre-wrap', maxHeight: 200, overflow: 'auto',
            },
          }, result.md)
          : null)
    }

    // ── 状态横条    // ── 状态横条：百炼连没连上、音频有没有送进去、最后一句多久前 ──
    // 用户的核心抱怨是"一点提示都没有"，所以这三个数字必须常驻可见。
    function StatusStrip(props) {
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
      var busy = s.running || (s.demo && s.demo.running)
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
      var h = React.createElement
      var s = useLive()
      var last = (s.transcript || [])[s.transcript.length - 1]
      var text = s.partial || (last && last.text) || ''
      if (!s.enabled && !s.demo) return null
      var dot = s.demo ? T.warn : (s.running ? T.ok : T.idle)
      return h('div', {
        style: {
          display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px',
          margin: '0 0 6px', background: T.bg2, border: '1px solid ' + T.border,
          borderRadius: 8, fontSize: 12, color: T.text, cursor: 'pointer',
        },
        onClick: function () { store.set(true) },
        title: '打开会议助手',
      },
        h('span', { style: { width: 7, height: 7, borderRadius: 4, background: dot, flex: '0 0 auto' } }),
        h('span', { style: { color: T.muted, flex: '0 0 auto' } }, s.demo ? '演练' : (s.running ? '在听' : '待机')),
        h('span', {
          style: { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
        }, text || (s.enabled ? '等待会议里的声音…' : '会议助手已关闭')),
        h('span', { style: { color: T.muted, flex: '0 0 auto' } }, (s.lines || 0) + ' 句'),
      )
    }

    // ── 设置页：原生 settings.section ────────────────────────────────
    function SettingsSection() {
      var h = React.createElement
      var s = useLive()
      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 680 } },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 10 } },
          h('span', { style: { fontSize: 13 } }, '会议助手'),
          h('span', { style: Object.assign({}, S.tag, { color: s.enabled ? T.ok : T.muted }) },
            s.enabled ? '已启用' : '未启用'),
          h('span', { style: { flex: 1 } }),
          h('button', {
            style: s.enabled ? S.btn : S.btnPrimary,
            onClick: function () { callAuto(s.enabled ? 'stop' : 'start') },
          }, s.enabled ? '停止' : '启用')),

        h(SetupCard),

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
