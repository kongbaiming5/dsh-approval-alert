# v0.1.0

First public release of **dsh-approval-alert** — a macOS approval chime for DeepSeek Harness.

## Highlights

- **DSH tool approvals** (`approval/request`): sandbox escalation, destructive commands,
  writes outside the workspace.
- **DSH agent questions and plan review** (`user-questions/request`).
- **macOS TCC permission prompts** triggered by DeepSeek Harness: microphone, camera,
  screen recording, accessibility, automation, files and folders, Full Disk Access.
  Detected through the unified log (`log stream` + `AUTHREQ_PROMPTING`), so **no
  Accessibility or Automation grant is required**.
- **Reminder cadence**: first chime immediately, then 25s, 20s, 15s, 10s, and every 5s
  after that, until the request is answered.
- Plays a real macOS system sound with `afplay`, at the current output volume
  (default: Glass, double chime).
- Best-effort system notification (Electron native when available, `osascript` otherwise).
- Configurable via the profile patch: sound, volume, burst, per-source toggles,
  notification, locale, and a local trace file.
- No network access, no credentials, no third-party runtime dependencies.

## Install

```bash
git clone https://github.com/kongbaiming5/dsh-approval-alert.git
cd dsh-approval-alert
./scripts/install.sh desktop
```

The script adds the local package to the DSH profile and appends the loader entry if it
is missing. A running DSH desktop app hot-reloads `cordis.patch.yml`; otherwise restart
the app.

## Verify

Set `startupChime: true` in the profile entry (or run the microphone test in the README)
to confirm the audio path.

## Notes

- Tested with DeepSeek Harness 0.2.1-rc.2 on macOS (Apple Silicon).
- macOS logs can change between releases; if TCC prompt detection stops working, check
  `AUTHREQ_PROMPTING` / `AUTHREQ_RESULT` in `log stream` and open an issue.
- Notifications may appear as “Script Editor” because the current Host does not expose
  Electron's Notification API; set `notify: false` if you do not want them.

**Full changelog**: initial release.
