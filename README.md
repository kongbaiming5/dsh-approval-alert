# 授权提醒 · dsh-approval-alert

中文 | [English](README.en.md)

一个 **DeepSeek Harness** 插件：当 DSH 卡在「需要你授权」时，用 macOS 自带系统提示音提醒你。

[![test](https://github.com/kongbaiming5/dsh-approval-alert/actions/workflows/test.yml/badge.svg)](https://github.com/kongbaiming5/dsh-approval-alert/actions/workflows/test.yml)
[![license](https://img.shields.io/github/license/kongbaiming5/dsh-approval-alert)](LICENSE)

## 覆盖范围

| 来源 | 例子 |
|---|---|
| DSH 工具审批 | 沙箱升级、危险命令、写工作区外文件 |
| DSH Agent 提问 | `ask_user_question`、计划审阅 `exit_plan_mode` |
| macOS 系统权限弹窗 | 麦克风、摄像头、屏幕录制、辅助功能、自动化、文件与文件夹、完全磁盘访问 |

macOS 权限弹窗只处理 TCC identity 为 `com.deepseek.dsh` / `DeepSeek Harness` 的请求，其他 App 的权限弹窗不会触发。

## 在 DSH 里怎么找到它

安装并启用 bundle 后：

1. 打开侧边栏 **插件**；
2. 在 **已安装插件** 里找到卡片 **「授权提醒」**（包名 `dsh-approval-alert`）；
3. 卡片右侧开关控制整个 bundle；点进卡片，里面的 `approval-alert` 行也有自己的开关；
4. 点行标题/配置按钮，打开 **中文配置表单**，保存后立即生效。

插件在 DSH 的 **设置 → 内置插件 → 插件列表** 里也会显示为 `approval-alert`，但那只是只读的运行状态；日常配置请用侧边栏「插件」里的表单。

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

- 每次提醒默认双响（间隔 0.38 秒），可在表单里调「每次响几声」。
- 你点允许/拒绝、回答问题，或系统弹窗返回结果后，立即停止。
- 多个请求共用一条节奏，全部处理完才停。
- macOS 权限弹窗另有 `systemPromptTimeoutMs` 安全上限（默认 10 分钟），防止日志漏掉结果时无限响。

## 安装

### 一键安装（从 GitHub 克隆）

```bash
git clone https://github.com/kongbaiming5/dsh-approval-alert.git
cd dsh-approval-alert
./scripts/install.sh desktop
```

脚本会：

1. 找到 `dsh` CLI（`$DSH_BIN`、`PATH` 或 macOS App 包内路径）；
2. 把当前目录作为本地包加入 `$DSH_HOME/profiles/<profile>/package.json`；
3. 把 `dsh-approval-alert` 加入 `dsh.profile.bundles`，让侧边栏「插件」识别它；
4. 如果检测到旧的「手动 insert」条目，会提示你删除，避免重复挂载。

**如果 DSH 正在运行，bundle 列表变更通常需要重启一次 App**；重启后即可在侧边栏「插件」看到「授权提醒」。

### 通过插件页安装

侧边栏 **插件 → 添加插件 → 安装第三方插件**，填入本仓库的本地绝对路径，安装完成后启用 bundle。配置表单同样会出现在「授权提醒」的详情页。

### 环境要求

- macOS 13 或更新版本（在 macOS 26 / Apple Silicon 上实测）。
- 带 profile 插件机制的 DeepSeek Harness（在 `0.2.1-rc.2` 上实测）。
- Node.js 20+ 仅用于跑测试；DSH 运行时自带 Node。

## 插件市场

本插件已向 [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) 提交收录，合并后会出现在 DSH 社区插件市场（侧边栏 **插件 → Discover** / 插件市场）里，可搜索 **「授权提醒」** 或 `dsh-approval-alert`。

也可以直接从 GitHub 安装：

```bash
dsh plugin --profile desktop add github:kongbaiming5/dsh-approval-alert
```

> 市场目录由人工审核，PR 合并后通常一天内生效。没有 npm 包也能安装；v0.2.1 的 GitHub Release 附带预构建 tarball，市场会优先用它，跳过源码构建。

## 配置表单

在「授权提醒」的配置页里可以改：

| 配置 | 默认 | 说明 |
|---|---|---|
| 启用授权提醒 | 开 | 总开关；关闭后所有来源都不响 |
| 提示音 | `Glass` | macOS 系统音效名，或绝对音频路径 |
| 音量倍率 | `1` | `afplay -v` 倍率；1 = 跟随当前系统输出音量 |
| 每次响几声 | `2` | 每次提醒双响；1–4 |
| 同时弹一条系统通知 | 开 | 首次提醒时弹通知 |
| DSH 工具审批 | 开 | 审批请求 |
| Agent 提问 / 计划审阅 | 开 | `ask_user_question`、`exit_plan_mode` |
| macOS 系统权限弹窗 | 开 | DSH 触发的 TCC 弹窗 |
| 系统弹窗安全上限 | `600000` | 毫秒；0 表示不自动停止 |
| 通知语言 | `zh` | 中文 / English |
| 诊断日志文件 | 空 | 例如 `/tmp/dsh-approval-alert.log` |

保存通过 DSH 的插件配置机制写入 profile patch，不需要手动编辑 YAML。高级用户仍然可以直接编辑 `$DSH_HOME/profiles/<profile>/cordis.patch.yml` 里的 `approval-alert` 配置覆盖。

## 验证

### 声音链路

在配置表单里确认「启用授权提醒」为开，保存；触发一个 DSH 审批或系统权限弹窗。第一次应立即响，之后按 25/20/15/10/5 秒节奏重复。

### macOS 权限弹窗（麦克风）

```bash
tccutil reset Microphone com.deepseek.dsh
ffmpeg -f avfoundation -i ":0" -t 0.5 -y /tmp/dsh-mic-test.wav
```

系统弹出「DeepSeek Harness 想访问麦克风」的同时，插件应立即响第一声；点允许/拒绝后停止。这个命令只重置 DSH 的麦克风授权状态，不影响其他 App。

### DSH 工具审批

把会话权限策略切到 `ask`，让 Agent 申请更宽的沙箱权限。提示出现时立即响，点允许/拒绝后停止。

## 工作原理

- **DSH 审批 / 提问**：在 `approval/request` 和 `user-questions/request` 两个 Cordis waterfall 上注册前置监听器；开始提醒后调用 `next()`，不改变原来的审批/回答链路。
- **macOS TCC 弹窗**：后台运行一条只过滤 `com.apple.TCC` 的 `log stream`。匹配到 `AUTHREQ_PROMPTING` + `com.deepseek.dsh` 就开始提醒；匹配到对应的 `AUTHREQ_RESULT` 就停止。日志流退出时会自动重启。
- **配置热更新**：所有配置字段都是 `volatile`，表单保存后 Host 直接读取新值，不需要重启插件。
- **无网络、无凭据**：只调用 `afplay`、`log`，通知回退时用 `osascript`。

## 通知说明

首次提醒时会尝试弹一条系统通知。通知优先使用 Electron 原生通知；当前 desktop Host 是纯 Node 进程，拿不到 Electron API，因此会退化为 `osascript display notification`，通知来源可能显示为「脚本编辑器 / Script Editor」。不需要通知就在表单里关掉，声音不受影响。

## 排查

| 现象 | 检查 |
|---|---|
| 插件页没有「授权提醒」 | 确认 `dsh.profile.bundles` 包含 `dsh-approval-alert`；重启一次 App；检查 profile 里是否还留着旧的「手动 insert」 |
| 有卡片但配置页打不开 | 确认 bundle 行 `approval-alert` 是开启状态；重新打开插件页 |
| 完全没声音 | `afplay /System/Library/Sounds/Glass.aiff`；检查系统音量/静音；确认「启用授权提醒」和对应来源开关 |
| macOS 弹窗不触发 | `log show --last 1m --predicate 'subsystem == "com.apple.TCC"'` 看有没有 `AUTHREQ_PROMPTING` 和 `com.deepseek.dsh`；打开诊断日志看 `tcc prompt` |
| 一直响不停 | TCC 结果可能漏了；看诊断日志里有没有 `tcc result`；调小「系统弹窗安全上限」 |
| 通知显示「脚本编辑器」 | 当前 Host 的回退行为；关掉通知即可 |

## 安全与隐私

- 不发起网络请求，不读取凭据，不做遥测。
- TCC watcher 只读 `com.apple.TCC` 的 prompt/result 行，并过滤为 DSH 的 bundle identity；其他 App 的权限弹窗会被忽略。
- 诊断日志只写本地事件名、服务名、PID 和计时；不调试时留空。
- 安装脚本只修改选定的 DSH profile，不改 App 包和系统设置。
- 文档里的 `tccutil reset` 是显式、可选的重新测试权限弹窗的方法。

## 开发与测试

```bash
npm test
# 或：
node --test test/core.test.mjs test/index.test.mjs test/tcc.test.mjs test/client.test.mjs
```

测试不需要安装依赖；使用假时钟、假进程、真实 TCC 日志行和假的模块加载器。18 个用例覆盖提醒节奏、TCC 解析、监听器接入和浏览器配置页注册。

```
lib/core.js    节奏、afplay、通知
lib/tcc.js     TCC 日志流与解析
lib/index.js   Cordis Host 插件
lib/client.js  插件页中文配置表单
locale/        中文/英文显示名与描述
icon.svg       插件图标
test/          Node 内置 test runner 用例
```

## License

MIT，见 [LICENSE](LICENSE)。
