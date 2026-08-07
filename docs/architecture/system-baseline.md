# System Baseline

## Purpose

Record the current supported implementation baseline for `bilibili-downloader-core`.

## Runtime Shape

TypeScript monorepo，使用 pnpm workspace 管理，共 6 个包：

```
packages/
├── core/       — 下载领域模型、用例编排、Ports 接口
├── adapters/   — B站 API、HTTP 下载器、FFmpeg、文件系统适配
├── cli/        — 命令行入口（当前不可用，待修复）
├── server/     — NestJS 后端 API
├── frontend/   — Vue 3 前端
└── docker/     — Dockerfile 与构建脚本
```

依赖方向：`frontend/cli/docker/server → adapters → core`（不可反向）

## Frontend Stack

- Vue 3 + Vite + TypeScript
- 组件库：待定（UI 优化需求中）

## Backend Stack

- NestJS + TypeScript
- SQLite（better-sqlite3）
- 可选 Python 薄代理：仅用于 DashScope 视觉模型读取本地图片路径，Node server 保持业务编排主体

## State Management Approach

- 前端：Vue 3 reactivity（ref/reactive）
- 后端：NestJS service 层管理业务状态，SQLite 持久化

## Data Access Approach

- SQLite 通过 server 包管理，使用 better-sqlite3
- 下载任务状态通过数据库记录
- 下载文件通过文件系统管理（输出目录 + 临时目录）

## Testing Stack

- 无（待建立）

## Build And Package Tools

- pnpm workspace（monorepo 管理）
- Vite（Frontend 打包）
- tsc（Core/Adapters/Server 编译）
- Docker（Server + Frontend 静态资源打包为单容器）

## Deployment Shape

- Docker 单容器部署（Server 运行 NestJS + 静态文件服务托管 Frontend 构建产物）
- NAS 用户通过挂载 volume 将容器内下载目录映射到宿主机
- 默认下载目录：容器内 `/downloads`，建议挂载到宿主机对应目录

## External Platforms

- Bilibili API：无需登录即可获取视频基本信息、播放流地址
- FFmpeg / ffprobe：音视频合并与视频截图（作为外部依赖，需系统预装或容器内置）
- 阿里云百炼 / DashScope：视频分析总结功能使用 Qwen 文本与视觉理解模型；视觉本地文件输入通过可选 Python 薄代理接入 DashScope Python SDK
- 腾讯云 COS：未启用 Python 薄代理时，可作为多模态图片公网 URL 的备用临时存储路径

## Stable Rules

- Core 不依赖 UI 框架、CLI 框架、HTTP 框架
- Adapters 实现 Core 中定义的 Ports 接口
- Server / Docker 作为运行时入口，只做参数适配和编排，不包含下载细节
- 下载链路：解析 → 获取元信息 → 流选择 → 下载 → 合并 → 产物输出
- 所有 B站 API 调用集中在 adapters/src/bilibili/ 中
- adapter 默认通过异常向上暴露失败，并在异常中保留安全摘要上下文；server 和其他上层入口负责高语义日志与对外错误语义
- adapter 内部只在吞错、静默降级或 fallback 且上层无法感知失败时记录少量低频 `debug`/`warn` 诊断
- adapter 级错误消息和诊断日志不得暴露 cookie、Authorization、完整 callback URL、完整 headers、完整字幕正文、完整上游响应体或其他非必要敏感内容