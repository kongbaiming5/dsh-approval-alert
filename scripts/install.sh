#!/usr/bin/env bash
# 把 dsh-approval-alert 作为 bundle 安装到 DeepSeek Harness profile。
#
# 用法：
#   ./scripts/install.sh [profile]     # 默认 profile：desktop
#
# 环境变量：
#   DSH_HOME  默认 ~/.dsh
#   DSH_BIN   dsh CLI 路径（不填时自动查找）
#
# 安装后，侧边栏「插件」会出现「授权提醒」卡片，带开关和中文配置表单。
# 如果 DSH 正在运行，bundle 列表的变更可能需要重启一次 App 才生效。

set -euo pipefail

PROFILE="${1:-desktop}"
if [[ ! "$PROFILE" =~ ^[A-Za-z0-9._-]+$ ]]; then
  echo "错误：profile 名称不合法：$PROFILE" >&2
  exit 1
fi

REPO_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
DSH_HOME="${DSH_HOME:-$HOME/.dsh}"
PROFILE_DIR="$DSH_HOME/profiles/$PROFILE"
MANIFEST="$PROFILE_DIR/package.json"
PATCH_FILE="$PROFILE_DIR/cordis.patch.yml"
PACKAGE_NAME="dsh-approval-alert"

if [[ -z "${DSH_BIN:-}" ]]; then
  if command -v dsh >/dev/null 2>&1; then
    DSH_BIN="$(command -v dsh)"
  elif [[ -x "/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh" ]]; then
    DSH_BIN="/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh"
  elif [[ -x "$HOME/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh" ]]; then
    DSH_BIN="$HOME/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh"
  else
    echo "错误：找不到 dsh CLI。" >&2
    echo "请设置 DSH_BIN 指向 DeepSeek Harness 的 CLI 路径后重试。" >&2
    exit 1
  fi
fi

if [[ ! -x "$DSH_BIN" ]]; then
  echo "错误：DSH_BIN 不可执行：$DSH_BIN" >&2
  exit 1
fi

echo "==> 安装 dsh-approval-alert"
echo "    源码：  $REPO_DIR"
echo "    profile：$PROFILE"
echo "    DSH_HOME：$DSH_HOME"

mkdir -p "$PROFILE_DIR"

echo "==> 把本地包加入 profile"
"$DSH_BIN" plugin --profile "$PROFILE" add "file:$REPO_DIR"

echo "==> 选中 bundle"
if [[ ! -f "$MANIFEST" ]]; then
  echo "错误：profile 清单不存在：$MANIFEST" >&2
  exit 1
fi
python3 - "$MANIFEST" "$PACKAGE_NAME" <<'PY'
import json
import sys

path, name = sys.argv[1], sys.argv[2]
with open(path, encoding="utf-8") as handle:
    data = json.load(handle)

dsh = data.setdefault("dsh", {})
profile = dsh.setdefault("profile", {})
bundles = profile.setdefault("bundles", [])
if name not in bundles:
    bundles.append(name)
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(data, handle, ensure_ascii=False, indent=2)
        handle.write("\n")
    print(f"    已加入 dsh.profile.bundles: {name}")
else:
    print(f"    dsh.profile.bundles 已包含: {name}")
PY

if [[ -f "$PATCH_FILE" ]] && grep -q 'name: dsh-approval-alert' "$PATCH_FILE"; then
  cat >&2 <<'EOF'
警告：检测到 profile 的 cordis.patch.yml 里还有旧的「手动 insert」条目。
      现在插件由 bundle 提供，请删除这段旧条目，否则会重复挂载：
        - insert:
            - id: approval-alert
              name: dsh-approval-alert
      只保留 bundle，不要保留手动 insert。
EOF
fi

cat <<EOF

==> 完成
    重启 DeepSeek Harness 后，侧边栏「插件」→「已安装插件」会出现
    「授权提醒」卡片，点进去可以开关和配置：
      提示音、音量、每次响几声、DSH 审批、Agent 提问、
      macOS 权限弹窗、系统弹窗安全上限、通知和诊断日志。

    如果 App 正在运行且没有立即出现，重启一次即可。

    验证声音：
      1. 在「授权提醒」配置里打开「启用授权提醒」并保存；
      2. 触发一个 DSH 审批或 macOS 权限弹窗；
      3. 第一次应立即响，之后按 25/20/15/10/5 秒节奏重复。

    验证 macOS 权限弹窗（麦克风）：
      tccutil reset Microphone com.deepseek.dsh
      ffmpeg -f avfoundation -i ":0" -t 0.5 -y /tmp/dsh-mic-test.wav
EOF
