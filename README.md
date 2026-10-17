# dsh-approval-alert

[中文](README.zh.md) | English

A macOS approval chime for **DeepSeek Harness**. When DSH is blocked on a human
decision — a tool approval, an agent question, or a macOS permission dialog — it
plays a real system sound at your current output volume and repeats until you answer.

[![test](https://github.com/kongbaiming5/dsh-approval-alert/actions/workflows/test.yml/badge.svg)](https://github.com/kongbaiming5/dsh-approval-alert/actions/workflows/test.yml)
[![license](https://img.shields.io/github/license/kongbaiming5/dsh-approval-alert)](LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](package.json)

## What it covers

| Source | Event | Examples |
|---|---|---|
| DSH tool approval | `approval/request` | sandbox escalation, destructive commands, writes outside the workspace |
| DSH agent questions | `user-questions/request` | `ask_user_question`, plan review (`exit_plan_mode`) |
| macOS TCC prompts | Unified log `AUTHREQ_PROMPTING` | microphone, camera, screen recording, accessibility, automation, files and folders, Full Disk Access |

The macOS watcher only reacts to prompts whose TCC identity is
`com.deepseek.dsh` / `DeepSeek Harness`; other applications' permission dialogs
are ignored. It reads the unified log, so **no Accessibility or Automation grant
is required**.

## Reminder cadence

The first alert fires **immediately**, then:

| Alert | Wait after the previous alert |
|---|---|
| #1 | immediate (0 s) |
| #2 | 25 s |
| #3 | 20 s |
| #4 | 15 s |
| #5 | 10 s |
| #6 and later | 5 s each |

- Each alert is a double chime by default (`burst: 2`, 0.38 s apart).
- It stops as soon as you allow/reject, answer the question, or the macOS dialog
  returns a result.
- Multiple pending requests share one cadence; it stops when all are resolved.
- After alert #6 there is no alert-count limit. TCC prompts have a separate
  `systemPromptTimeoutMs` safety cap (10 minutes by default) in case the log
  result is missed.

## Requirements

- macOS 13 or newer (tested on macOS 26, Apple Silicon).
- DeepSeek Harness with profile plugins (tested with `0.2.1-rc.2`).
- Node.js 20+ for the test suite only; the DSH runtime provides Node at runtime.

## Install

### One command (from a clone)

```bash
git clone https://github.com/kongbaiming5/dsh-approval-alert.git
cd dsh-approval-alert
./scripts/install.sh desktop
```

The script:

1. resolves the `dsh` CLI (`$DSH_BIN`, `PATH`, or the macOS app bundle),
2. adds this directory to `$DSH_HOME/profiles/<profile>/package.json`,
3. appends the loader entry to `$DSH_HOME/profiles/<profile>/cordis.patch.yml`
   if it is not already present.

A running DSH desktop app hot-reloads `cordis.patch.yml`; otherwise restart it.
`DSH_HOME` defaults to `~/.dsh`; set it explicitly if your profile lives elsewhere.
Use another profile by passing it as the first argument, e.g. `./scripts/install.sh web`.

### Manual install

```bash
export DSH_HOME="${DSH_HOME:-$HOME/.dsh}"
DSH_BIN="${DSH_BIN:-/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh}"

"$DSH_BIN" plugin --profile desktop add "file:$PWD"
```

Then append the entry from [`cordis.patch.yml`](cordis.patch.yml) to
`$DSH_HOME/profiles/desktop/cordis.patch.yml`. If you install from another
location, `file:` points at that clone; keep the directory in place.

> The DSH plugin manager may print
> `dsh-approval-alert declares no dsh.bundle — installed as a plain dependency`.
> That is expected for this manual profile-layer install; the loader entry is
> what mounts the plugin.

## Verify

### Audio path

Set `startupChime: true` in the profile entry and save the patch. You should hear
two Glass chimes and see a test notification. Set it back to `false` afterwards.

### macOS permission prompt (microphone)

DSH may already have a microphone decision. Re-arm the prompt:

```bash
tccutil reset Microphone com.deepseek.dsh
```

Then trigger a microphone request, for example:

```bash
ffmpeg -f avfoundation -i ":0" -t 0.5 -y /tmp/dsh-mic-test.wav
```

The first chime should fire at the same moment the system dialog appears. Click
**Allow** or **Don't Allow** and the cadence stops. The reset only affects DSH's
microphone decision; you can choose again.

### DSH tool approval

Switch the session permission preset to **ask**, then let the agent request a
wider sandbox mode. The chime fires immediately; approving or rejecting stops it.

## Configuration

Edit the `approval-alert` entry in
`$DSH_HOME/profiles/<profile>/cordis.patch.yml`:

```yaml
- insert:
    - id: approval-alert
      name: dsh-approval-alert
      config:
        enabled: true
        sound: Glass               # system sound name or absolute audio path
        volume: 1                  # afplay multiplier; 1 = current output volume
        burst: 2                   # chimes per alert
        alertOnApproval: true      # DSH tool approvals
        alertOnQuestions: true     # DSH questions / plan review
        watchSystemPrompts: true   # macOS TCC prompts
        systemPromptTimeoutMs: 600000  # TCC safety cap (10 min)
        notify: true               # best-effort system notification
        startupChime: false        # manual self-test
        locale: zh                 # notification language: zh | en
        traceFile: ""              # e.g. /tmp/dsh-approval-alert.log
```

| Key | Default | Meaning |
|---|---|---|
| `enabled` | `true` | Master switch |
| `sound` | `Glass` | Any `/System/Library/Sounds/*.aiff` name, or an absolute path |
| `volume` | `1` | `afplay -v` multiplier; 1 follows the current output volume |
| `burst` | `2` | Number of chimes per alert |
| `alertOnApproval` | `true` | DSH tool approvals |
| `alertOnQuestions` | `true` | DSH questions and plan review |
| `watchSystemPrompts` | `true` | Stream macOS TCC prompt/result log entries |
| `systemPromptTimeoutMs` | `600000` | Stop a TCC alert if no result is seen within this time |
| `notify` | `true` | Show a notification on the first alert for each request |
| `startupChime` | `false` | Play a test chime and notification when mounted |
| `locale` | `zh` | Notification text language (`zh` or `en`) |
| `traceFile` | `""` | Append trigger/timer diagnostics to a local file |

Sounds: `Basso`, `Blow`, `Bottle`, `Frog`, `Funk`, `Glass`, `Hero`, `Morse`,
`Ping`, `Pop`, `Purr`, `Sosumi`, `Submarine`, `Tink`.

## How it works

- **DSH approvals/questions.** The plugin registers prepended listeners on the
  `approval/request` and `user-questions/request` Cordis waterfalls. It starts the
  cadence and then calls `next()`, so the normal approval/question answerer still
  receives the request unchanged.
- **macOS TCC prompts.** A long-lived `log stream` child filters
  `com.apple.TCC` prompt and result messages. `AUTHREQ_PROMPTING` for
  `com.deepseek.dsh` starts the cadence; the matching `AUTHREQ_RESULT` stops it.
  The watcher restarts itself if the log stream exits.
- **Cadence + audio.** `lib/core.js` owns the 0/25/20/15/10/5 s schedule,
  deduplication of concurrent requests, `/usr/bin/afplay` playback, notifications,
  and cleanup.
- **No network, no credentials.** The only external commands are `afplay`,
  `log`, and (for the notification fallback) `osascript`.

## Troubleshooting

| Symptom | Check |
|---|---|
| No sound at all | `afplay /System/Library/Sounds/Glass.aiff`; check output volume and mute; check `enabled`; set `traceFile` and look for `play` lines |
| Sound starts too late/early | The cadence is fixed at 0/25/20/15/10/5 s by design; `burst` only changes chimes per alert |
| macOS prompt doesn't trigger | `log show --last 1m --predicate 'subsystem == "com.apple.TCC"'`; look for `AUTHREQ_PROMPTING` and `com.deepseek.dsh`; check `watchSystemPrompts` and the trace |
| Chime repeats forever | The TCC result was missed; check `traceFile` for `tcc result`; `systemPromptTimeoutMs` is the safety cap |
| Notification says "Script Editor" | The Host does not expose Electron's Notification API, so `osascript` is the fallback; set `notify: false` to disable |
| Plugin not mounted | Confirm the dependency in `$DSH_HOME/profiles/<profile>/package.json` and the `approval-alert` entry in `cordis.patch.yml`; save the patch to trigger a hot reload |
| Duplicate chimes | Make sure only one `approval-alert` entry is mounted and the package is installed once |

## Security and privacy

- No network requests, telemetry, credentials, or environment inspection.
- The TCC watcher reads only `com.apple.TCC` prompt/result lines and filters them
  to the DSH bundle identity; other apps' permission prompts are ignored.
- `traceFile` is local and contains event names, service names, PIDs, and timing;
  leave it empty unless debugging.
- The install script only edits the selected DSH profile; it does not modify the
  app bundle or system settings.
- `tccutil reset` is only used in the documentation as an explicit opt-in way to
  re-test a permission prompt.

## Development

```bash
npm test
# or:
node --test test/core.test.mjs test/index.test.mjs test/tcc.test.mjs
```

No dependencies need to be installed for the tests; they use a fake clock, fake
processes, and real TCC log lines as parser fixtures. Set
`DSH_APPROVAL_ALERT_NO_SOUND=1` to suppress playback in any manual run.

```
lib/core.js   cadence, afplay, notifications
lib/tcc.js    TCC log stream + parser
lib/index.js  Cordis plugin wiring
test/         Node test runner suites
```

## License

MIT — see [LICENSE](LICENSE).
