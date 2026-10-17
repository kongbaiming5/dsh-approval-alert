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
 * The same alert engine also watches macOS TCC prompts through `log stream`
 * (`AUTHREQ_PROMPTING`), so a system dialog such as the microphone prompt
 * triggers the identical cadence without needing Accessibility permission.
 */

import { randomUUID } from 'node:crypto'
import { appendFileSync } from 'node:fs'
import { createAlerter, DEFAULTS } from './core.js'
import { createTccWatcher } from './tcc.js'

let z = null
try {
  z = (await import('@deepseek-ai/schemastery')).default
} catch {
  // The schema is optional: without it the plugin still runs with DEFAULTS and
  // the config stays editable only through the profile patch.
}

export const name = 'approval-alert'

export const Config = z?.object({
  enabled: z.boolean().default(DEFAULTS.enabled),
  sound: z.string().default(DEFAULTS.sound),
  volume: z.number().default(DEFAULTS.volume),
  burst: z.number().default(DEFAULTS.burst),
  alertOnApproval: z.boolean().default(DEFAULTS.alertOnApproval),
  alertOnQuestions: z.boolean().default(DEFAULTS.alertOnQuestions),
  watchSystemPrompts: z.boolean().default(DEFAULTS.watchSystemPrompts),
  systemPromptTimeoutMs: z.number().default(DEFAULTS.systemPromptTimeoutMs),
  notify: z.boolean().default(DEFAULTS.notify),
  startupChime: z.boolean().default(DEFAULTS.startupChime),
  locale: z.union(['zh', 'en']).default(DEFAULTS.locale),
  traceFile: z.string().default(DEFAULTS.traceFile),
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

export function apply(ctx, config) {
  const options = { ...DEFAULTS, ...(config ?? {}) }
  const traceFile = typeof options.traceFile === 'string' ? options.traceFile.trim() : ''
  const trace = traceFile === ''
    ? () => {}
    : (line) => {
        try {
          appendFileSync(traceFile, `${new Date().toISOString()} ${line}\n`)
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

  const tccActive = new Map()
  const tccMsgToKey = new Map()
  const TCC_DEDUPE_MS = 2000
  let tccWatcher = null

  const endTccKey = (key) => {
    const entry = tccActive.get(key)
    if (entry === undefined) return
    tccActive.delete(key)
    for (const msgId of entry.msgIds) tccMsgToKey.delete(msgId)
    if (entry.timer !== null) {
      clearTimeout(entry.timer)
      entry.timer = null
    }
    safeEnd(key)
  }

  const onTccPrompt = ({ msgId, service }) => {
    const now = Date.now()
    for (const [candidateKey, entry] of tccActive) {
      if (entry.service === service && now - entry.startedAt <= TCC_DEDUPE_MS) {
        entry.msgIds.add(msgId)
        tccMsgToKey.set(msgId, candidateKey)
        trace(`tcc prompt duplicate service=${service} msgId=${msgId} key=${candidateKey}`)
        return
      }
    }

    const key = `tcc:${msgId}`
    const entry = { service, msgIds: new Set([msgId]), startedAt: now, timer: null }
    tccActive.set(key, entry)
    tccMsgToKey.set(msgId, key)
    const timeout = Number(options.systemPromptTimeoutMs)
    if (Number.isFinite(timeout) && timeout > 0) {
      entry.timer = setTimeout(() => {
        trace(`tcc timeout key=${key}`)
        endTccKey(key)
      }, timeout)
      entry.timer?.unref?.()
    }
    trace(`tcc prompt service=${service} msgId=${msgId} key=${key}`)
    try {
      alerter.begin(key, { kind: 'system', notification: systemPromptNotification(service, options) })
    } catch (error) {
      trace(`tcc begin-error ${String(error)}`)
    }
  }

  const onTccResolve = ({ msgId }) => {
    const key = tccMsgToKey.get(msgId)
    if (key === undefined) return
    trace(`tcc result msgId=${msgId} key=${key}`)
    endTccKey(key)
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

  if (options.enabled !== false && options.alertOnApproval !== false) {
    ctx.on('approval/request', (request, next) => handle('approval', request, next), { prepend: true })
  }
  if (options.enabled !== false && options.alertOnQuestions !== false) {
    ctx.on('user-questions/request', (request, next) => handle('question', request, next), { prepend: true })
  }

  if (options.enabled !== false && options.watchSystemPrompts !== false && process.platform === 'darwin') {
    tccWatcher = createTccWatcher({ onPrompt: onTccPrompt, onResolve: onTccResolve, trace })
    tccWatcher.start()
  }

  ctx.effect(() => () => {
    tccWatcher?.stop()
    for (const key of [...tccActive.keys()]) endTccKey(key)
    tccActive.clear()
    tccMsgToKey.clear()
    alerter.dispose()
    trace('plugin disposed')
  }, 'approval-alert: release players, timers, and the TCC watcher')

  logger?.info?.(
    'approval-alert ready: sound=%s volume=%s watchSystemPrompts=%s notify=%s',
    options.sound,
    options.volume,
    options.watchSystemPrompts,
    options.notify,
  )
  trace(`apply platform=${process.platform} pid=${process.pid} sound=${options.sound}`)

  if (options.startupChime === true) {
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
