# dsh-approval-alert

[English](README.md) | 中文

当 DeepSeek Harness 需要你「授权」时，用 macOS 自带系统声音提醒你。

[![test](https://github.com/kongbaiming5/dsh-approval-alert/actions/workflows/test.yml/badge.svg)](https://github.com/kongbaiming5/dsh-approval-alert/actions/workflows/test.yml)
[![license](https://img.shields.io/github/license/kongbaiming5/dsh-approval-alert)](LICENSE)

## 覆盖范围

| 来源 | 事件 | 例子 |
|---|---|---|
| DSH 工具审批 | `approval/request` | 沙箱升级、危险命令、写工作区外文件 |
| DSH Agent 提问 | `user-questions/request` | `ask_user_question`、计划审阅 `exit_plan_mode` |
| macOS 系统权限弹窗 | 统一日志 `AUTHREQ_PROMPTING` | 麦克风、摄像头、屏幕录制、辅助功能、自动化、文件与文件夹、完全磁盘访问 |

macOS 权限弹窗只处理 TCC identity 为 `com.deepseek.dsh` / `DeepSeek Harness`
的请求，其他 App 的权限弹窗不会触发。插件读取的是系统统一日志，
**不需要辅助功能（Accessibility）或自动化（Automation）权限**。

## 提醒节奏

第一次在需要授权的瞬间立即响，之后：

| 第几次 | 距上一次 |
|---|---|
| 第 1 次 | 立即（0 秒） |
| 第 2 次 | 25 秒后 |
| 第 3 次 | 20 秒后 |
| 第 4 次 | 15 秒后 |
| 第 5 次 | 10 秒后 |
| 第 6 次及以后 | 每次 5 秒后 |

- 每次提醒默认双响（间隔 0.38 秒，`burst` 可调）。
- 你点允许/拒绝、回答问题，或系统弹窗返回结果后，立即停止。
- 多个请求共用一条节奏，全部处理完才停。
- 第 6 次之后没有次数上限；macOS 权限弹窗另有 `systemPromptTimeoutMs`
  安全上限（默认 10 分钟），防止日志漏掉结果时无限响。

## 环境要求

- macOS 13 或更新版本（在 macOS 26 / Apple Silicon 上实测）。
- 带 profile 插件机制的 DeepSeek Harness（在 `0.2.1-rc.2` 上实测）。
- Node.js 20+ 仅用于跑测试；DSH 运行时自带 Node。

## 安装

### 一条命令（克隆后）

```bash
git clone https://github.com/kongbaiming5/dsh-approval-alert.git
cd dsh-approval-alert
./scripts/install.sh desktop
```

脚本会：

1. 找到 `dsh` CLI（`$DSH_BIN`、`PATH` 或 macOS App 包内路径）；
2. 把当前目录作为本地包加入 `$DSH_HOME/profiles/<profile>/package.json`；
3. 如果 `cordis.patch.yml` 里还没有条目，追加 `approval-alert` 挂载项。

运行中的 DSH 桌面版会热加载 `cordis.patch.yml`；否则重启 App。
`DSH_HOME` 默认是 `~/.dsh`；profile 不在默认位置时自行设置。
安装到其他 profile：`./scripts/install.sh web`。

### 手动安装

```bash
export DSH_HOME="${DSH_HOME:-$HOME/.dsh}"
DSH_BIN="${DSH_BIN:-/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh}"

"$DSH_BIN" plugin --profile desktop add "file:$PWD"
```

然后把 [`cordis.patch.yml`](cordis.patch.yml) 里的条目追加到
`$DSH_HOME/profiles/desktop/cordis.patch.yml`。用 `file:` 安装时指向当前克隆目录，
不要移动该目录。

> DSH 插件管理器可能提示
> `dsh-approval-alert declares no dsh.bundle — installed as a plain dependency`。
> 这是这种手动 profile 层安装的正常提示；真正挂载插件的是 `cordis.patch.yml`
> 里的条目。

## 验证

### 只验证声音链路

把 profile 条目里的 `startupChime` 临时设为 `true` 并保存：应听到两声 Glass，
并收到一条测试通知。确认后改回 `false`。

### 验证 macOS 权限弹窗（麦克风）

DSH 之前可能已经对麦克风做过选择。重新触发弹窗：

```bash
tccutil reset Microphone com.deepseek.dsh
ffmpeg -f avfoundation -i ":0" -t 0.5 -y /tmp/dsh-mic-test.wav
```

系统弹出「DeepSeek Harness 想访问麦克风」的同时，插件应立即响第一声；
点允许/拒绝后停止。这个命令只重置 DSH 的麦克风授权状态，不影响其他 App，
你仍然可以按自己的意愿重新选择。

### 验证 DSH 工具审批

把会话权限策略切到 `ask`，让 Agent 申请更宽的沙箱权限。提示出现时立即响第一声，
点允许/拒绝后停止。

## 配置

编辑 `$DSH_HOME/profiles/<profile>/cordis.patch.yml` 里的 `approval-alert` 条目：

```yaml
- insert:
    - id: approval-alert
      name: dsh-approval-alert
      config:
        enabled: true
        sound: Glass               # 系统音效名，或绝对音频路径
        volume: 1                  # afplay 倍率；1 = 当前输出音量
        burst: 2                   # 每次提醒响几声
        alertOnApproval: true      # DSH 工具审批
        alertOnQuestions: true     # DSH Agent 提问 / 计划审阅
        watchSystemPrompts: true   # macOS 系统权限弹窗
        systemPromptTimeoutMs: 600000  # 系统弹窗最长提醒时长（10 分钟）
        notify: true               # 系统通知
        startupChime: false        # 自检开关
        locale: zh                 # 通知语言：zh | en
        traceFile: ""              # 例如 /tmp/dsh-approval-alert.log
```

| 配置 | 默认 | 说明 |
|---|---|---|
| `enabled` | `true` | 总开关 |
| `sound` | `Glass` | `/System/Library/Sounds` 里的音效名，或绝对路径 |
| `volume` | `1` | `afplay -v` 倍率；1 表示跟随系统输出音量 |
| `burst` | `2` | 每次提醒响几声 |
| `alertOnApproval` | `true` | DSH 工具审批 |
| `alertOnQuestions` | `true` | DSH 提问 / 计划审阅 |
| `watchSystemPrompts` | `true` | 监听 macOS TCC 权限弹窗 |
| `systemPromptTimeoutMs` | `600000` | 系统弹窗没有结果时的安全停止时间 |
| `notify` | `true` | 每个请求第一次提醒时弹通知 |
| `startupChime` | `false` | 挂载时播放测试音 + 通知 |
| `locale` | `zh` | 通知语言（`zh` / `en`） |
| `traceFile` | `""` | 把触发/计时诊断写到本地文件 |

可选音效：`Basso`、`Blow`、`Bottle`、`Frog`、`Funk`、`Glass`、`Hero`、
`Morse`、`Ping`、`Pop`、`Purr`、`Sosumi`、`Submarine`、`Tink`。

## 工作原理

- **DSH 审批 / 提问**：在 `approval/request` 和 `user-questions/request`
  两个 Cordis waterfall 上注册前置监听器；开始提醒后调用 `next()`，
  不改变原来的审批/回答链路。
- **macOS TCC 弹窗**：后台运行一条只过滤 `com.apple.TCC` 的 `log stream`。
  匹配到 `AUTHREQ_PROMPTING` + `com.deepseek.dsh` 就开始提醒；
  匹配到对应的 `AUTHREQ_RESULT` 就停止。日志流退出时会自动重启。
- **节奏与声音**：`lib/core.js` 负责 0/25/20/15/10/5 秒节奏、并发去重、
  `/usr/bin/afplay` 播放、通知和资源清理。
- **无网络、无凭据**：只调用 `afplay`、`log`，通知回退时用 `osascript`。

## 排查

| 现象 | 检查 |
|---|---|
| 完全没声音 | `afplay /System/Library/Sounds/Glass.aiff`；检查系统音量/静音；`enabled`；设置 `traceFile` 看 `play` 行 |
| 响得太早/太晚 | 节奏固定为 0/25/20/15/10/5 秒；`burst` 只影响每次响几声 |
| macOS 弹窗不触发 | `log show --last 1m --predicate 'subsystem == "com.apple.TCC"'` 看有没有 `AUTHREQ_PROMPTING` 和 `com.deepseek.dsh`；检查 `watchSystemPrompts` 与 trace |
| 一直响不停 | TCC 结果可能漏了；看 trace 里有没有 `tcc result`；`systemPromptTimeoutMs` 是安全上限 |
| 通知显示「脚本编辑器」 | 当前 Host 拿不到 Electron Notification API，回退到 `osascript`；不需要就把 `notify` 设为 `false` |
| 插件没挂载 | 检查 `$DSH_HOME/profiles/<profile>/package.json` 依赖和 `cordis.patch.yml` 条目；保存 patch 触发热加载 |
| 重复响 | 确认只挂载了一个 `approval-alert` 条目、包只安装了一次 |

## 安全与隐私

- 不发起网络请求，不读取凭据，不做遥测。
- TCC watcher 只读 `com.apple.TCC` 的 prompt/result 行，并过滤为 DSH 的
  bundle identity；其他 App 的权限弹窗会被忽略。
- `traceFile` 只写本地事件名、服务名、PID 和计时；不调试时留空。
- 安装脚本只修改选定的 DSH profile，不改 App 包和系统设置。
- 文档里的 `tccutil reset` 是显式、可选的重新测试权限弹窗的方法。

## 开发与测试

```bash
npm test
# 或：
node --test test/core.test.mjs test/index.test.mjs test/tcc.test.mjs
```

测试无需安装依赖；使用假时钟、假进程和真实 TCC 日志行做解析样本。
手动运行时可以设置 `DSH_APPROVAL_ALERT_NO_SOUND=1` 静音。

```
lib/core.js   节奏、afplay、通知
lib/tcc.js    TCC 日志流与解析
lib/index.js  Cordis 插件接线
test/         Node 内置 test runner 用例
```

## License

MIT，见 [LICENSE](LICENSE)。
