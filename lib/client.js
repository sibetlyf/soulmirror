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
      auto: false, state: 'idle', capturing: false,
      transcript: [], partial: '', meeting: null, models: null, devices: null, peak: 0, since: null, tasks: [],
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

    function callAuto(action) {
      fetch('/api/soulmirror/auto', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: action }),
      })
        .then(function (r) { return r.json() })
        .then(function (j) { live.set({ auto: j.auto, state: j.lifecycle && j.lifecycle.state, capturing: live.capturing }) })
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

    function ConfigTab() {
      var st = React.useState(null), cfg = st[0], setCfg = st[1]
      var sv = React.useState(''), msg = sv[0], setMsg = sv[1]
      var tk = React.useState(''), testing = tk[0], setTesting = tk[1]

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
        React.createElement(Row, { label: 'baseUrl' }, React.createElement(Field, { value: cfg.brain.baseUrl, placeholder: 'https://api.deepseek.com/v1', onChange: function (v) { set('brain.baseUrl', v) } })),
        React.createElement(Row, { label: 'model' }, React.createElement(Field, { value: cfg.brain.model, placeholder: 'deepseek-chat', onChange: function (v) { set('brain.model', v) } })),
        React.createElement(Row, { label: 'Key' }, React.createElement(Field, { secret: true, value: cfg.brain.apiKey, placeholder: '留空用环境变量', onChange: function (v) { set('brain.apiKey', v) } }), React.createElement(SourceTag, { source: cfg.brain.keySource })),

        React.createElement('div', { style: S.section }, '会议与设备'),
        React.createElement(Row, { label: '抓取软件' }, React.createElement(Field, { value: cfg.activeApp || '', placeholder: '空 = 全部', onChange: function (v) { set('activeApp', v) } })),
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
              React.createElement('span', { style: S.metaLabel }, '会议号'),
              React.createElement('input', {
                style: Object.assign({}, S.field, { height: 24 }),
                value: codeInput,
                placeholder: '自动识别或手动输入',
                onChange: function (e) { setCodeInput(e.target.value) },
              }),
              React.createElement('span', { style: S.tag }, (lv.meeting && lv.meeting.codeSource) === 'manual' ? '手动' : ((lv.meeting && lv.meeting.codeSource) === 'auto' ? '自动' : '未识别')),
              React.createElement('button', { style: Object.assign({}, S.btn, { height: 24 }), onClick: detectCode }, '识别'),
              React.createElement('button', { style: Object.assign({}, S.btnPrimary, { height: 24 }), onClick: joinByCode }, '确认入会')),
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
              style: lv.auto ? S.btn : S.btnPrimary,
              onClick: function () { callAuto(lv.auto ? 'stop' : 'start') },
            }, lv.auto ? '停止监听' : '开始监听'),
            React.createElement('span', { style: S.note }, lv.auto ? '后台运行，可直接在会中说话' : '未监听'),
            React.createElement('span', { style: { flex: 1 } }),
            React.createElement('span', { style: S.note }, 'Esc 关闭')
          )
        )
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
      slots.inject('sidebar.footer.action', function () {
        return slots.register(
          { name: 'sidebar.footer.action', id: 'soulmirror', order: 11, label: '会议' },
          function () { return React.createElement(Entry) },
        )
      })
      slots.inject('shell.overlay', function () {
        return slots.register(
          { name: 'shell.overlay', id: 'soulmirror', order: 11, label: 'SoulMirror' },
          function () { return React.createElement(Overlay) },
        )
      })
    }

    return module.exports
  },
})
