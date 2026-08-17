# Log - 2026-08-17 AI 总结列表查看总结文档（Markdown 预览）

需求：`docs/requirements/2026-08-17-ai-summary-view-markdown.md`
计划：`docs/plans/2026-08-17-ai-summary-view-markdown-plan.md`
测试：`docs/testing/2026/08-17-ai-summary-view-markdown.md`

## Summary

为 AI 总结任务列表新增"查看总结"能力：后端以 `/summary-files` 前缀静态挂载摘要根目录（`cwd/summaryDir`），新增 `GET /api/summary-tasks/:id/markdown` 读取 md、剥离 YAML frontmatter 并提取元数据（title/video_url/model/created_at），把相对图片链接统一重写为同源静态路径后返回 `{ content, meta }`；前端操作列新增"查看总结"按钮，弹窗顶部渲染元数据条，正文用 `react-markdown` 渲染完整文档（文字 + 插图，插图点击可查看大图，弹窗支持全屏）。该改动不影响 Docker 镜像打包与使用（无 Dockerfile/entrypoint/端口/环境变量变更，仅新增运行时挂载，已用镜像构建 + 容器运行级验证确认）。

## Changes

- 后端
  - 新增 `packages/server/src/analysis/summary-dir.ts`：`SUMMARY_BASE_DIR` / `SUMMARY_STATIC_PREFIX` 共享常量、`extractSummaryMeta()`（frontmatter 剥离 + 4 键元数据提取，缺失/畸形容错为空 meta）、`rewriteMarkdownImageUrls()`（仅处理 `![alt](url)`，绝对/根相对/锚点/`../` 越界原样保留，各路径段 URL 编码）。
  - `packages/server/src/main.ts`：确保摘要目录存在后以 `/summary-files` 前缀挂载，并记录启动日志。
  - `packages/server/src/analysis/analysis-trigger.service.ts`：`resolveSummaryDir` 改用共享根常量，消除重复推导。
  - `packages/server/src/analysis/analysis-task.controller.ts`：新增 `GET /summary-tasks/:id/markdown`（400/404/409/409/404 契约，返回 `{ content, meta }`）。

- 前端
  - 新增依赖 `react-markdown`、`remark-gfm`。
  - `packages/frontend/vite.config.ts`：dev 代理增 `/summary-files`。
  - `packages/frontend/src/api/index.ts`：新增 `getAiSummaryTaskMarkdown()` 与 `SummaryMarkdownMeta` 类型。
  - `packages/frontend/src/pages/AiSummaryTasks.tsx`：操作列新增"查看总结"按钮（仅 `completed` 可用）；弹窗顶部渲染元数据条（B站原视频/模型/生成时间，字段缺失隐藏）；正文用 `react-markdown` 渲染，插图覆写为 antd `<Image>`（限制预览尺寸 + 点击查看大图），标题栏支持全屏/退出全屏。
  - `packages/frontend/src/assets/main.css`：新增 `.md-preview` 组件级排版样式（Tailwind `@layer components`）。

## Verification

- `pnpm typecheck`：通过（全 workspace）。
- `pnpm build`：通过（全 workspace）。
- API/静态冒烟（一次性脚本，临时目录隔离，不入库）：25 项全部通过（端点契约 400/404/409、5 类图片重写规则、frontmatter 剥离、4 键元数据提取、无 frontmatter 容错、非图片链接不受影响、非 ASCII 目录 URL 编码、静态图片可访问、文件缺失 404）。
- Docker：`pnpm docker:build` 通过；镜像运行级冒烟 6 项全部通过（容器内 markdown 端点返回重写内容与空 meta 容错、容器内 `/summary-files` 静态图片 200、容器内前端 `/` 200）。

## Notes

- 前端引入 meta 渲染后，此前"不剥离 frontmatter"的临时决策已按用户确认方向替换为"服务端剥离 + 前端仅渲染 meta"（需求/测试/计划已同步）。
- 摘要目录位于容器内部文件系统（`/app/summaryDir`），未挂载到 `OUTPUT_DIR`（`/download`）卷，容器重建会丢失总结文档与截图——此为既有行为，本需求不改变，仅提示知晓。
- 磁盘上的 md 文件保持原样（含 frontmatter 与相对路径），剥离/重写仅发生在接口返回层。