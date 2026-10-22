import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { createPrivilegeWatcher, createTccWatcher, parsePrivilegeLine, parseTccLine, PRIVILEGE_LOG_ARGS, TCC_LOG_ARGS } from '../lib/tcc.js'

const PROMPT = '2026-10-17 23:38:44.499 Df tccd[683:1dc8a] [com.apple.TCC:access] AUTHREQ_PROMPTING: msgID=8236.4, service=kTCCServiceMicrophone, subject=Sub:{com.deepseek.dsh}Resp:{TCCDProcess: identifier=com.deepseek.dsh, pid=1825, auid=501, euid=501, responsible_path=/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness, binary_path=/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness},'
const OTHER_APP_PROMPT = '2026-10-17 23:38:44.499 Df tccd[683:1dc8a] [com.apple.TCC:access] AUTHREQ_PROMPTING: msgID=99.1, service=kTCCServiceMicrophone, subject=Sub:{com.example.app}Resp:{TCCDProcess: identifier=com.example.app, pid=999, auid=501, euid=501, responsible_path=/Applications/Example.app/Contents/MacOS/Example, binary_path=/Applications/Example.app/Contents/MacOS/Example},'
const RESULT = '2026-10-17 23:39:09.766 Df tccd[683:1ee76] [com.apple.TCC:access] AUTHREQ_RESULT: msgID=8236.4, authValue=2, authReason=2, authVersion=1, desired_auth=0, error=(null),'

test('parses a DSH TCC prompt line', () => {
  assert.deepEqual(parseTccLine(PROMPT), {
    type: 'prompt',
    msgId: '8236.4',
    service: 'kTCCServiceMicrophone',
    dsh: true,
  })
})

test('marks other applications as not DSH', () => {
  assert.equal(parseTccLine(OTHER_APP_PROMPT)?.dsh, false)
})

test('parses a TCC result line', () => {
  assert.deepEqual(parseTccLine(RESULT), { type: 'result', msgId: '8236.4' })
})

test('ignores unrelated log lines', () => {
  assert.equal(parseTccLine('Filtering the log data using ...'), null)
  assert.equal(parseTccLine(''), null)
})

test('streams DSH prompts and resolves them through a log child', async () => {
  const child = new EventEmitter()
  child.stdout = new PassThrough()
  child.stderr = new PassThrough()
  child.pid = 123
  let killed = null
  child.kill = (signal) => {
    killed = signal
  }

  const prompts = []
  const results = []
  const watcher = createTccWatcher({
    onPrompt: (event) => prompts.push(event),
    onResolve: (event) => results.push(event),
    spawnImpl: (command, args) => {
      assert.equal(command, '/usr/bin/log')
      assert.deepEqual(args, TCC_LOG_ARGS)
      return child
    },
    platform: 'darwin',
  })

  watcher.start()
  child.stdout.write(`${OTHER_APP_PROMPT}\n`)
  child.stdout.write(`${PROMPT}\n`)
  await new Promise((resolve) => setTimeout(resolve, 10))

  assert.deepEqual(prompts, [{ msgId: '8236.4', service: 'kTCCServiceMicrophone' }])

  child.stdout.write(`${RESULT}\n`)
  await new Promise((resolve) => setTimeout(resolve, 10))
  assert.deepEqual(results, [{ msgId: '8236.4' }])

  watcher.stop()
  assert.equal(killed, 'SIGTERM')
  assert.equal(watcher.running, false)
})

const PRIVILEGE_START_UI =
  '2026-10-22 23:18:22.891 Df SecurityAgent[14119:3278d] [com.apple.Authorization:SecurityAgent] Using modern UI'
const PRIVILEGE_START_SC =
  '2026-10-22 23:18:22.928 Df SecurityAgent[14119:3278d] [com.apple.Authorization:SecurityAgent] SC confirmation dialog detected'
const PRIVILEGE_DONE =
  '2026-10-22 23:18:29.056 Df SecurityAgent[14119:3278d] [com.apple.Authorization:SecurityAgent] Donating to <BMStoreSource: 0xb6e485560> LocalAuthentication.UI.Dialogs: <dialogID: com.apple.SecurityAgent.ExecuteWithPrivileges, bundleID: <private> timeSinceUpdate: 13599806, mechanisms: ('

test('parses the SecurityAgent sheet appearing', () => {
  assert.deepEqual(parsePrivilegeLine(PRIVILEGE_START_UI), { type: 'prompt', dialog: 'privilege' })
  assert.deepEqual(parsePrivilegeLine(PRIVILEGE_START_SC), { type: 'prompt', dialog: 'privilege' })
})

test('parses the ExecuteWithPrivileges donation as the sheet finishing', () => {
  assert.deepEqual(parsePrivilegeLine(PRIVILEGE_DONE), { type: 'resolve', reason: 'completed' })
})

test('privilege parser ignores TCC prompts and noise', () => {
  assert.equal(parsePrivilegeLine(PROMPT), null)
  assert.equal(parsePrivilegeLine(RESULT), null)
  assert.equal(parsePrivilegeLine(''), null)
})

test('streams privilege sheets and their completion through a log child', async () => {
  const child = new EventEmitter()
  child.stdout = new PassThrough()
  child.stderr = new PassThrough()
  child.pid = 456
  let killed = null
  child.kill = (signal) => {
    killed = signal
  }

  const prompts = []
  const resolves = []
  const watcher = createPrivilegeWatcher({
    onPrompt: (event) => prompts.push(event),
    onResolve: (event) => resolves.push(event),
    spawnImpl: (command, args) => {
      assert.equal(command, '/usr/bin/log')
      assert.deepEqual(args, PRIVILEGE_LOG_ARGS)
      return child
    },
    platform: 'darwin',
  })

  watcher.start()
  child.stdout.write(`${PRIVILEGE_START_UI}\n`)
  child.stdout.write(`${PRIVILEGE_START_SC}\n`)
  await new Promise((resolve) => setTimeout(resolve, 10))
  assert.deepEqual(prompts, [{ dialog: 'privilege' }, { dialog: 'privilege' }])

  child.stdout.write(`${PRIVILEGE_DONE}\n`)
  await new Promise((resolve) => setTimeout(resolve, 10))
  assert.deepEqual(resolves, [{ reason: 'completed' }])

  watcher.stop()
  assert.equal(killed, 'SIGTERM')
  assert.equal(watcher.running, false)
})
