/**
 * Framework-free alert engine for dsh-approval-alert.
 *
 * The engine owns only the macOS mechanics: playing a system sound at the
 * current output volume, optionally showing a notification, and repeating the
 * reminder while a request is still pending. The DSH event wiring lives in
 * ../lib/index.js so this module is testable on its own.
 */

import { spawn as nodeSpawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'

/** Sounds shipped with macOS in /System/Library/Sounds. */
export const SOUND_NAMES = [
  'Basso',
  'Blow',
  'Bottle',
  'Frog',
  'Funk',
  'Glass',
  'Hero',
  'Morse',
  'Ping',
  'Pop',
  'Purr',
  'Sosumi',
  'Submarine',
  'Tink',
]

/** Defaults shared by the plugin config schema and the standalone test. */
export const DEFAULTS = {
  enabled: true,
  sound: 'Glass',
  volume: 1,
  burst: 2,
  alertOnApproval: true,
  alertOnQuestions: true,
  watchSystemPrompts: true,
  systemPromptTimeoutMs: 600000,
  notify: true,
  startupChime: false,
  locale: 'zh',
  traceFile: '',
}

/**
 * Alert schedule requested by the operator:
 *   #1 immediately, then after 25s, 20s, 15s, 10s, and 5s thereafter.
 * Each entry is the wait AFTER the alert with that 1-based number.
 */
export const ALERT_CADENCE_MS = [25000, 20000, 15000, 10000]
export const ALERT_TAIL_MS = 5000

const DARWIN_SOUND_DIR = '/System/Library/Sounds'
const DARWIN_FALLBACK_SOUND = join(DARWIN_SOUND_DIR, 'Glass.aiff')

let cachedElectron

/**
 * Electron's main-process API, or null when the host is not Electron.
 * `require('electron')` returns a path string under ELECTRON_RUN_AS_NODE, so
 * the Notification constructor is the feature test.
 */
function probeElectron() {
  if (cachedElectron !== undefined) return cachedElectron
  cachedElectron = null
  try {
    const require = createRequire(import.meta.url)
    const api = require('electron')
    if (api && typeof api.Notification === 'function') cachedElectron = api
  } catch {
    // Plain Node host: notifications fall back to osascript on macOS.
  }
  return cachedElectron
}

function clamp(value, min, max, fallback) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, parsed))
}

/** Quote a string as an AppleScript literal (no shell involved). */
function appleScriptString(value) {
  return `"${String(value)
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/[\r\n]+/g, ' ')}"`
}

export function createAlerter(rawOptions = {}, deps = {}) {
  const options = rawOptions && typeof rawOptions === 'object' ? rawOptions : {}
  const option = (key) => {
    const value = options[key]
    return value === undefined ? DEFAULTS[key] : value
  }
  const spawn = deps.spawn ?? nodeSpawn
  const platform = deps.platform ?? process.platform
  const exists = deps.exists ?? existsSync
  const setTimeoutFn = deps.setTimeout ?? setTimeout
  const clearTimeoutFn = deps.clearTimeout ?? clearTimeout
  const getElectron = deps.getElectron ?? probeElectron
  const trace = typeof deps.trace === 'function' ? deps.trace : () => {}

  const pending = new Set()
  const pendingNotifications = new Map()
  const children = new Set()
  const burstTimers = new Set()
  const notifications = new Set()
  let cadenceTimer = null
  let alertsPlayed = 0
  let alerting = false
  let disposed = false

  function resolveSoundPath() {
    const wanted = typeof option('sound') === 'string' ? option('sound').trim() : ''
    if (wanted !== '' && (wanted.includes('/') || wanted.includes('\\'))) {
      return exists(wanted) ? wanted : DARWIN_FALLBACK_SOUND
    }
    const name = (wanted || 'Glass').replace(/\.(aiff|aif|wav|mp3|caf|ogg)$/i, '')
    if (platform === 'darwin') {
      const candidate = join(DARWIN_SOUND_DIR, `${name}.aiff`)
      return exists(candidate) ? candidate : DARWIN_FALLBACK_SOUND
    }
    return name
  }

  function spawnSound(command, args) {
    try {
      const child = spawn(command, args, { stdio: 'ignore' })
      children.add(child)
      child.once?.('error', () => {
        children.delete(child)
        trace(`play-error ${command}`)
      })
      child.once?.('exit', () => children.delete(child))
      child.unref?.()
      trace(`play ${command} ${args.join(' ')}`)
    } catch (error) {
      trace(`play-throw ${command} ${String(error)}`)
    }
  }

  function playOnce() {
    if (disposed || option('enabled') === false) return
    if (process.env.DSH_APPROVAL_ALERT_NO_SOUND === '1') {
      trace('play-skip no-sound-env')
      return
    }
    if (platform === 'darwin') {
      if (!exists('/usr/bin/afplay')) {
        trace('play-skip afplay-missing')
        return
      }
      const volume = clamp(option('volume'), 0.1, 4, 1)
      spawnSound('/usr/bin/afplay', ['-v', String(volume), resolveSoundPath()])
      return
    }
    if (platform === 'linux') {
      spawnSound('paplay', ['/usr/share/sounds/freedesktop/stereo/bell.oga'])
      return
    }
    if (platform === 'win32') {
      spawnSound('powershell.exe', [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        "(New-Object Media.SoundPlayer 'C:\\Windows\\Media\\Windows Notify System Generic.wav').PlaySync()",
      ])
    }
  }

  function playBurst() {
    if (disposed || option('enabled') === false) return
    playOnce()
    const burst = clamp(option('burst'), 1, 4, 1)
    for (let index = 1; index < burst; index += 1) {
      const timer = setTimeoutFn(() => {
        burstTimers.delete(timer)
        playOnce()
      }, index * 380)
      timer?.unref?.()
      burstTimers.add(timer)
    }
  }

  function clearBurstTimers() {
    for (const timer of burstTimers) clearTimeoutFn(timer)
    burstTimers.clear()
  }

  function showNotification(notification) {
    if (disposed || option('notify') === false) return
    if (typeof notification !== 'object' || notification === null) return
    const title = typeof notification.title === 'string' ? notification.title : ''
    const body = typeof notification.body === 'string' ? notification.body : ''
    if (title === '' && body === '') return

    const api = getElectron()
    if (api) {
      try {
        if (typeof api.Notification.isSupported === 'function' && !api.Notification.isSupported()) {
          trace('notify-unsupported')
        } else {
          const item = new api.Notification({ title, body, silent: true })
          notifications.add(item)
          if (notifications.size > 20) {
            const oldest = notifications.values().next().value
            notifications.delete(oldest)
            try {
              oldest?.close?.()
            } catch {}
          }
          item.once?.('close', () => notifications.delete(item))
          item.on?.('click', () => {
            notifications.delete(item)
            try {
              api.app?.show?.()
            } catch {}
            try {
              api.app?.focus?.({ steal: true })
            } catch {}
          })
          item.show()
          trace('notify electron')
          return
        }
      } catch (error) {
        trace(`notify-electron-error ${String(error)}`)
      }
    }

    if (platform === 'darwin' && exists('/usr/bin/osascript')) {
      const script = `display notification ${appleScriptString(body)} with title ${appleScriptString(title)}`
      try {
        const child = spawn('/usr/bin/osascript', ['-e', script], { stdio: 'ignore' })
        child.once?.('error', () => trace('notify-osascript-error'))
        child.unref?.()
        trace('notify osascript')
      } catch (error) {
        trace(`notify-osascript-throw ${String(error)}`)
      }
    }
  }

  function stopCadence() {
    if (cadenceTimer !== null) {
      clearTimeoutFn(cadenceTimer)
      cadenceTimer = null
    }
    alerting = false
    alertsPlayed = 0
  }

  function nextDelay() {
    return ALERT_CADENCE_MS[alertsPlayed - 1] ?? ALERT_TAIL_MS
  }

  function scheduleNext() {
    if (disposed || pending.size === 0) {
      stopCadence()
      return
    }
    const delay = nextDelay()
    cadenceTimer = setTimeoutFn(() => {
      cadenceTimer = null
      if (disposed || pending.size === 0) {
        stopCadence()
        return
      }
      alertsPlayed += 1
      trace(`alert #${alertsPlayed} pending=${pending.size} next=${ALERT_CADENCE_MS[alertsPlayed - 1] ?? ALERT_TAIL_MS}ms`)
      playBurst()
      scheduleNext()
    }, delay)
    cadenceTimer?.unref?.()
  }

  function beginAlerting() {
    if (disposed || alerting || pending.size === 0) return
    alerting = true
    alertsPlayed = 1
    trace(`alert #1 pending=${pending.size}`)
    playBurst()
    for (const notification of pendingNotifications.values()) showNotification(notification)
    pendingNotifications.clear()
    scheduleNext()
  }

  function begin(key, info = {}) {
    if (disposed || option('enabled') === false) return false
    const kind = info.kind === 'question' ? 'question' : info.kind === 'system' ? 'system' : 'approval'
    if (kind === 'question' && option('alertOnQuestions') === false) return false
    if (kind === 'approval' && option('alertOnApproval') === false) return false
    if (kind === 'system' && option('watchSystemPrompts') === false) return false
    if (typeof key !== 'string' || pending.has(key)) return false

    pending.add(key)
    if (info.notification) {
      if (alerting) showNotification(info.notification)
      else pendingNotifications.set(key, info.notification)
    }
    if (!alerting) beginAlerting()
    trace(`begin ${kind} key=${key} pending=${pending.size} alerting=${alerting}`)
    return true
  }

  function end(key) {
    if (!pending.delete(key)) return
    pendingNotifications.delete(key)
    trace(`end key=${key} pending=${pending.size}`)
    if (pending.size === 0) {
      stopCadence()
      clearBurstTimers()
    }
  }

  function dispose() {
    disposed = true
    pending.clear()
    pendingNotifications.clear()
    stopCadence()
    clearBurstTimers()
    for (const child of children) {
      try {
        child.kill?.('SIGTERM')
      } catch {}
    }
    children.clear()
    for (const item of notifications) {
      try {
        item.close?.()
      } catch {}
    }
    notifications.clear()
    trace('dispose')
  }

  return {
    begin,
    end,
    dispose,
    playBurst,
    showNotification,
    pendingCount: () => pending.size,
    options,
  }
}
