import test from 'node:test'
import assert from 'node:assert/strict'
import { ALERT_CADENCE_MS, ALERT_TAIL_MS, createAlerter, DEFAULTS } from '../lib/core.js'

function fakeSpawn(calls, children) {
  return (command, args) => {
    calls.push({ command, args })
    const child = {
      killed: false,
      once() {},
      unref() {},
      kill(signal) {
        this.killed = true
        children?.push({ signal })
      },
    }
    return child
  }
}

function fakeElectron() {
  const shown = []
  class FakeNotification {
    constructor(options) {
      this.options = options
      this.shown = false
    }
    static isSupported() {
      return true
    }
    on() {}
    once() {}
    show() {
      this.shown = true
      shown.push(this)
    }
    close() {}
  }
  return {
    Notification: FakeNotification,
    app: { focus() {}, show() {} },
    shown,
  }
}

function fakeClock() {
  let now = 0
  let nextId = 1
  const timers = new Map()
  const setTimeout = (callback, delay) => {
    const id = nextId
    nextId += 1
    timers.set(id, { at: now + delay, callback })
    return id
  }
  const clearTimeout = (id) => {
    timers.delete(id)
  }
  const advance = (ms) => {
    const target = now + ms
    for (;;) {
      let earliest = null
      for (const [id, timer] of timers) {
        if (timer.at <= target && (earliest === null || timer.at < earliest.timer.at)) {
          earliest = { id, timer }
        }
      }
      if (earliest === null) break
      now = earliest.timer.at
      timers.delete(earliest.id)
      earliest.timer.callback()
    }
    now = target
  }
  return { setTimeout, clearTimeout, advance, pending: () => timers.size }
}

function makeAlerter(overrides = {}, deps = {}) {
  const calls = []
  const alerter = createAlerter(
    { ...DEFAULTS, burst: 1, notify: false, ...overrides },
    {
      platform: 'darwin',
      exists: () => true,
      spawn: fakeSpawn(calls),
      ...deps,
    },
  )
  return { alerter, calls }
}

test('first alert is immediate and the cadence is 25/20/15/10/5s', () => {
  const clock = fakeClock()
  const { alerter, calls } = makeAlerter(
    { sound: 'Glass', volume: 1 },
    { setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout },
  )

  alerter.begin('approval:cadence', { kind: 'approval' })
  assert.equal(calls.length, 1, 'alert #1 is immediate')
  assert.deepEqual(calls[0], {
    command: '/usr/bin/afplay',
    args: ['-v', '1', '/System/Library/Sounds/Glass.aiff'],
  })

  const expected = [
    { after: ALERT_CADENCE_MS[0], count: 2 },
    { after: ALERT_CADENCE_MS[1], count: 3 },
    { after: ALERT_CADENCE_MS[2], count: 4 },
    { after: ALERT_CADENCE_MS[3], count: 5 },
    { after: ALERT_TAIL_MS, count: 6 },
    { after: ALERT_TAIL_MS, count: 7 },
  ]
  for (const step of expected) {
    clock.advance(step.after - 1)
    assert.equal(calls.length, step.count - 1, `not yet at ${step.after}ms`)
    clock.advance(1)
    assert.equal(calls.length, step.count, `alert #${step.count}`)
  }

  alerter.end('approval:cadence')
  assert.equal(clock.pending(), 0)
  clock.advance(60000)
  assert.equal(calls.length, 7)
  alerter.dispose()
})

test('resolving the request stops the cadence', () => {
  const clock = fakeClock()
  const { alerter, calls } = makeAlerter({}, { setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout })

  alerter.begin('approval:stop', { kind: 'approval' })
  assert.equal(calls.length, 1)
  alerter.end('approval:stop')
  clock.advance(120000)
  assert.equal(calls.length, 1)
  alerter.dispose()
})

test('duplicate keys do not double-alert', () => {
  const { alerter, calls } = makeAlerter()
  assert.equal(alerter.begin('approval:3', { kind: 'approval' }), true)
  assert.equal(alerter.begin('approval:3', { kind: 'approval' }), false)
  assert.equal(calls.length, 1)
  alerter.dispose()
})

test('questions can be silenced independently', () => {
  const { alerter, calls } = makeAlerter({ alertOnQuestions: false })
  assert.equal(alerter.begin('question:1', { kind: 'question' }), false)
  assert.equal(calls.length, 0)
  assert.equal(alerter.pendingCount(), 0)
  alerter.dispose()
})

test('system prompts can be silenced independently', () => {
  const { alerter, calls } = makeAlerter({ watchSystemPrompts: false })
  assert.equal(alerter.begin('tcc:1', { kind: 'system' }), false)
  assert.equal(calls.length, 0)
  alerter.dispose()
})

test('burst plays the configured number of chimes', () => {
  const clock = fakeClock()
  const { alerter, calls } = makeAlerter(
    { burst: 2 },
    { setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout },
  )

  alerter.begin('approval:burst', { kind: 'approval' })
  assert.equal(calls.length, 1)
  clock.advance(380)
  assert.equal(calls.length, 2)
  alerter.end('approval:burst')
  alerter.dispose()
})

test('notification is explicit and silent', () => {
  const electron = fakeElectron()
  const { alerter } = makeAlerter({ notify: true }, { getElectron: () => electron })

  alerter.begin('approval:4', {
    kind: 'approval',
    notification: { title: 'Title', body: 'Body' },
  })

  assert.equal(electron.shown.length, 1)
  assert.deepEqual(electron.shown[0].options, { title: 'Title', body: 'Body', silent: true })
  assert.equal(electron.shown[0].shown, true)
  alerter.dispose()
})

test('DSH_APPROVAL_ALERT_NO_SOUND suppresses playback', () => {
  const previous = process.env.DSH_APPROVAL_ALERT_NO_SOUND
  process.env.DSH_APPROVAL_ALERT_NO_SOUND = '1'
  try {
    const { alerter, calls } = makeAlerter()
    alerter.begin('approval:5', { kind: 'approval' })
    assert.equal(calls.length, 0)
    alerter.dispose()
  } finally {
    if (previous === undefined) delete process.env.DSH_APPROVAL_ALERT_NO_SOUND
    else process.env.DSH_APPROVAL_ALERT_NO_SOUND = previous
  }
})
