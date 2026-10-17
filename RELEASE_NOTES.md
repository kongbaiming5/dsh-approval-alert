# v0.2.0 · 插件页开关与中文配置表单

`dsh-approval-alert` 现在是一个标准 DSH bundle，会出现在侧边栏 **插件 → 已安装插件**，带开关和中文配置表单。

## 新增

- **插件页可见**：卡片名称「授权提醒」，带图标和中文描述。
- **开关**：卡片开关控制整个 bundle；`approval-alert` 行也有独立开关。
- **中文配置表单**：提示音、音量、每次响几声、DSH 审批、Agent 提问、macOS 权限弹窗、系统弹窗安全上限、通知、通知语言、诊断日志；保存后立即生效。
- **显示元数据**：`locale/zh.json`、`locale/en.json` 和原创 `icon.svg`。
- **配置热更新**：所有 Config 字段改为 `volatile`，表单保存不需要重启插件。
- **测试**：新增浏览器配置页注册测试，共 18 个用例通过。

## 保留

- 第一次提醒立即响，之后 25 / 20 / 15 / 10 秒，第六次起每 5 秒一次。
- 覆盖 DSH 工具审批、Agent 提问/计划审阅，以及 DSH 触发的 macOS TCC 权限弹窗。
- 声音用 `afplay`，跟随系统输出音量；默认 Glass 双响。
- macOS 权限弹窗通过 `log stream` + `AUTHREQ_PROMPTING` / `AUTHREQ_RESULT` 检测，不需要 Accessibility 权限。

## 升级注意

- 以前用手动 `insert` 条目安装的用户，请删除 `cordis.patch.yml` 里的旧条目；bundle 会提供同名行，保留旧条目会重复挂载。
- 安装/启用 bundle 后，建议重启一次 DeepSeek Harness，让 `dsh.profile.bundles` 的变更生效。
- 安装脚本 `scripts/install.sh` 会自动把包加入 `dsh.profile.bundles`，并提示清理旧条目。

## 安装

```bash
git clone https://github.com/kongbaiming5/dsh-approval-alert.git
cd dsh-approval-alert
./scripts/install.sh desktop
```

然后打开侧边栏 **插件**，在「已安装插件」里找到「授权提醒」。

## 验证

- 在配置表单里打开「启用授权提醒」并保存。
- 触发 DSH 审批或 macOS 权限弹窗：第一声应立即响。
- 麦克风弹窗复测：

```bash
tccutil reset Microphone com.deepseek.dsh
ffmpeg -f avfoundation -i ":0" -t 0.5 -y /tmp/dsh-mic-test.wav
```

- 测试：`npm test`（18 个用例）。
