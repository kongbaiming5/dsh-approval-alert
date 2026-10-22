# v0.2.2 · 修复 web profile 启动，补齐插件市场徽章

本版修复了 dsh.so 安装验证中暴露的 **L5 Web 冒烟失败**，并补上 dsh.so 作者徽章。

## 修复

- 移除 `dsh.client.inject` 对 `@deepseek-ai/dsh-client-ui-plugin-manager` 的硬依赖。
  该包不在最小 `web` profile 中，之前的声明会让 `dsh plugin --profile web add ...`
  的 Web 启动在「插件目录树加载」阶段失败。
- 客户端配置表单仍然注册在 `plugins.row.config`；在带插件管理器的 desktop profile 中正常显示，
  在最小 web profile 中只是不显示配置入口，不影响启动。
- 新增一条 CI 用例，防止 `dsh.client.inject` 再次引入不在 web profile 的 UI 包。

## 插件市场

- **dsh.so 插件市场**：已收录；本版 README 加入官方作者徽章：
  `[![dsh.so risk](https://www.dsh.so/badge/dsh-approval-alert.svg)](https://www.dsh.so/artifact/dsh-approval-alert/)`
- **DSH 社区插件目录**：已向 awesome-dsh-plugin 提交 PR，分类 `notify`；
  本版 tarball 作为市场预构建附件。
- dsh.so 会重新扫描 v0.2.2；L5 Web 冒烟应在该版本通过。

## 功能回顾

- 标准 DSH bundle：侧边栏 **插件 → 已安装插件** 显示「授权提醒」卡片、开关和中文配置表单。
- 覆盖 DSH 工具审批、Agent 提问/计划审阅、macOS TCC 权限弹窗（`log stream` + `AUTHREQ_PROMPTING`）。
- 提醒节奏：第一次立即响，之后 25 / 20 / 15 / 10 秒，第六次起每 5 秒一次。
- 声音用 `afplay`，跟随系统输出音量；默认 Glass 双响。

## 安装

```bash
git clone https://github.com/kongbaiming5/dsh-approval-alert.git
cd dsh-approval-alert
./scripts/install.sh desktop
```

或从 GitHub 直接安装：

```bash
dsh plugin --profile desktop add github:kongbaiming5/dsh-approval-alert
```

## Tarball 校验

```text
dsh-approval-alert-0.2.2.tgz
SHA-256: db3ce45bf41f3c079c16a022c5d9a593253ad377557a17ae2051f9d9c7584dbf
```

## 验证

- `npm test`：19 个用例通过。
- 本机已验证 Host watcher（`log stream`）运行、声音正常。
