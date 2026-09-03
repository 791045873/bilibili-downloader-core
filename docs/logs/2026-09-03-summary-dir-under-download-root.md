# 2026-09-03 摘要目录随下载目录持久化

## 背景

摘要目录原为代码常量 `resolve(cwd, "summaryDir")`：

- 本地：`packages/server/summaryDir`（cwd 派生）
- Docker：容器内 `/app/summaryDir`，未挂载到 `/download` 卷，容器重建即丢失（此前多次标注为已知缺陷）

用户要求把摘要目录放到下载根目录下作为子目录一起持久化，且目录名使用 `summary`（不沿用 `summaryDir`）。

## 改动

- `packages/server/src/analysis/summary-dir.ts`：`SUMMARY_BASE_DIR` 改为 `resolve(OUTPUT_DIR ?? join(cwd, "downloads"), "summary")`，与 `download.service.ts` 的下载根目录推导同一来源。
  - Docker（`OUTPUT_DIR=/download`）：`/download/summary`，随宿主机卷持久化。
  - 本地默认：`<server cwd>/downloads/summary`。
- `docs/design/app-overview.md`：`/summary-files` 挂载描述同步更新。
- `.dockerignore` 无需改动：`**/downloads` 已覆盖新位置。

## 存量数据决策（用户确认：忽略旧数据）

- 不做迁移。旧 `ai_summary_task.summary_output` 绝对路径保持原样：
  - 本地旧 md 文件仍在旧位置，正文可继续读取；
  - 旧文件位于新基准目录之外，`rewriteMarkdownImageUrls` 检测越界后不改写相对插图链接，旧总结前端预览的插图可能失效；
  - Docker 旧目录本随容器销毁，无额外影响。
- 命名冲突风险（低）：若用户在下载根目录自行创建名为 `summary` 的子目录存放视频，会与摘要目录重合；接受该风险。

## 验证

- `pnpm typecheck` 全 workspace 通过。
- 运行级验证（新总结落盘、静态挂载、前端插图预览）待用户部署后确认。
