# Approval Chime · dsh-approval-alert

[中文](README.md) | English

A **DeepSeek Harness** plugin that plays a macOS system sound when DSH is blocked
on a human decision: a tool approval, an agent question, or a macOS permission
prompt. It ships as a bundle with a switch and a config form in the Plugins page.

[![test](https://github.com/kongbaiming5/dsh-approval-alert/actions/workflows/test.yml/badge.svg)](https://github.com/kongbaiming5/dsh-approval-alert/actions/workflows/test.yml)
[![dsh.so risk](https://www.dsh.so/badge/dsh-approval-alert.svg)](https://www.dsh.so/artifact/dsh-approval-alert/)
[![license](https://img.shields.io/github/license/kongbaiming5/dsh-approval-alert)](LICENSE)

## What it covers

| Source | Examples |
|---|---|
| DSH tool approval | sandbox escalation, destructive commands, writes outside the workspace |
| DSH agent questions | `ask_user_question`, plan review (`exit_plan_mode`) |
| macOS TCC prompts | microphone, camera, screen recording, accessibility, automation, files and folders, Full Disk Access |
| macOS admin password sheets | the "wants to make changes" box raised by `sudo`, `sfltool`, or an installer asking for `system.privilege.admin` |

TCC prompts are filtered to `com.deepseek.dsh` / `DeepSeek Harness`; other apps'
permission dialogs are ignored.

Admin password sheets live on a different path (`com.apple.Authorization` /
`SecurityAgent`), are not TCC, and are not attributable to one app, so they have
their own `watchPrivilegePrompts` switch. A dialog that matches both paths chimes
once.

## Where to find it in DSH

After installing and enabling the bundle:

1. Open **Plugins** in the sidebar.
2. Find the **Approval Chime / 授权提醒** card under **Installed plugins**
   (package `dsh-approval-alert`).
3. The switch on the card controls the bundle; the `approval-alert` row inside
   has its own switch.
4. Open the row to get the **config form** (Chinese by default). Saves apply
   immediately through DSH's volatile-config mechanism.

The plugin also appears as `approval-alert` in **Settings → Built-in plugins →
Plugin list**, but that page is read-only runtime status. Use the Plugins page
for configuration.

## Reminder cadence

| Alert | Wait after the previous alert |
|---|---|
| #1 | immediate (0 s) |
| #2 | 25 s |
| #3 | 20 s |
| #4 | 15 s |
| #5 | 10 s |
| #6 and later | 5 s each |

- Each alert is a double chime by default (`burst: 2`).
- It stops when you allow/reject, answer, or the macOS dialog returns a result.
- Multiple pending requests share one cadence.
- TCC prompts have a `systemPromptTimeoutMs` safety cap (10 minutes by default).
- Admin password sheets stop when you cancel or authenticate, with a
  `privilegePromptTimeoutMs` cap (3 minutes by default).

## Install

### One command from a clone

```bash
git clone https://github.com/kongbaiming5/dsh-approval-alert.git
cd dsh-approval-alert
./scripts/install.sh desktop
```

The script adds the local package to the profile, selects the bundle in
`dsh.profile.bundles`, and warns about a legacy manual insert. If DSH is running,
restart it once so the bundle list is re-read; then the card appears in Plugins.

### Through the Plugins page

**Plugins → Add plugin → Install a third-party plugin**, enter the absolute path
to the cloned package, install, and enable the bundle. The same config form is
available on the card.

### Requirements

- macOS 13+ (tested on macOS 26, Apple Silicon).
- DeepSeek Harness with profile bundles (tested with `0.2.1-rc.2`).
- Node.js 20+ for tests only.

## Plugin marketplace

- **dsh.so marketplace**: already listed — see the [dsh.so artifact page](https://www.dsh.so/artifact/dsh-approval-alert/) (the badge at the top of this README links there).
- **DSH community catalog**: submitted to [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin); once merged, search for **Approval Chime** or `dsh-approval-alert` under **Plugins → Discover**.

You can also install it directly from GitHub:

```bash
dsh plugin --profile desktop add github:kongbaiming5/dsh-approval-alert
```

> The catalog is curated; entries usually appear within a day of the PR merging. No npm package is required. The latest GitHub Release carries a prebuilt tarball, which the market prefers over a source build.

> The web profile boots cleanly too; the config form appears where the plugin manager is composed (the desktop profile).

## Config form

The row config page exposes:

| Field | Default | Meaning |
|---|---|---|
| Enable approval alerts | on | master switch |
| Sound | `Glass` | system sound name or absolute audio path |
| Volume multiplier | `1` | `afplay -v`; 1 follows the system output volume |
| Chimes per alert | `2` | 1–4 |
| System notification | on | one notification on the first alert |
| DSH tool approvals | on | approval requests |
| Agent questions / plan review | on | `ask_user_question`, `exit_plan_mode` |
| macOS system prompts | on | DSH-triggered TCC dialogs |
| System-prompt safety cap | `600000` | milliseconds; 0 disables the cap |
| macOS admin password sheets | on | `SecurityAgent` sheets from `sudo`, `sfltool`, installers |
| Password-sheet safety cap | `180000` | milliseconds; stops on cancel or success |
| Notification language | `zh` | Chinese / English |
| Trace file | empty | e.g. `/tmp/dsh-approval-alert.log` |

Saving writes the profile patch through DSH's plugin configuration service; no
manual YAML editing is needed. Advanced users can still edit the
`approval-alert` override in `$DSH_HOME/profiles/<profile>/cordis.patch.yml`.

## Verify

- Toggle **Enable approval alerts** on, save, then trigger a DSH approval or a
  macOS permission prompt. The first chime is immediate.
- Microphone test:

```bash
tccutil reset Microphone com.deepseek.dsh
ffmpeg -f avfoundation -i ":0" -t 0.5 -y /tmp/dsh-mic-test.wav
```

- Switch the session permission preset to **ask** for a DSH approval test.
- Admin password test (runs `true`, changes nothing):

```bash
osascript -e 'do shell script "true" with administrator privileges'
```

## How it works

- **DSH approvals/questions:** prepended listeners on the `approval/request` and
  `user-questions/request` waterfalls start the cadence and call `next()`, so the
  normal answerer still receives the request unchanged.
- **macOS TCC prompts:** a long-lived `log stream` filters
  `com.apple.TCC` prompt/result messages. `AUTHREQ_PROMPTING` for
  `com.deepseek.dsh` starts the cadence; `AUTHREQ_RESULT` stops it.
- **macOS admin password sheets:** a second `log stream` filters `SecurityAgent`
  on `com.apple.Authorization`. `Using modern UI` / `SC confirmation dialog
  detected` marks the sheet appearing; the `ExecuteWithPrivileges` completion
  record marks it closing. Both sources share one alert engine.
- **Live config:** every config field is `volatile`; the Host reads the current
  value on each use and the form writes through DSH's config service.
- **No network or credentials:** only `afplay`, `log`, and `osascript` for the
  notification fallback.

## Notifications

The first alert tries a system notification. The desktop Host does not expose
Electron's Notification API, so it falls back to `osascript display notification`
and may appear as “Script Editor”. Disable notifications in the form if unwanted;
sound is unaffected.

## Troubleshooting

| Symptom | Check |
|---|---|
| No card in Plugins | Is `dsh-approval-alert` in `dsh.profile.bundles`? Restart once. Remove any legacy manual insert. |
| Card exists but no config page | Is the `approval-alert` row enabled? Reopen the Plugins page. |
| No sound | `afplay /System/Library/Sounds/Glass.aiff`; check volume/mute and the form switches. |
| macOS prompt not detected | `log show --last 1m --predicate 'subsystem == "com.apple.TCC"'`; look for `AUTHREQ_PROMPTING` and `com.deepseek.dsh`; enable the trace file. |
| Alerts never stop | The TCC result may have been missed; check the trace for `tcc result`; lower the safety cap. |
| Password sheet not detected | `log show --last 1m --predicate 'process == "SecurityAgent" AND subsystem == "com.apple.Authorization"'`; look for `Using modern UI` and `SC confirmation dialog detected`; check the trace for `privilege prompt`. |
| Password sheet chimes forever | Check the trace for `privilege resolve reason=completed`; otherwise the `privilegePromptTimeoutMs` cap stops it. |
| Notification says “Script Editor” | Expected fallback; turn notifications off. |

## Security and privacy

- No network requests, credentials, or telemetry.
- The TCC watcher reads only prompt/result lines and filters them to the DSH
  identity.
- The password-sheet watcher reads only SecurityAgent dialog lifecycle lines on
  `com.apple.Authorization`; it never reads your password, injects into another
  process, or asks for a permission.
- The trace file is local and contains event names, service names, PIDs, and
  timing; leave it empty unless debugging.
- The install script only edits the selected DSH profile.
- `tccutil reset` is documented as an explicit, opt-in way to re-test a prompt.

## Development

```bash
npm test
# or:
node --test test/core.test.mjs test/index.test.mjs test/tcc.test.mjs test/client.test.mjs
```

No dependencies are needed for the tests; they use a fake clock, fake processes,
real TCC and SecurityAgent log lines, and a fake module loader. 25 tests cover the
cadence, TCC and password-sheet parsing, listener wiring, and the browser
config-page registration.

```
lib/core.js    cadence, afplay, notifications
lib/tcc.js     TCC and SecurityAgent log streams + parsers
lib/index.js   Cordis Host plugin
lib/client.js  Plugins-page config form
locale/        display metadata (zh/en)
icon.svg       plugin icon
test/          Node test runner suites
```

## License

MIT — see [LICENSE](LICENSE).
