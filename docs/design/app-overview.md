# App Overview

## Purpose

Describe the current supported app-level baseline for `bilibili-downloader-core`.

## Main Surfaces

| Surface | Description | Runtime |
| --- | --- | --- |
| Web Frontend | 视频链接输入、Section 选择器、视频解析、下载列表查看、AI 总结任务列表、设置管理 | Vue 3 SPA（浏览器） |
| CLI | 命令行下载单个视频，参数包括输入、输出目录、清晰度偏好（当前不可用，待修复） | Node.js 终端 |
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
7. 用户可在下载列表中查看进度、结果和完成任务的实际输出文件路径，并可对已完成任务直接触发 AI 总结
8. 用户可进入 AI 总结任务列表页，手动刷新查看各资源的 AI 总结状态

### 单视频下载（CLI）

1. 命令行传入 BV/AV/URL 和参数
2. 解析 → 下载 → 合并 → 输出结果到终端

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
| POST /api/tasks/:id/summary | 对已完成下载任务直接触发 AI 总结；任务不存在返回 HTTP 404，非已完成任务返回 HTTP 409 | `packages/server/src/analysis/analysis-task.controller.ts` |
| GET /api/summary-tasks | 返回资源级 AI 总结任务列表，供前端手动刷新查看状态 | `packages/server/src/analysis/analysis-task.controller.ts` |
| POST /api/analysis/run | 视频内容分析正式接口，接收 `AnalysisRequest`（videoPath、subtitlePath?、videoTitle、metadata、screenshotVideoPath?），按 metadata.type 校验，调用 AnalysisEngine 生成总结文档 | `packages/server/src/analysis/analysis.controller.ts` |

## Rule

Keep this file current. If a feature changes the supported app baseline, update this file or a narrower owner doc in the same change.

This file owns current app behavior, surfaces, roles, and workflows.

Do not duplicate long-term product vision from `docs/architecture/project-vision.md` or current milestone scope from `docs/requirements/product-scope.md`.
