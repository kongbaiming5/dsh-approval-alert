#!/usr/bin/env bash
# Install dsh-approval-alert into a DeepSeek Harness profile.
#
# Usage:
#   ./scripts/install.sh [profile]     # default profile: desktop
#
# Environment:
#   DSH_HOME  default: ~/.dsh
#   DSH_BIN   path to the dsh CLI (auto-detected when omitted)
#
# The script is idempotent: it adds the local package to the profile and appends
# the loader entry only when an entry for dsh-approval-alert is not present.

set -euo pipefail

PROFILE="${1:-desktop}"
if [[ ! "$PROFILE" =~ ^[A-Za-z0-9._-]+$ ]]; then
  echo "error: invalid profile name: $PROFILE" >&2
  exit 1
fi

REPO_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
DSH_HOME="${DSH_HOME:-$HOME/.dsh}"
PATCH_DIR="$DSH_HOME/profiles/$PROFILE"
PATCH_FILE="$PATCH_DIR/cordis.patch.yml"

if [[ -z "${DSH_BIN:-}" ]]; then
  if command -v dsh >/dev/null 2>&1; then
    DSH_BIN="$(command -v dsh)"
  elif [[ -x "/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh" ]]; then
    DSH_BIN="/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh"
  elif [[ -x "$HOME/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh" ]]; then
    DSH_BIN="$HOME/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh"
  else
    echo "error: dsh CLI not found." >&2
    echo "Set DSH_BIN to the DeepSeek Harness CLI path and retry." >&2
    exit 1
  fi
fi

if [[ ! -x "$DSH_BIN" ]]; then
  echo "error: DSH_BIN is not executable: $DSH_BIN" >&2
  exit 1
fi

echo "==> Installing dsh-approval-alert"
echo "    repository: $REPO_DIR"
echo "    profile:    $PROFILE"
echo "    DSH_HOME:   $DSH_HOME"

mkdir -p "$PATCH_DIR"

echo "==> Adding the local package to the profile"
"$DSH_BIN" plugin --profile "$PROFILE" add "file:$REPO_DIR"

touch "$PATCH_FILE"
if grep -q 'name: dsh-approval-alert' "$PATCH_FILE"; then
  echo "==> Loader entry already present; leaving the config untouched"
else
  echo "==> Appending the loader entry to $PATCH_FILE"
  # A brand-new patch file may contain the empty-list root `[]`; remove it so
  # the appended insert remains a valid single-root YAML document.
  if grep -Eq '^[[:space:]]*\[[[:space:]]*\][[:space:]]*$' "$PATCH_FILE"; then
    sed -i '' '/^[[:space:]]*\[[[:space:]]*\][[:space:]]*$/d' "$PATCH_FILE"
  fi
  printf '\n' >> "$PATCH_FILE"
  cat "$REPO_DIR/cordis.patch.yml" >> "$PATCH_FILE"
fi

cat <<EOF

==> Done
    If DeepSeek Harness is running, saving the patch hot-reloads it.
    Otherwise start the app.

    To verify the audio path, set startupChime: true in
    $PATCH_FILE, save, and listen for two Glass chimes.

    To verify a macOS permission prompt:
      tccutil reset Microphone com.deepseek.dsh
      ffmpeg -f avfoundation -i ":0" -t 0.5 -y /tmp/dsh-mic-test.wav
    (This resets only DSH's microphone decision; you can allow or deny again.)

    Trace file for debugging: set traceFile to /tmp/dsh-approval-alert.log
EOF
