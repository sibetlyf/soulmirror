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
    }

    var store = { open: false, listeners: [], set: function (v) { store.open = v; store.listeners.forEach(function (f) { f() }) } }

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
      auto: false, armed: false, enabled: false, state: 'idle', capturing: false,
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
            })
          })
          .catch(function () {})
      }, 2000)
      if (liveTimer.unref) liveTimer.unref()
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
      var st = React.useState(null), cfg = st[0], setCfg = st[1]
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
        fetch('/api/soulmirror/config')
          .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json() })
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

      function save() {
        var body = {
          policy: cfg.policy, devices: cfg.devices, apps: cfg.apps,
          activeApp: cfg.activeApp, userName: cfg.userName, wakeWords: cfg.wakeWords, autoWatch: cfg.autoWatch,
          asr: cfg.asr, tts: cfg.tts, brain: cfg.brain,
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
        React.createElement(Row, { label: 'Key' }, React.createElement(Field, { secret: true, value: cfg.brain.apiKey, placeholder: '留空用环境变量', onChange: function (v) { set('brain.apiKey', v) } }), React.createElement(SourceTag, { source: cfg.brain.keySource })),
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
        setJoinMsg('识别中…')
        fetch('/api/soulmirror/meeting', {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ detect: true }),
        })
          .then(function (r) { return r.json() })
          .then(function (j) {
            if (j && j.code) { setCodeInput(j.code); setJoinMsg('自动识别：' + j.code + '（' + (j.app || '') + '）') }
            else setJoinMsg('未识别到会议号；可复制会议号/链接到剪贴板后重试')
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
        showCfg ? React.createElement(ConfigTab) : React.createElement(React.Fragment, null,
          (!lv.models) ? React.createElement('div', { style: { padding: '8px 12px', borderBottom: '1px solid ' + T.border, color: T.warn, fontSize: 11 } }, '宿主未提供实时数据（旧版本），重启 DSH 后生效') : null,
          React.createElement('div', { style: S.meta },
            React.createElement('div', { style: S.metaRow },
              React.createElement('span', { style: S.metaLabel }, '接入'),
              React.createElement('span', { style: S.metaValue }, (lv.meeting && lv.meeting.app) || '—'),
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
            React.createElement('div', { style: S.metaRow },
              React.createElement('span', { style: S.metaLabel }, '设备'),
              React.createElement('span', { style: S.metaValue }, (lv.devices && lv.devices.capture) || '—'))
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
          React.createElement('div', { style: S.list },
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
            lv.partial ? React.createElement('div', { style: S.interim }, lv.partial + ' …') : null
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
          )
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

    function MeetingPage() {
      var h = React.createElement
      var lv = useLive()
      var cfgState = React.useState(false), showCfg = cfgState[0], setShowCfg = cfgState[1]
      var codeState = React.useState(''), code = codeState[0], setCode = codeState[1]
      var msgState = React.useState(''), pageMsg = msgState[0], setPageMsg = msgState[1]
      var modelsState = React.useState(null), models = modelsState[0], setModels = modelsState[1]
      var audioState = React.useState(''), audio = audioState[0], setAudio = audioState[1]
      var recState = React.useState(false), recording = recState[0], setRecording = recState[1]
      var recRef = React.useRef(null)
      var chunkRef = React.useRef([])
      var cfgRef = React.useState(null), cfg = cfgRef[0], setCfg = cfgRef[1]

      React.useEffect(function () {
        fetch('/api/soulmirror/config').then(function (r) { return r.json() }).then(setCfg).catch(function () {})
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

      if (showCfg) {
        return h('div', { style: { height: '100%', overflowY: 'auto', background: T.bg, color: T.text, padding: '20px clamp(16px,3vw,36px) 40px' } },
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 } },
            h('h2', { style: { margin: 0, fontSize: 20, fontWeight: 500 } }, '会议助手 · 配置'),
            h('span', { style: { flex: 1 } }),
            h('button', { style: S.btn, onClick: function () { setShowCfg(false) } }, '返回概览')),
          h(ConfigTab))
      }

      var inMeeting = !!(lv.meeting && lv.meeting.inMeeting)
      var tasks = lv.tasks || []
      var lines = lv.transcript || []
      var tts = (models && models.tts) || {}
      var voices = tts.voices || []

      return h('div', { style: { height: '100%', overflowY: 'auto', background: T.bg, color: T.text, padding: '20px clamp(16px,3vw,36px) 44px', boxSizing: 'border-box' } },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 16 } },
          h('h1', { style: { margin: 0, fontSize: 20, fontWeight: 500 } }, '会议助手'),
          h('span', { style: Object.assign({}, S.tag, { color: lv.enabled ? T.ok : T.muted }) }, lv.enabled ? (inMeeting ? '会议中' : '已启用') : '未启用'),
          h('span', { style: S.note }, lv.meeting ? ((lv.meeting.app || '') + ' · ' + (lv.meeting.title || '')) : '未检测到会议'),
          h('span', { style: { flex: 1 } }),
          h('button', { style: lv.enabled ? S.btn : S.btnPrimary, onClick: function () { callAuto(lv.enabled ? 'stop' : 'start') } }, lv.enabled ? '停止会议助手' : '启用会议助手'),
          h('button', { style: S.btn, onClick: function () { setShowCfg(true) } }, '配置')),

        h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 10, marginBottom: 12 } },
          h(Stat, { label: '接入软件', value: (lv.meeting && lv.meeting.app) || '—' }),
          h(Stat, { label: '会议号', value: (lv.meeting && lv.meeting.code) || '未识别' }),
          h(Stat, { label: '转写', value: lines.length + ' 句' }),
          h(Stat, { label: '任务', value: tasks.length + ' 个' }),
          h(Stat, { label: 'TTS 音色', value: (cfg && cfg.tts && (cfg.tts.cloneVoiceId || cfg.tts.voice)) || '—' })),

        h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(320px,1fr))', gap: 12, alignItems: 'start' } },
          h(Card, { title: '会议接入' },
            h('div', { style: { display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 } },
              h('input', { style: Object.assign({}, S.field, { height: 30 }), value: code, placeholder: '会议号，自动识别或手动输入', onChange: function (e) { setCode(e.target.value) } }),
              h('span', { style: S.tag }, (lv.meeting && lv.meeting.codeSource) === 'manual' ? '手动' : ((lv.meeting && lv.meeting.codeSource) === 'auto' ? '自动' : '未识别')),
              h('button', { style: inMeeting ? S.btn : S.btnPrimary, disabled: inMeeting, onClick: joinNow }, inMeeting ? '已在会中' : '入会')),
            h('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap' } },
              h('button', { style: S.btn, onClick: function () { fetch('/api/soulmirror/meeting', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ detect: true }) }).then(function (r) { return r.json() }).then(function (j) { if (j.code) setCode(j.code); setPageMsg(j.code ? '识别到 ' + j.code : '未识别到会议号') }) } }, '识别会议号'),
              h('button', { style: S.btn, onClick: detectAll }, '探测模型/音色')),
            pageMsg ? h('div', { style: Object.assign({}, S.note, { marginTop: 8, lineHeight: '17px' }) }, pageMsg) : null),

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
              }))),

        h('div', { style: { marginTop: 12 } },
          h(Card, { title: '实时转写', extra: h('span', { style: S.note }, lines.length + ' 句') },
            lines.length === 0 ? h('div', { style: S.note }, lv.enabled ? '等待会议里的声音…' : '启用会议助手后开始采集')
              : h('div', { style: { maxHeight: 320, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 } },
                lines.slice(-30).map(function (l, i) {
                  var bot = l.role === 'assistant'
                  return h('div', { key: i, style: { display: 'flex', gap: 8, padding: '3px 0', borderBottom: '1px solid ' + T.border, fontSize: 12 } },
                    h('span', { style: { color: T.muted, width: 50, flex: '0 0 auto' } }, (l.t || '').slice(11, 19)),
                    h('span', { style: { color: bot ? T.ok : T.brand, maxWidth: 90, flex: '0 0 auto', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, bot ? 'SoulMirror' : (l.speaker || '—')),
                    h('span', { style: { flex: 1 } }, l.text))
                }))))
      )
    }

    function Entry() {
      var s = useStore()
      var lv = useLive()
      return React.createElement('button', {
        onClick: function () { store.set(!s.open) },
        title: lv.auto ? '会议监听中' : 'SoulMirror',
        style: {
          display: 'flex', alignItems: 'center', gap: 5, padding: '5px 9px',
          border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 12,
          background: s.open ? T.bg2 : 'transparent',
          color: s.open ? T.text : 'inherit',
        },
      },
        React.createElement('span', { style: { fontSize: 13 } }, '🎙'),
        React.createElement('span', null, '会议'),
        React.createElement('span', { style: Object.assign({}, S.dot, { background: lv.auto ? T.ok : T.idle }) }))
    }

    function Overlay() {
      var s = useStore()
      if (!s.open) return null
      return React.createElement(Panel)
    }

    exports.apply = function (ctx) {
      var slots = ctx.slots
      if (!slots) return
      slots.inject('conversation.view', function () {
        return slots.register(
          { name: 'conversation.view', id: 'soulmirror', order: 25, label: '会议' },
          function () { return React.createElement(MeetingPage) },
        )
      })
    }

    return module.exports
  },
})
