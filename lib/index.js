/**
 * dsh-approval-alert — chime whenever DeepSeek Harness needs a human decision.
 *
 * The Host emits `approval/request` (a tool wants permission) and
 * `user-questions/request` (the agent asks a question, including plan review)
 * as Cordis waterfalls. A prepended listener observes each request, plays a
 * macOS system sound through `afplay` at the current output volume, optionally
 * shows a notification, repeats the reminder while the request is pending, and
 * then delegates to the real answerer with
 * `next()` so the approval/answer flow is never altered.
 *
 * The same alert engine also watches the macOS unified log through
 * `log stream`, so two kinds of system dialog trigger the identical cadence
 * without needing Accessibility permission:
 *
 *   - TCC prompts (`AUTHREQ_PROMPTING`), such as the microphone dialog.
 *   - Privilege sheets (`com.apple.Authorization` / `SecurityAgent`), the
 *     "macOS 想要进行更改" password box an admin right raises — `sudo` from a
 *     GUI session, `sfltool`, an installer helper. Those never reach the TCC
 *     subsystem, so they need their own subscription.
 */

import { randomUUID } from 'node:crypto'
import { appendFileSync } from 'node:fs'
import { createAlerter, DEFAULTS } from './core.js'
import { createPrivilegeWatcher, createTccWatcher } from './tcc.js'

let z = null
try {
  z = (await import('@deepseek-ai/schemastery')).default
} catch {
  // The schema is optional: without it the plugin still runs with DEFAULTS and
  // the config stays editable only through the profile patch.
}

export const name = 'approval-alert'

export const Config = z?.object({
  enabled: z.boolean().default(DEFAULTS.enabled).volatile(),
  sound: z.string().default(DEFAULTS.sound).volatile(),
  volume: z.number().default(DEFAULTS.volume).volatile(),
  burst: z.number().default(DEFAULTS.burst).volatile(),
  alertOnApproval: z.boolean().default(DEFAULTS.alertOnApproval).volatile(),
  alertOnQuestions: z.boolean().default(DEFAULTS.alertOnQuestions).volatile(),
  watchSystemPrompts: z.boolean().default(DEFAULTS.watchSystemPrompts).volatile(),
  systemPromptTimeoutMs: z.number().default(DEFAULTS.systemPromptTimeoutMs).volatile(),
  watchPrivilegePrompts: z.boolean().default(DEFAULTS.watchPrivilegePrompts).volatile(),
  privilegePromptTimeoutMs: z.number().default(DEFAULTS.privilegePromptTimeoutMs).volatile(),
  notify: z.boolean().default(DEFAULTS.notify).volatile(),
  startupChime: z.boolean().default(DEFAULTS.startupChime).volatile(),
  locale: z.string().default(DEFAULTS.locale).volatile(),
  traceFile: z.string().default(DEFAULTS.traceFile).volatile(),
})

function shortText(value, limit = 160) {
  if (typeof value !== 'string') return ''
  const text = value.replace(/\s+/g, ' ').trim()
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text
}

function localizedReason(request, locale) {
  const display = request?.displayReason
  if (typeof display === 'string') return display
  if (display && typeof display === 'object') {
    const preferred = display[locale]
    if (typeof preferred === 'string' && preferred !== '') return preferred
    const fallback = display.zh ?? display.en
    if (typeof fallback === 'string') return fallback
  }
  return typeof request?.reason === 'string' ? request.reason : ''
}

function approvalNotification(request, options) {
  const zh = options.locale !== 'en'
  const tool = typeof request?.toolName === 'string' && request.toolName !== '' ? request.toolName : zh ? '某个工具' : 'A tool'
  const reason = shortText(localizedReason(request, zh ? 'zh' : 'en'), 180)
  return {
    title: zh ? 'DeepSeek Harness 需要你的授权' : 'DeepSeek Harness needs your approval',
    body: zh
      ? `${tool} 请求权限${reason === '' ? '，请回到窗口允许或拒绝' : `：${reason}`}`
      : `${tool} is requesting permission${reason === '' ? '. Return to the window to allow or reject.' : `: ${reason}`}`,
  }
}

function questionNotification(request, options) {
  const zh = options.locale !== 'en'
  const questions = Array.isArray(request?.questions) ? request.questions : []
  const first = questions[0] ?? {}
  const plan = first?.intent?.kind === 'plan-review'
  const text = shortText(first?.question, 180)
  const more = questions.length > 1 ? (zh ? `（共 ${questions.length} 个问题）` : ` (${questions.length} questions)`) : ''
  const body = `${text}${more}`.trim()
  return {
    title: zh
      ? plan
        ? 'DeepSeek Harness 等待你审阅计划'
        : 'DeepSeek Harness 等待你的回答'
      : plan
        ? 'DeepSeek Harness is waiting for plan review'
        : 'DeepSeek Harness is waiting for your answer',
    body: body === '' ? (zh ? '请回到窗口继续。' : 'Return to the window to continue.') : body,
  }
}

const TCC_SERVICE_LABELS = {
  kTCCServiceMicrophone: ['麦克风', 'Microphone'],
  kTCCServiceCamera: ['摄像头', 'Camera'],
  kTCCServiceScreenCapture: ['屏幕录制', 'Screen Recording'],
  kTCCServiceAccessibility: ['辅助功能', 'Accessibility'],
  kTCCServiceListenEvent: ['输入监控', 'Input Monitoring'],
  kTCCServicePostEvent: ['辅助功能（模拟输入）', 'Accessibility (event posting)'],
  kTCCServiceAppleEvents: ['自动化 / 控制其他 App', 'Automation'],
  kTCCServiceSystemPolicyDesktopFolder: ['桌面文件夹', 'Desktop folder'],
  kTCCServiceSystemPolicyDocumentsFolder: ['文稿文件夹', 'Documents folder'],
  kTCCServiceSystemPolicyDownloadsFolder: ['下载文件夹', 'Downloads folder'],
  kTCCServiceSystemPolicyRemovableVolumes: ['可移除宗卷', 'Removable volumes'],
  kTCCServiceSystemPolicyNetworkVolumes: ['网络宗卷', 'Network volumes'],
  kTCCServiceSystemPolicyAllFiles: ['完全磁盘访问权限', 'Full Disk Access'],
  kTCCServiceSystemPolicyAppData: ['其他 App 的数据', 'App data'],
  kTCCServiceBluetoothAlways: ['蓝牙', 'Bluetooth'],
  kTCCServiceUserTracking: ['跨 App 跟踪', 'Tracking'],
  kTCCServicePhotos: ['照片', 'Photos'],
  kTCCServiceContacts: ['通讯录', 'Contacts'],
  kTCCServiceCalendar: ['日历', 'Calendar'],
  kTCCServiceReminders: ['提醒事项', 'Reminders'],
}

function tccServiceLabel(service, locale) {
  const entry = TCC_SERVICE_LABELS[service]
  if (entry !== undefined) return entry[locale === 'en' ? 1 : 0]
  return service.replace(/^kTCCService/, '')
}

function systemPromptNotification(service, options) {
  const zh = options.locale !== 'en'
  const label = tccServiceLabel(service, zh ? 'zh' : 'en')
  return {
    title: zh ? 'DeepSeek Harness 需要 macOS 权限' : 'DeepSeek Harness needs macOS permission',
    body: zh
      ? `系统正在请求「${label}」权限，请点击允许或拒绝。`
      : `macOS is requesting ${label} access. Allow or deny the system dialog.`,
  }
}

function privilegeNotification(options) {
  const zh = options.locale !== 'en'
  return {
    title: zh ? 'macOS 正在等待管理员密码' : 'macOS is waiting for an administrator password',
    body: zh
      ? '有一个进程请求管理员权限，请在系统弹窗里输入密码或点击取消。'
      : 'A process is requesting administrator privileges. Type your password or cancel the system sheet.',
  }
}

export function apply(ctx, config) {
  const rawConfig = config ?? {}
  const readOption = (key) => {
    const value = rawConfig[key]
    if (value && typeof value === 'object' && typeof value.get === 'function') return value.get()
    return value === undefined ? DEFAULTS[key] : value
  }
  const options = new Proxy({}, { get: (_target, key) => readOption(key) })
  const trace = (line) => {
    const file = typeof readOption('traceFile') === 'string' ? readOption('traceFile').trim() : ''
    if (file === '') return
    try {
      appendFileSync(file, `${new Date().toISOString()} ${line}\n`)
    } catch {}
  }

  const logger = ctx?.logger
  const alerter = createAlerter(options, { trace })
  const safeEnd = (key) => {
    try {
      alerter.end(key)
    } catch (error) {
      trace(`end-error ${String(error)}`)
    }
  }

  // Every system-dialog source shares one registry: one key per dialog, one
  // safety timer, one alert engine. A TCC prompt and a privilege sheet are
  // sometimes logged for the same user-facing dialog, so a source that begins
  // within the dedupe window of another source stays silent while still being
  // tracked — its resolve line must never leak an alert.
  const systemPrompts = new Map()
  const tccMsgToKey = new Map()
  const SYSTEM_DIALOG_DEDUPE_MS = 2000
  let lastSystemSource = { source: '', at: 0 }
  let tccWatcher = null
  let privilegeWatcher = null

  const endSystemPrompt = (key) => {
    const entry = systemPrompts.get(key)
    if (entry === undefined) return
    if (entry.timer !== null) {
      clearTimeout(entry.timer)
      entry.timer = null
    }
    systemPrompts.delete(key)
    if (entry.source === 'tcc') for (const msgId of entry.msgIds) tccMsgToKey.delete(msgId)
    safeEnd(key)
  }

  const beginSystemPrompt = (key, entry, notification, timeoutMs) => {
    if (systemPrompts.has(key)) return false
    const record = { ...entry, timer: null }
    systemPrompts.set(key, record)
    const timeout = Number(timeoutMs)
    if (Number.isFinite(timeout) && timeout > 0) {
      record.timer = setTimeout(() => {
        trace(`system prompt timeout key=${key}`)
        endSystemPrompt(key)
      }, timeout)
      record.timer?.unref?.()
    }
    const now = Date.now()
    const shadowed = lastSystemSource.source !== ''
      && lastSystemSource.source !== record.source
      && now - lastSystemSource.at <= SYSTEM_DIALOG_DEDUPE_MS
    if (shadowed) {
      trace(`system prompt shadowed source=${record.source} key=${key}`)
      return false
    }
    lastSystemSource = { source: record.source, at: now }
    try {
      alerter.begin(key, { kind: record.kind ?? 'system', notification })
    } catch (error) {
      trace(`system prompt begin-error ${String(error)}`)
    }
    return true
  }

  const onTccPrompt = ({ msgId, service }) => {
    if (readOption('enabled') === false || readOption('watchSystemPrompts') === false) return
    const now = Date.now()
    for (const [candidateKey, entry] of systemPrompts) {
      if (entry.source === 'tcc' && entry.service === service && now - entry.startedAt <= SYSTEM_DIALOG_DEDUPE_MS) {
        entry.msgIds.add(msgId)
        tccMsgToKey.set(msgId, candidateKey)
        trace(`tcc prompt duplicate service=${service} msgId=${msgId} key=${candidateKey}`)
        return
      }
    }

    const key = `tcc:${msgId}`
    tccMsgToKey.set(msgId, key)
    trace(`tcc prompt service=${service} msgId=${msgId} key=${key}`)
    beginSystemPrompt(
      key,
      { source: 'tcc', kind: 'system', service, msgIds: new Set([msgId]), startedAt: now },
      systemPromptNotification(service, options),
      options.systemPromptTimeoutMs,
    )
  }

  const onTccResolve = ({ msgId }) => {
    const key = tccMsgToKey.get(msgId)
    if (key === undefined) return
    trace(`tcc result msgId=${msgId} key=${key}`)
    endSystemPrompt(key)
  }

  let privilegeSeq = 0

  const onPrivilegePrompt = ({ dialog }) => {
    if (readOption('enabled') === false || readOption('watchPrivilegePrompts') === false) return
    const now = Date.now()
    for (const [key, entry] of systemPrompts) {
      if (entry.source === 'privilege' && now - entry.startedAt <= SYSTEM_DIALOG_DEDUPE_MS) {
        trace(`privilege prompt duplicate key=${key}`)
        return
      }
    }
    privilegeSeq += 1
    const key = `privilege:${privilegeSeq}`
    trace(`privilege prompt dialog=${dialog} key=${key}`)
    beginSystemPrompt(
      key,
      { source: 'privilege', kind: 'privilege', startedAt: now },
      privilegeNotification(options),
      options.privilegePromptTimeoutMs,
    )
  }

  const onPrivilegeResolve = ({ reason }) => {
    for (const [key, entry] of [...systemPrompts]) {
      if (entry.source !== 'privilege') continue
      trace(`privilege resolve reason=${reason} key=${key}`)
      endSystemPrompt(key)
    }
  }

  const handle = (kind, request, next) => {
    if (typeof next !== 'function') return undefined
    const keyId = kind === 'approval'
      ? request?.callId ?? request?.id ?? randomUUID()
      : request?.callId ?? request?.questions?.[0]?.id ?? randomUUID()
    const key = `${kind}:${keyId}`
    const notification = kind === 'approval'
      ? approvalNotification(request, options)
      : questionNotification(request, options)

    try {
      alerter.begin(key, { kind, notification })
    } catch (error) {
      trace(`begin-error ${String(error)}`)
    }

    const signal = request?.signal
    if (signal && typeof signal.addEventListener === 'function') {
      try {
        signal.addEventListener('abort', () => safeEnd(key), { once: true })
      } catch {}
    }

    let result
    try {
      result = next()
    } catch (error) {
      safeEnd(key)
      throw error
    }
    return Promise.resolve(result).finally(() => safeEnd(key))
  }

  // Always register the listeners; the alert engine reads the live config and
  // gates each request, so a form toggle applies without remounting the plugin.
  ctx.on('approval/request', (request, next) => handle('approval', request, next), { prepend: true })
  ctx.on('user-questions/request', (request, next) => handle('question', request, next), { prepend: true })

  // Both streams are cheap (a few lines per minute) and start once per mount so
  // a later toggle takes effect immediately; the handlers still gate on the
  // live config. DSH_APPROVAL_ALERT_LOG_PATH swaps `log` out for tests.
  const logOverride = process.env.DSH_APPROVAL_ALERT_LOG_PATH
  const logPath = typeof logOverride === 'string' && logOverride !== '' ? logOverride : undefined
  if (process.platform === 'darwin') {
    if (process.env.DSH_APPROVAL_ALERT_NO_TCC_WATCH !== '1') {
      tccWatcher = createTccWatcher({ onPrompt: onTccPrompt, onResolve: onTccResolve, trace, logPath })
      tccWatcher.start()
    }
    if (process.env.DSH_APPROVAL_ALERT_NO_PRIVILEGE_WATCH !== '1') {
      privilegeWatcher = createPrivilegeWatcher({
        onPrompt: onPrivilegePrompt,
        onResolve: onPrivilegeResolve,
        trace,
        logPath,
      })
      privilegeWatcher.start()
    }
  }

  ctx.effect(() => () => {
    tccWatcher?.stop()
    privilegeWatcher?.stop()
    for (const key of [...systemPrompts.keys()]) endSystemPrompt(key)
    systemPrompts.clear()
    tccMsgToKey.clear()
    alerter.dispose()
    trace('plugin disposed')
  }, 'approval-alert: release players, timers, and the log watchers')

  logger?.info?.(
    'approval-alert ready: sound=%s volume=%s watchSystemPrompts=%s watchPrivilegePrompts=%s notify=%s',
    options.sound,
    options.volume,
    options.watchSystemPrompts,
    options.watchPrivilegePrompts,
    options.notify,
  )
  trace(`apply platform=${process.platform} pid=${process.pid} sound=${options.sound}`)

  if (readOption('startupChime') === true) {
    const zh = options.locale !== 'en'
    try {
      alerter.playBurst()
      alerter.showNotification({
        title: zh ? '审批提醒已启用' : 'Approval alerts enabled',
        body: zh
          ? 'DeepSeek Harness 需要授权或等待回答时，会播放系统声音提醒你。'
          : 'A system sound will play whenever DeepSeek Harness needs approval or an answer.',
      })
    } catch (error) {
      trace(`startup-chime-error ${String(error)}`)
    }
  }
}
