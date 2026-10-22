# v0.3.0 · 覆盖 macOS 管理员密码弹窗

新增第四类触发来源：`SecurityAgent` 的提权密码表单（「想要进行更改」）。

之前只监听 TCC（`com.apple.TCC` / `AUTHREQ_PROMPTING`），而 `sudo`、`sfltool`、
安装器请求 `system.privilege.admin` 时弹出的是 Authorization Services 的密码框，
走 `com.apple.Authorization` 子系统，没有任何 `AUTHREQ_*` 行，所以插件完全不会响。

## 新增

- `lib/tcc.js`：抽出共用的 `log stream` 底座，新增 `createPrivilegeWatcher`、
  `parsePrivilegeLine`、`PRIVILEGE_PREDICATE`。
  - `Using modern UI` / `SC confirmation dialog detected` → 密码框出现。
  - `ExecuteWithPrivileges` 的完成记录（带 `successfulMechanism`）→ 密码框关闭。
- `lib/index.js`：两条链路共用一个系统弹窗注册表与提醒引擎；同一对话框同时命中
  TCC 与提权两条线时只响一次（2 秒去重窗口），但仍各自跟踪结束信号。
- 新配置：`watchPrivilegePrompts`（默认开）、`privilegePromptTimeoutMs`（默认
  `180000`，点取消/通过后立即停止，仅作兜底）。
- 配置表单、`cordis.patch.yml`、locale 描述同步更新。
- 测试：新增提权解析、流式监听、以及用假 `log` 脚本跑通「出现→响→完成→停」的
  端到端用例，共 25 个。

## 说明

- 只读日志，不读密码、不注入进程、不需要任何隐私授权。
- 提权弹窗无法归属到某个 App，所以不按 bundle identity 过滤；不想要就在表单里
  单独关掉「macOS 管理员密码弹窗」。

---

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
