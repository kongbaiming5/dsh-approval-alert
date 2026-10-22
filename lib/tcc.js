/**
 * macOS system-prompt watchers.
 *
 * Two independent `log stream` subscriptions live here:
 *
 * 1. TCC prompts (`com.apple.TCC`): the privacy dialogs that ask for camera,
 *    microphone, screen recording, automation and folder access. macOS writes
 *    both the prompt and the answer to the unified log, so the plugin learns
 *    that a dialog is really on screen instead of guessing from process names.
 *
 *    A prompt line looks like:
 *      ... AUTHREQ_PROMPTING: msgID=418.123, service=kTCCServiceMicrophone,
 *          subject=Sub:{com.deepseek.dsh}Resp:{...DeepSeek Harness.app...}
 *    The answer arrives later as:
 *      ... AUTHREQ_RESULT: msgID=418.123, authValue=2, authReason=2, ...
 *
 * 2. Privilege prompts (`com.apple.Authorization`, process `SecurityAgent`):
 *    the "macOS 想要进行更改" / "需要管理员密码" sheet that appears whenever a
 *    process asks for `system.privilege.admin` — for example `sfltool`,
 *    `sudo` wrappers running inside a GUI session, or an installer helper.
 *    These are Authorization Services sheets, not TCC requests, so they carry
 *    no `AUTHREQ_PROMPTING` line and the TCC predicate above never sees them.
 *
 *    SecurityAgent logs the sheet lifecycle on its own subsystem:
 *      ... [com.apple.Authorization:SecurityAgent] Using modern UI
 *      ... [com.apple.Authorization:SecurityAgent] SC confirmation dialog detected
 *      ... [com.apple.Authorization:SecurityAgent] Donating to <...> LocalAuthentication.UI.Dialogs:
 *          <dialogID: com.apple.SecurityAgent.ExecuteWithPrivileges, ... successfulMechanism: 2 ...>
 *    The first two mark the sheet appearing; the donation line with
 *    `ExecuteWithPrivileges` is written once the mechanism finished, so it
 *    marks the sheet going away.
 *
 * Both watchers only read the log; neither needs Accessibility, Automation or
 * Screen Recording permission.
 */

import { spawn as nodeSpawn } from 'node:child_process'
import { createInterface } from 'node:readline'

export const TCC_PREDICATE =
  'subsystem == "com.apple.TCC" AND (composedMessage CONTAINS "AUTHREQ_PROMPTING" OR composedMessage CONTAINS "AUTHREQ_RESULT")'

export const TCC_LOG_ARGS = ['stream', '--predicate', TCC_PREDICATE, '--style', 'compact']

/** Privilege sheets are Authorization Services, so keep the stream narrow. */
export const PRIVILEGE_PREDICATE =
  'process == "SecurityAgent" AND subsystem == "com.apple.Authorization"'

export const PRIVILEGE_LOG_ARGS = ['stream', '--predicate', PRIVILEGE_PREDICATE, '--style', 'compact']

const DSH_IDENTITY = /com\.deepseek\.dsh|DeepSeek Harness/i

/**
 * Parse one compact `log stream` line.
 * @param {string} line
 * @returns {{type:'prompt', msgId:string, service:string, dsh:boolean}|{type:'result', msgId:string}|null}
 */
export function parseTccLine(line) {
  if (typeof line !== 'string') return null
  if (line.includes('AUTHREQ_PROMPTING')) {
    const msgId = /msgID=([^,\s]+)/.exec(line)?.[1]
    const service = /service=([^,\s]+)/.exec(line)?.[1]
    if (msgId === undefined || service === undefined) return null
    return { type: 'prompt', msgId, service, dsh: DSH_IDENTITY.test(line) }
  }
  if (line.includes('AUTHREQ_RESULT')) {
    const msgId = /msgID=([^,\s]+)/.exec(line)?.[1]
    if (msgId === undefined) return null
    return { type: 'result', msgId }
  }
  return null
}

const PRIVILEGE_START = /SC confirmation dialog detected|Using modern UI/
const PRIVILEGE_END = /com\.apple\.SecurityAgent\.ExecuteWithPrivileges|\b(?:authorization failed|authorization denied|user (?:canceled|cancelled|denied))\b/i

/**
 * Parse one `SecurityAgent` Authorization line.
 *
 * The donation line is a *completion* record: SecurityAgent writes it after a
 * mechanism succeeded (it carries `successfulMechanism`), roughly 200ms before
 * `authd` records the rights as authorized. `Using modern UI` and
 * `SC confirmation dialog detected` are written while the sheet is built, so
 * they are the "a password dialog is about to be on screen" signal.
 *
 * @param {string} line
 * @returns {{type:'prompt', dialog:'privilege'}|{type:'resolve', reason:string}|null}
 */
export function parsePrivilegeLine(line) {
  if (typeof line !== 'string') return null
  if (line.includes('ExecuteWithPrivileges')) return { type: 'resolve', reason: 'completed' }
  if (PRIVILEGE_END.test(line)) return { type: 'resolve', reason: 'failed' }
  if (PRIVILEGE_START.test(line)) return { type: 'prompt', dialog: 'privilege' }
  return null
}

/**
 * Run `log stream` with the given args and feed every line to the parser.
 * Shared by both watchers: one child, auto restart, and a hard stop.
 *
 * @param {object} options
 * @param {string[]} options.args
 * @param {(line:string)=>({type:string}|null|null)} options.parse
 * @param {(event:object)=>void} options.onEvent
 * @param {string} [options.label] prefix used in trace lines
 * @param {(line:string)=>void} [options.trace]
 * @param {typeof nodeSpawn} [options.spawnImpl]
 * @param {NodeJS.Platform} [options.platform]
 * @param {string} [options.logPath]
 * @param {number} [options.restartMs]
 */
function createLogWatcher(options = {}) {
  const {
    args,
    parse,
    onEvent,
    label = 'log',
    trace = () => {},
    spawnImpl = nodeSpawn,
    platform = process.platform,
    logPath = '/usr/bin/log',
    restartMs = 5000,
  } = options

  let child = null
  let reader = null
  let retryTimer = null
  let stopped = false
  // An explicit log path is an intentional override — a test fake or a wrapper
  // script — so only the default macOS `log` binary is platform-gated.
  const explicitLogPath = options.logPath !== undefined && options.logPath !== null

  function cleanupChild() {
    try {
      reader?.close?.()
    } catch {}
    reader = null
    child = null
  }

  function scheduleRetry() {
    if (stopped || retryTimer !== null) return
    retryTimer = setTimeout(() => {
      retryTimer = null
      start()
    }, restartMs)
    retryTimer?.unref?.()
  }

  function handleLine(line) {
    const event = parse(line)
    if (event === null || event === undefined) return
    try {
      onEvent(event)
    } catch (error) {
      trace(`${label} handler error ${String(error)}`)
    }
  }

  function start() {
    if (stopped || child !== null) return
    if (platform !== 'darwin' && !explicitLogPath) return
    try {
      child = spawnImpl(logPath, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (error) {
      trace(`${label} spawn error ${String(error)}`)
      scheduleRetry()
      return
    }
    trace(`${label} watcher start pid=${child.pid ?? '?'}`)
    child.once?.('error', (error) => {
      trace(`${label} watcher error ${String(error)}`)
      cleanupChild()
      scheduleRetry()
    })
    child.once?.('exit', (code, signal) => {
      if (stopped) return
      trace(`${label} watcher exit code=${code} signal=${signal}`)
      cleanupChild()
      scheduleRetry()
    })
    if (child.stdout) {
      reader = createInterface({ input: child.stdout, crlfDelay: Infinity })
      reader.on('line', handleLine)
    }
    child.stderr?.on?.('data', (chunk) => {
      const text = String(chunk).trim()
      if (text !== '') trace(`${label} stderr ${text.slice(0, 200)}`)
    })
  }

  function stop() {
    stopped = true
    if (retryTimer !== null) {
      clearTimeout(retryTimer)
      retryTimer = null
    }
    const current = child
    cleanupChild()
    if (current) {
      try {
        current.kill?.('SIGTERM')
      } catch {}
    }
  }

  return {
    start,
    stop,
    get running() {
      return child !== null
    },
  }
}

/**
 * Stream TCC prompt/result lines and report DSH prompts plus every result.
 *
 * @param {object} options
 * @param {(event:{msgId:string, service:string})=>void} options.onPrompt
 * @param {(event:{msgId:string})=>void} options.onResolve
 * @param {(line:string)=>void} [options.trace]
 * @param {typeof nodeSpawn} [options.spawnImpl]
 * @param {NodeJS.Platform} [options.platform]
 * @param {string} [options.logPath]
 * @param {number} [options.restartMs]
 */
export function createTccWatcher(options = {}) {
  const { onPrompt, onResolve } = options
  return createLogWatcher({
    ...options,
    label: 'tcc',
    args: TCC_LOG_ARGS,
    parse: parseTccLine,
    onEvent: (event) => {
      if (event.type === 'prompt') {
        if (!event.dsh) return
        onPrompt?.({ msgId: event.msgId, service: event.service })
        return
      }
      onResolve?.({ msgId: event.msgId })
    },
  })
}

/**
 * Stream SecurityAgent Authorization lines and report privilege sheets.
 *
 * @param {object} options
 * @param {(event:{dialog:string})=>void} options.onPrompt
 * @param {(event:{reason:string})=>void} options.onResolve
 * @param {(line:string)=>void} [options.trace]
 * @param {typeof nodeSpawn} [options.spawnImpl]
 * @param {NodeJS.Platform} [options.platform]
 * @param {string} [options.logPath]
 * @param {number} [options.restartMs]
 */
export function createPrivilegeWatcher(options = {}) {
  const { onPrompt, onResolve } = options
  return createLogWatcher({
    ...options,
    label: 'privilege',
    args: PRIVILEGE_LOG_ARGS,
    parse: parsePrivilegeLine,
    onEvent: (event) => {
      if (event.type === 'prompt') {
        onPrompt?.({ dialog: event.dialog })
        return
      }
      onResolve?.({ reason: event.reason })
    },
  })
}
