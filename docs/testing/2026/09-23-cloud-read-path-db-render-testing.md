# 09-23 云端/NAS Phase 1a 总结读取侧 DB 渲染 Testing

> 需求：`docs/requirements/2026-09-17-cloud-read-path-db-render.md`
> 计划：`docs/plans/2026-09-23-cloud-read-path-db-render-plan.md`
> 定位：记录需求级观察态（应呈现什么、不应呈现什么），非测试脚本。

## 检查应覆盖的状态

### T1 DB 主路径渲染

- DB 存在 `summary`+`summary_segment` 时，即使移除本地 summary 目录，两端点仍返回 200，`content` 来自 DB。
- 正文分段按 `summary_segment.seq` 升序；每段呈现 `## 标题` + 正文。
- 有 `screenshot_url` 的段呈现图片，且图片地址为 COS 绝对 URL。
- 不应出现：frontmatter、`/summary-files/…` 链接、任何 timestamp 文本、读盘产生的本地路径。

### T2 raw_response 回退

- `completed` 但无 `summary` 行（历史/未发布）且 `raw_response` 为合法 JSON → 200 纯文本、无图。
- 不应出现：图片段、编造内容。

### T3 内容不可用（有意 409）

- `raw_response` 为空 / 非合法 JSON / `summary` 缺失或空数组 → 409"该总结内容不可用"。
- `summary` 行存在但 `summary_segment` 为空 → 200，标题 + 空正文（不报错）。

### T4 Meta 取值链

- `title` = `summary.video_title`，缺失时回退 `ai_summary_task.title`。
- `videoUrl` = `summary.video_url`，缺失时回退 `https://www.bilibili.com/video/{bvid}`。
- `model` = `summary.model_name` → `ai_summary_task.model_name` → `""`。
- `createdAt` = `ai_summary_task.last_completed_at` ?? `created_at`；不应等于 `summary.created_at`（重分析后应体现最近完成时刻）。

### T5 错误码矩阵（两端点各自，由 controller 轻量单测覆盖）

- 非法 id / 资源标识 → 400。
- `ai_summary_task` 记录不存在 → 404。
- 记录存在但非 `completed` → 409。
- 内容不可用 → 409。
- 不应再出现：因"本地文件缺失"返回的 404；因"`summary_output` 为空"返回的 409（两分支有意移除）。

### T6 不读盘

- 渲染主路径与 raw 回退路径均不调用 `readFile`、不解析 `DOWNLOAD_ROOT`（单测 fs spy 断言未被调用）。

### T7 无回归

- `/summary-files` 静态挂载仍存在（本切片保留），但两端点响应不再产生其链接。
- 前端"查看总结"整页与 QA 来源"AI 总结"入口正常渲染（正文 + COS 图片）。

### T8 summary/raw 漂移

- `summary` 与 `raw_response` 同时存在且不一致时，展示内容以 `summary` 为准。
- 系统记录一条非阻塞 warn（含 `bvid/cid`）；不因漂移报错或阻塞响应。

## 验证命令

- `pnpm --filter @bilibili-downloader/server test`（测试容器，`TEST_DATABASE_URL`）
- `pnpm typecheck`
- `pnpm build`

## 结论

- 状态：待实施后回填每条方向的通过/裁决结论。
