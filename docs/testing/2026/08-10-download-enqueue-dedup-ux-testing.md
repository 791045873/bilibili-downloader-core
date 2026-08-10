# 2026-08-10 下载入队去重 UX 调整测试方向

> Plan: `docs/plans/2026-08-10-download-enqueue-dedup-ux-plan.md`
> Source: `docs/discussions/2026-08-10-download-file-naming.md`（决策 4）
> 本文件只描述需求级可观察状态，不包含实现细节或脚本。

## Testing Directions

### TD-UX-1：有下载记录的视频展示"已下载"标记

- 应为真：某视频在 DB 中有下载记录时，在 VideoDetail 分P列表与 ParseResultList 列表中展示"已下载"标记；且不区分记录新旧（无 24h 门控）。
- 不应为真：标记缺失；或标记按 24h 门控忽隐忽现。

### TD-UX-2：有下载记录的视频仍可再次勾选并加入队列

- 应为真：展示"已下载"的视频复选框可用，可勾选并加入下载队列，不弹任何拦截。
- 不应为真：复选框被禁用、勾选被吞掉，或加入按钮被禁用。

### TD-UX-3：加入成功后立即标记"已下载"

- 应为真：视频成功加入下载队列后，界面立即出现"已下载"标记（本地乐观标记或下次刷新生效，二选一，前后端一致）。
- 不应为真：加入后标记缺失，或要求刷新后才出现且与预期不符。

### TD-UX-4：重新下载由服务端磁盘裁决

- 应为真：文件仍在磁盘上时，重新加入的视频任务执行后命中"文件已存在, 跳过下载"（不产生新文件）；文件已被删除/挪走时，重新加入的视频任务会真正重新下载。
- 不应为真：前端拦截阻止用户触发上述流程；或服务端跳过行为与磁盘实际状态不符。

### TD-UX-5：一键 AI 总结按钮行为不变

- 应为真：一键 AI 总结按钮的可用/禁用行为与本次改动前一致（仅字段改名同步），不因"已下载"标记引入新的禁用/报错。
- 不应为真：按钮行为被本次改动意外改变或报错。

## Verification

- `pnpm --filter @bilibili-downloader/frontend typecheck` 通过。
- 代码级验证（本会话）：逐项核对两个视图的实现。

## Status

- TD-UX-1: passed（代码级：`markDownloaded` 按 DB 记录置 `downloaded=true`，角标文案改为"已下载"，无 24h 门控）
- TD-UX-2: passed（代码级：`toggleSelect` 无拦截、checkbox 无 `:disabled`、`doAddToQueue` 不过滤、`selectedCount` 统计全部选中）
- TD-UX-3: passed（代码级：两个视图加入成功后均置 `downloaded=true`）
- TD-UX-4: passed（代码级：服务端跳检逻辑未改动，沿用 `DownloadExecutionUseCase` 磁盘存在性检查；前端无拦截）
- TD-UX-5: passed（代码级：一键 AI 总结按钮条件仅字段改名 `enqueued→downloaded`，逻辑分支未变）

> 运行级说明：TD-UX-1/2/3/5 的真实浏览器交互与 TD-UX-4 的真实下载需在运行中的前端 + server 环境手动确认。本会话以代码级验证作为微计划冷回放证据，运行级确认留给用户手动执行（记录于计划 Closure 与日志）。
