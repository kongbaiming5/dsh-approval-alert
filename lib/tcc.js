/**
 * macOS TCC permission-prompt watcher.
 *
 * macOS writes every privacy decision and every prompt attempt to the unified
 * log under the `com.apple.TCC` subsystem. Streaming just the prompt and result
 * messages is cheap (a handful of lines per minute) and needs no Accessibility
 * or Automation grant, so the plugin can learn that a system permission dialog
 * is actually on screen instead of guessing from process names.
 *
 * A prompt line looks like:
 *   ... AUTHREQ_PROMPTING: msgID=418.123, service=kTCCServiceMicrophone,
 *       subject=Sub:{com.deepseek.dsh}Resp:{...DeepSeek Harness.app...}
 *
 * The answer arrives later as:
 *   ... AUTHREQ_RESULT: msgID=418.123, authValue=2, authReason=2, ...
 */

import { spawn as nodeSpawn } from 'node:child_process'
import { createInterface } from 'node:readline'

export const TCC_PREDICATE =
  'subsystem == "com.apple.TCC" AND (composedMessage CONTAINS "AUTHREQ_PROMPTING" OR composedMessage CONTAINS "AUTHREQ_RESULT")'

export const TCC_LOG_ARGS = ['stream', '--predicate', TCC_PREDICATE, '--style', 'compact']

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
  const {
    onPrompt,
    onResolve,
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
    const event = parseTccLine(line)
    if (event === null) return
    if (event.type === 'prompt') {
      if (!event.dsh) return
      try {
        onPrompt?.({ msgId: event.msgId, service: event.service })
      } catch (error) {
        trace(`tcc prompt handler error ${String(error)}`)
      }
      return
    }
    try {
      onResolve?.({ msgId: event.msgId })
    } catch (error) {
      trace(`tcc result handler error ${String(error)}`)
    }
  }

  function start() {
    if (stopped || child !== null || platform !== 'darwin') return
    try {
      child = spawnImpl(logPath, TCC_LOG_ARGS, { stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (error) {
      trace(`tcc spawn error ${String(error)}`)
      scheduleRetry()
      return
    }
    trace(`tcc watcher start pid=${child.pid ?? '?'}`)
    child.once?.('error', (error) => {
      trace(`tcc watcher error ${String(error)}`)
      cleanupChild()
      scheduleRetry()
    })
    child.once?.('exit', (code, signal) => {
      if (stopped) return
      trace(`tcc watcher exit code=${code} signal=${signal}`)
      cleanupChild()
      scheduleRetry()
    })
    if (child.stdout) {
      reader = createInterface({ input: child.stdout, crlfDelay: Infinity })
      reader.on('line', handleLine)
    }
    child.stderr?.on?.('data', (chunk) => {
      const text = String(chunk).trim()
      if (text !== '') trace(`tcc stderr ${text.slice(0, 200)}`)
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
