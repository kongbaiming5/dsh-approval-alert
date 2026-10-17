import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply, name } from '../lib/index.js'

process.env.DSH_APPROVAL_ALERT_NO_SOUND = '1'
process.env.DSH_APPROVAL_ALERT_NO_TCC_WATCH = '1'

function fakeContext() {
  const listeners = new Map()
  const disposers = []
  const ctx = {
    logger: { info() {} },
    on(event, fn, options) {
      listeners.set(event, { fn, options })
      return () => listeners.delete(event)
    },
    effect(factory) {
      const dispose = factory()
      disposers.push(dispose)
      return () => {}
    },
  }
  return { ctx, listeners, disposers }
}

function readTrace(file) {
  return readFileSync(file, 'utf8')
}

test('plugin exports the expected identity', () => {
  assert.equal(name, 'approval-alert')
})

test('approval requests alert first, then delegate to next()', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-approval-alert-'))
  const traceFile = join(dir, 'trace.log')
  const { ctx, listeners, disposers } = fakeContext()
  apply(ctx, { burst: 1, notify: false, watchSystemPrompts: false, traceFile })

  assert.equal(listeners.get('approval/request')?.options?.prepend, true)
  assert.equal(listeners.get('user-questions/request')?.options?.prepend, true)

  const listener = listeners.get('approval/request').fn
  const outcome = await listener(
    { toolName: 'bash', callId: 'call-1', reason: 'write outside the workspace' },
    async () => 'allowed-once',
  )
  assert.equal(outcome, 'allowed-once')

  const trace = readTrace(traceFile)
  assert.match(trace, /begin approval key=approval:call-1/)
  assert.match(trace, /end key=approval:call-1/)

  for (const dispose of disposers) dispose()
  rmSync(dir, { recursive: true, force: true })
})

test('question requests are alerted, and a throwing answerer still resolves the alert', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-approval-alert-'))
  const traceFile = join(dir, 'trace.log')
  const { ctx, listeners, disposers } = fakeContext()
  apply(ctx, { burst: 1, notify: false, watchSystemPrompts: false, traceFile })

  const listener = listeners.get('user-questions/request').fn
  const reply = await listener(
    {
      callId: 'ask-1',
      questions: [{ id: 'q1', question: 'Which file should I edit?', intent: { kind: 'plan-review' } }],
    },
    async () => ({ answers: [{ id: 'q1', selected: ['README'] }] }),
  )
  assert.deepEqual(reply, { answers: [{ id: 'q1', selected: ['README'] }] })

  assert.throws(
    () =>
      listener({ callId: 'ask-2', questions: [{ id: 'q2', question: 'Continue?' }] }, () => {
        throw new Error('answerer exploded')
      }),
    /answerer exploded/,
  )

  const trace = readTrace(traceFile)
  assert.match(trace, /begin question key=question:ask-1/)
  assert.match(trace, /end key=question:ask-1/)
  assert.match(trace, /begin question key=question:ask-2/)
  assert.match(trace, /end key=question:ask-2/)

  for (const dispose of disposers) dispose()
  rmSync(dir, { recursive: true, force: true })
})

test('disabled sources still delegate to the answerer without alerting', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-approval-alert-'))
  const traceFile = join(dir, 'trace.log')
  const { ctx, listeners, disposers } = fakeContext()
  apply(ctx, {
    enabled: true,
    alertOnApproval: false,
    alertOnQuestions: false,
    watchSystemPrompts: false,
    notify: false,
    burst: 1,
    traceFile,
  })

  assert.equal(listeners.get('approval/request')?.options?.prepend, true)
  assert.equal(listeners.get('user-questions/request')?.options?.prepend, true)

  const outcome = await listeners.get('approval/request').fn(
    { toolName: 'bash', callId: 'disabled-1' },
    async () => 'rejected',
  )
  assert.equal(outcome, 'rejected')

  const trace = readTrace(traceFile)
  assert.doesNotMatch(trace, /begin approval/)
  assert.doesNotMatch(trace, /play /)

  for (const dispose of disposers) dispose()
  rmSync(dir, { recursive: true, force: true })
})
