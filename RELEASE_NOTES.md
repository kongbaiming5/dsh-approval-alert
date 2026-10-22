# v0.2.1 · 插件市场上架

本版把 `dsh-approval-alert` 提交到 DSH 社区插件市场目录（awesome-dsh-plugin），并提供 GitHub Release 预构建 tarball，市场安装时可跳过源码构建。

## 新增

- **插件市场收录**：向 [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) 提交条目，分类 `notify`；合并后可在 DSH 插件市场搜索「授权提醒」或 `dsh-approval-alert`。
- **预构建 tarball**：`dsh-approval-alert-0.2.1.tgz` 作为 GitHub Release 附件，供市场优先安装。
- **README 市场安装说明**：支持 `dsh plugin --profile desktop add github:kongbaiming5/dsh-approval-alert`。

## v0.2.0 功能回顾

- 标准 DSH bundle：侧边栏 **插件 → 已安装插件** 显示「授权提醒」卡片、开关和中文配置表单。
- 覆盖 DSH 工具审批、Agent 提问/计划审阅、macOS TCC 权限弹窗（`log stream` + `AUTHREQ_PROMPTING`）。
- 提醒节奏：第一次立即响，之后 25 / 20 / 15 / 10 秒，第六次起每 5 秒一次。
- 声音用 `afplay`，跟随系统输出音量；默认 Glass 双响。
- 配置表单保存后立即生效（volatile Config）。

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
dsh-approval-alert-0.2.1.tgz
SHA-256: 05734382a64b9881b82b8406312e568276edf9ed947e96572dc209633c48f5ea
```

## 验证

- `npm test`：18 个用例通过。
- 本机已验证 Host watcher（`log stream`）运行、声音正常。
