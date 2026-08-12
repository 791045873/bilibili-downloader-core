# App Overview

## Purpose

Describe the current supported app-level baseline for `bilibili-downloader-core`.

## Main Surfaces

| Surface | Description | Runtime |
| --- | --- | --- |
| Web Frontend | 视频链接输入、Section 选择器、视频解析、下载列表查看、AI 总结任务列表、设置管理 | Vue 3 SPA（浏览器） |
| Docker | 容器化部署，Server + Frontend 打包为单镜像，通过挂载 volume 管理下载文件 | Docker 容器 |

## Primary Navigation Model

- Web 前端：单页应用（SPA），使用 vue-router 管理页面路由

## Main User Roles

- 无角色区分（当前为单用户工具，无登录/权限系统）

## Core Workflows

### 单视频下载（Web）

1. 用户在输入区域粘贴 B站视频链接（BV/AV/URL）
2. 跳转到视频解析页面，通过 Section 选择器胶囊按钮切换合集/分P
3. 点击"解析当前页所有视频"一键解析当前 section 内所有视频的清晰度和编码
4. 选择视频清晰度和编码，勾选分P
5. 点击"加入下载队列"，弹出下载子目录确认/修改弹框，确认后加入下载队列，停留在当前页面不跳转
6. 下载任务在队列中依次执行：下载音频流 + 视频流 → FFmpeg 合并 → 输出到服务端下载根目录下的相对子目录
7. 输出文件名可在设置页配置全局模板（占位符 `{title}` `{bvid}` `{cid}` `{quality}` `{codec}`，留空用默认模板）；默认模板 `{title}-{bvid}-{cid}-q{quality}` 保证同名视频互不冲突，同一视频重复入队命中"文件已存在即跳过"
8. 用户可在下载列表中按服务端分页查看下载任务，使用状态过滤缩小当前结果集，查看进度、结果和完成任务的实际输出文件路径，并可对已完成任务直接触发 AI 总结
9. 用户可进入 AI 总结任务列表页，手动刷新查看各资源的 AI 总结状态、本次使用的模型，并可对失败/已完成的总结记录直接"重新总结"
10. 用户可在下载任务列表页删除下载任务记录，在 AI 总结任务列表页删除 AI 总结记录；删除仅作用于数据库记录，不删除磁盘内容，两条删除路径相互独立

当前基线说明：

- 当前“下载列表”页面已切换为服务端分页任务列表，不再以浏览器本地已保存任务 ID 作为页面主数据源。
- 页面支持按下载状态过滤现有任务，并移除了“清空已完成”这种本地隐藏语义。
- 页面轮询仅覆盖当前页中的非终态任务；翻页、切换过滤和切换每页条数时会释放旧轮询集合。
- 删除语义：`DELETE /api/tasks/:id` 删除下载任务及其下载子任务记录；`DELETE /api/summary-tasks/:id` 删除 AI 总结记录。两者都只删数据库记录、不删除磁盘上的媒体文件/总结输出文件，且互不联动；AI 总结记录处于 `pending`/`analyzing` 时禁止删除（返回 409）。

## Key Domain Objects

- `DownloadRequest` — 用户发起的下载请求，包含资源标识和偏好设置
- `VideoResource` — 解析后的视频资源信息（标题、分P、清晰度列表等）
- `Stream` — 视频流或音频流的播放地址和编码信息
- `DownloadArtifact` — 下载完成后的产物（文件路径、大小等）
- `DownloadTask` — 下载任务的状态、进度和结果

## Integration Points

| Integration | Purpose | Location |
| --- | --- | --- |
| Bilibili API | 获取视频信息、播放流地址 | `packages/adapters/src/bilibili/` |
| FFmpeg | 音视频合并 | 系统依赖（容器内置或宿主机安装） |
| SQLite | 下载任务持久化 | `packages/server/src/` |
| POST /api/tasks/check | 按 bvid + cid 批量查询任务状态（入队去重） | `packages/server/src/download/download.controller.ts` |
| POST /api/download | 创建下载任务，必填字段缺失或 outputPath 为空时返回 HTTP 400（BadRequestException）；`outputPath` 表示下载根目录下的相对子目录 | `packages/server/src/download/download.controller.ts` |
| GET /api/download/config | 返回当前服务端下载根目录及来源（环境变量或默认目录） | `packages/server/src/download/download.controller.ts` |
| GET /api/tasks | 返回服务端分页下载任务列表，支持 `page`、`pageSize`、`statusGroup` 查询参数 | `packages/server/src/download/download.controller.ts` |
| DELETE /api/tasks/:id | 删除下载任务记录（含 `analysis_sub_task`）；仅删数据库、不动磁盘、不联动删 AI 总结记录 | `packages/server/src/download/download.controller.ts` |
| POST /api/tasks/:id/summary | 对已完成下载任务直接触发 AI 总结；任务不存在返回 HTTP 404，非已完成任务返回 HTTP 409 | `packages/server/src/analysis/analysis-task.controller.ts` |
| GET /api/summary-tasks | 返回资源级 AI 总结任务列表，供前端手动刷新查看状态；每条记录含 `modelName`（本次使用模型，模型成功返回时写入），不含 `rawResponse`（原始返回仅入库） | `packages/server/src/analysis/analysis-task.controller.ts` |
| GET /api/summary-tasks/:id/raw-response | 按 id 返回该记录本次模型交互记录 `{ rawResponse: string \| null }`（成功=模型返回 content 原文；失败=错误信息）；非法 id 返回 400，不存在返回 404 | `packages/server/src/analysis/analysis-task.controller.ts` |
| POST /api/summary-tasks/:id/retrigger | 对 AI 总结记录按资源重新触发总结（全管线重跑，重新调用 LLM）；非法 id 返回 400，不存在返回 404，`pending`/`analyzing` 返回 409，无对应成功下载任务返回 409；复用 `AnalysisTriggerService.trigger` 链路 | `packages/server/src/analysis/analysis-task.controller.ts` |
| POST /api/summary-tasks/:id/rebuild | 对已完成的 AI 总结记录用已存储的大模型返回内容（`raw_response`）重建总结报告与截图，**不调用 LLM**；仅 `completed` 且 `raw_response` 非空可触发，非法 id 返回 400，不存在返回 404，非 completed 返回 409，raw 为空返回 409，并发重建返回 409；异步执行，失败不改写记录状态 | `packages/server/src/analysis/analysis-task.controller.ts` |
| DELETE /api/summary-tasks/:id | 删除 AI 总结任务记录（仅删数据库、不动磁盘）；非法 id 返回 400，不存在返回 404，`pending`/`analyzing` 返回 409 | `packages/server/src/analysis/analysis-task.controller.ts` |
| POST /api/analysis/run | 视频内容分析正式接口，接收 `AnalysisRequest`（videoPath、subtitlePath?、videoTitle、metadata、screenshotVideoPath?），按 metadata.type 校验，调用 AnalysisEngine 生成总结文档 | `packages/server/src/analysis/analysis.controller.ts` |

## Rule

Keep this file current. If a feature changes the supported app baseline, update this file or a narrower owner doc in the same change.

This file owns current app behavior, surfaces, roles, and workflows.

Do not duplicate long-term product vision from `docs/architecture/project-vision.md` or current milestone scope from `docs/requirements/product-scope.md`.
