/**
 * Browser half of dsh-approval-alert.
 *
 * The Plugins page renders this component in its `plugins.row.config` slot for
 * the `dsh-approval-alert#approval-alert` row. The page supplies the settings
 * form snapshot and its mutate function, so saving writes the profile patch
 * through DSH's own config editor; the Host plugin reads the volatile config
 * references and applies changes immediately.
 */

window.__ModuleLoader__.load({
  id: 'dsh-approval-alert',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const DEFAULTS = {
      enabled: true,
      sound: 'Glass',
      volume: 1,
      burst: 2,
      alertOnApproval: true,
      alertOnQuestions: true,
      watchSystemPrompts: true,
      systemPromptTimeoutMs: 600000,
      notify: true,
      locale: 'zh',
      traceFile: '',
    }

    const SOUNDS = [
      'Basso', 'Blow', 'Bottle', 'Frog', 'Funk', 'Glass', 'Hero',
      'Morse', 'Ping', 'Pop', 'Purr', 'Sosumi', 'Submarine', 'Tink',
    ]

    const card = {
      display: 'flex',
      flexDirection: 'column',
      gap: 18,
      maxWidth: 760,
      color: 'var(--dsw-alias-label-primary, #1f2328)',
      fontSize: 13,
      lineHeight: 1.55,
    }
    const section = {
      display: 'flex',
      flexDirection: 'column',
      gap: 12,
      padding: 16,
      border: '0.5px solid var(--dsw-alias-border-l2, rgba(127,127,127,.25))',
      borderRadius: 12,
      background: 'var(--dsw-alias-bg-layer-2, rgba(127,127,127,.06))',
    }
    const sectionTitle = {
      margin: 0,
      fontSize: 14,
      fontWeight: 600,
      color: 'var(--dsw-alias-label-primary, #1f2328)',
    }
    const field = { display: 'flex', flexDirection: 'column', gap: 5 }
    const label = { fontWeight: 500, color: 'var(--dsw-alias-label-primary, #1f2328)' }
    const hint = { fontSize: 12, color: 'var(--dsw-alias-label-tertiary, #6b7280)' }
    const input = {
      boxSizing: 'border-box',
      width: '100%',
      height: 34,
      padding: '0 10px',
      border: '0.5px solid var(--dsw-alias-border-l4, rgba(127,127,127,.35))',
      borderRadius: 8,
      background: 'var(--dsw-alias-bg-layer-1, transparent)',
      color: 'var(--dsw-alias-label-primary, #1f2328)',
      font: 'inherit',
      outline: 'none',
    }
    const checkRow = {
      display: 'flex',
      alignItems: 'flex-start',
      gap: 10,
      padding: '2px 0',
      cursor: 'pointer',
    }
    const check = {
      width: 16,
      height: 16,
      marginTop: 2,
      accentColor: 'var(--dsw-alias-brand-primary, #4d6bfe)',
      flex: 'none',
    }
    const footer = {
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      flexWrap: 'wrap',
    }
    const button = {
      boxSizing: 'border-box',
      height: 34,
      padding: '0 16px',
      borderRadius: 8,
      border: '0.5px solid var(--dsw-alias-border-l2, rgba(127,127,127,.25))',
      background: 'transparent',
      color: 'var(--dsw-alias-label-primary, #1f2328)',
      font: 'inherit',
      cursor: 'pointer',
    }
    const primaryButton = {
      ...button,
      border: 'none',
      background: 'var(--dsw-alias-button-primary-fill, #4d6bfe)',
      color: 'var(--dsw-alias-label-primary-foreground, #fff)',
      fontWeight: 500,
    }
    const message = (kind) => ({
      fontSize: 12,
      color: kind === 'error'
        ? 'var(--dsw-alias-state-error-primary, #d33)'
        : 'var(--dsw-alias-state-success-primary, #198754)',
    })

    function clampNumber(value, min, max, fallback) {
      const parsed = Number(value)
      if (!Number.isFinite(parsed)) return fallback
      return Math.min(max, Math.max(min, parsed))
    }

    function Section({ title, children }) {
      return h('section', { style: section }, [
        title === undefined ? null : h('h4', { key: 'title', style: sectionTitle }, title),
        ...children,
      ])
    }

    function Field({ label: text, hint: note, children }) {
      return h('label', { style: field }, [
        h('span', { key: 'label', style: label }, text),
        children,
        note === undefined ? null : h('span', { key: 'hint', style: hint }, note),
      ])
    }

    function Check({ checked, onChange, disabled, title, note }) {
      return h('label', { style: { ...checkRow, opacity: disabled ? 0.6 : 1 } }, [
        h('input', {
          key: 'box',
          type: 'checkbox',
          style: check,
          checked: checked === true,
          disabled: disabled === true,
          onChange: (event) => onChange(event.target.checked),
        }),
        h('span', { key: 'text', style: { display: 'flex', flexDirection: 'column', gap: 2 } }, [
          h('span', { key: 't', style: label }, title),
          note === undefined ? null : h('span', { key: 'n', style: hint }, note),
        ]),
      ])
    }

    function Notice({ children, error }) {
      return h('p', {
        style: {
          margin: 0,
          padding: '8px 10px',
          borderRadius: 8,
          background: error
            ? 'color-mix(in srgb, var(--dsw-alias-state-error-primary, #d33) 10%, transparent)'
            : 'var(--dsw-alias-bg-layer-3, rgba(127,127,127,.08))',
          color: error
            ? 'var(--dsw-alias-state-error-primary, #d33)'
            : 'var(--dsw-alias-label-secondary, #4b5563)',
          fontSize: 12,
        },
      }, children)
    }

    function ConfigForm({ form }) {
      const state = form && form.state
      const [draft, setDraft] = React.useState(() => ({ ...DEFAULTS, ...(state && state.value ? state.value : {}) }))
      const [saving, setSaving] = React.useState(false)
      const [feedback, setFeedback] = React.useState(null)

      const revision = state && state.revision
      const status = state && state.status

      React.useEffect(() => {
        setDraft({ ...DEFAULTS, ...(state && state.value ? state.value : {}) })
      }, [revision, status])

      if (!form || !state) {
        return h(Notice, null, '配置尚未就绪：请确认插件已启用，然后刷新插件页面。')
      }
      if (status === 'loading') {
        return h(Notice, null, '正在读取配置…')
      }
      if (status === 'unavailable') {
        return h(Notice, { error: true }, '配置暂不可用：Host 还没有为 approval-alert 提供设置表单。请确认插件已启用并重新打开插件页。')
      }

      const disabled = state.writable !== true || saving
      const set = (key, value) => {
        setFeedback(null)
        setDraft((previous) => ({ ...previous, [key]: value }))
      }

      const normalize = (value) => ({
        ...value,
        sound: typeof value.sound === 'string' && value.sound.trim() !== '' ? value.sound.trim() : DEFAULTS.sound,
        volume: clampNumber(value.volume, 0.1, 4, DEFAULTS.volume),
        burst: clampNumber(value.burst, 1, 4, DEFAULTS.burst),
        systemPromptTimeoutMs: clampNumber(value.systemPromptTimeoutMs, 0, 3600000, DEFAULTS.systemPromptTimeoutMs),
        locale: value.locale === 'en' ? 'en' : 'zh',
        traceFile: typeof value.traceFile === 'string' ? value.traceFile.trim() : '',
      })

      const save = async () => {
        const normalized = normalize(draft)
        setDraft(normalized)
        setSaving(true)
        setFeedback(null)
        const ops = Object.entries(normalized).map(([key, value]) => ({
          op: 'set',
          path: [key],
          value,
        }))
        let ok = false
        try {
          ok = await form.mutate(ops, revision)
        } catch (error) {
          ok = false
        }
        setSaving(false)
        setFeedback(ok
          ? { kind: 'ok', text: '已保存，配置立即生效。' }
          : { kind: 'error', text: '保存失败：本部署没有接受这些值，请重试或查看 DSH 日志。' })
      }

      const reset = () => {
        setDraft({ ...DEFAULTS })
        setFeedback({ kind: 'ok', text: '已填入默认值，点击“保存”后生效。' })
      }

      return h('div', { style: card }, [
        h(Notice, { key: 'intro' }, '提醒节奏固定为：第一次立即响，之后 25 / 20 / 15 / 10 秒，第六次起每 5 秒一次，直到你处理完。'),
        h(Section, { key: 'sound', title: '声音与提醒方式' }, [
          h(Check, {
            key: 'enabled',
            checked: draft.enabled !== false,
            disabled,
            title: '启用授权提醒',
            note: '总开关；关闭后 DSH 审批、提问和 macOS 权限弹窗都不会响。',
            onChange: (value) => set('enabled', value),
          }),
          h(Field, { key: 'soundField', label: '提示音', hint: '可填 macOS 系统音效名，或绝对路径（.aiff/.wav/...）。' }, [
            h('input', {
              key: 'input',
              style: input,
              list: 'dsh-approval-alert-sounds',
              value: draft.sound === undefined ? DEFAULTS.sound : draft.sound,
              disabled,
              onChange: (event) => set('sound', event.target.value),
            }),
            h('datalist', { key: 'list', id: 'dsh-approval-alert-sounds' },
              SOUNDS.map((name) => h('option', { key: name, value: name }))),
          ]),
          h('div', { key: 'numbers', style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 } }, [
            h(Field, { key: 'volume', label: '音量倍率', hint: '1 = 跟随当前系统输出音量；0.1–4。' }, [
              h('input', {
                key: 'input',
                style: input,
                type: 'number',
                min: 0.1,
                max: 4,
                step: 0.1,
                value: draft.volume === undefined ? DEFAULTS.volume : draft.volume,
                disabled,
                onChange: (event) => set('volume', event.target.value),
              }),
            ]),
            h(Field, { key: 'burst', label: '每次响几声', hint: '默认 2（双响）；1–4。' }, [
              h('input', {
                key: 'input',
                style: input,
                type: 'number',
                min: 1,
                max: 4,
                step: 1,
                value: draft.burst === undefined ? DEFAULTS.burst : draft.burst,
                disabled,
                onChange: (event) => set('burst', event.target.value),
              }),
            ]),
          ]),
          h(Check, {
            key: 'notify',
            checked: draft.notify !== false,
            disabled,
            title: '同时弹一条系统通知',
            note: '首次提醒时弹通知；当前 Host 上来源可能显示为“脚本编辑器”。',
            onChange: (value) => set('notify', value),
          }),
        ]),
        h(Section, { key: 'sources', title: '触发来源' }, [
          h(Check, {
            key: 'approval',
            checked: draft.alertOnApproval !== false,
            disabled,
            title: 'DSH 工具审批',
            note: '沙箱升级、危险命令、写工作区外文件等需要点“允许/拒绝”的操作。',
            onChange: (value) => set('alertOnApproval', value),
          }),
          h(Check, {
            key: 'questions',
            checked: draft.alertOnQuestions !== false,
            disabled,
            title: 'Agent 提问 / 计划审阅',
            note: 'ask_user_question、exit_plan_mode 等需要你回答的操作。',
            onChange: (value) => set('alertOnQuestions', value),
          }),
          h(Check, {
            key: 'system',
            checked: draft.watchSystemPrompts !== false,
            disabled,
            title: 'macOS 系统权限弹窗',
            note: '麦克风、摄像头、屏幕录制、辅助功能、自动化、文件与文件夹等 DSH 触发的 TCC 弹窗。',
            onChange: (value) => set('watchSystemPrompts', value),
          }),
          h(Field, {
            key: 'timeout',
            label: '系统弹窗安全上限（毫秒）',
            hint: '默认 600000（10 分钟）；0 表示不自动停止。',
          }, [
            h('input', {
              key: 'input',
              style: input,
              type: 'number',
              min: 0,
              max: 3600000,
              step: 60000,
              value: draft.systemPromptTimeoutMs === undefined ? DEFAULTS.systemPromptTimeoutMs : draft.systemPromptTimeoutMs,
              disabled,
              onChange: (event) => set('systemPromptTimeoutMs', event.target.value),
            }),
          ]),
        ]),
        h(Section, { key: 'advanced', title: '高级' }, [
          h(Field, { key: 'locale', label: '通知语言' }, [
            h('select', {
              key: 'select',
              style: input,
              value: draft.locale === 'en' ? 'en' : 'zh',
              disabled,
              onChange: (event) => set('locale', event.target.value),
            }, [
              h('option', { key: 'zh', value: 'zh' }, '中文'),
              h('option', { key: 'en', value: 'en' }, 'English'),
            ]),
          ]),
          h(Field, {
            key: 'trace',
            label: '诊断日志文件（可选）',
            hint: '例如 /tmp/dsh-approval-alert.log；留空关闭。',
          }, [
            h('input', {
              key: 'input',
              style: input,
              type: 'text',
              placeholder: '/tmp/dsh-approval-alert.log',
              value: draft.traceFile === undefined ? '' : draft.traceFile,
              disabled,
              onChange: (event) => set('traceFile', event.target.value),
            }),
          ]),
        ]),
        state.writable === true ? null : h(Notice, { key: 'readonly', error: true }, '当前部署的插件配置是只读的。'),
        h('div', { key: 'footer', style: footer }, [
          h('button', {
            key: 'save',
            type: 'button',
            style: { ...primaryButton, opacity: disabled ? 0.6 : 1, cursor: disabled ? 'default' : 'pointer' },
            disabled,
            onClick: save,
          }, saving ? '保存中…' : '保存'),
          h('button', {
            key: 'reset',
            type: 'button',
            style: { ...button, opacity: disabled ? 0.6 : 1, cursor: disabled ? 'default' : 'pointer' },
            disabled,
            onClick: reset,
          }, '恢复默认值'),
          feedback === null
            ? null
            : h('span', { key: 'feedback', style: message(feedback.kind) }, feedback.text),
        ]),
      ])
    }

    function Summary() {
      return '配置提示音、音量、重复节奏，以及 DSH 审批 / 提问 / macOS 权限弹窗的提醒开关。'
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('plugins.row.config', () => ctx.slots.register({
          name: 'plugins.row.config',
          key: 'dsh-approval-alert#approval-alert',
        }, (props) => {
          if (props && props.view === 'summary') return Summary()
          return h(ConfigForm, { form: props && props.form })
        }))
      },
    }
  },
})
