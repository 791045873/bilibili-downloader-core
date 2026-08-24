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
├── frontend/   — React 19 前端
└── docker/     — 两个独立 Dockerfile 与构建脚本（server / vision-proxy）
```

依赖方向：`frontend/cli/docker/server → adapters → core`（不可反向）

## Frontend Stack

- React 19 + Vite + TypeScript
- 路由：react-router 7（library 模式，createBrowserRouter + lazy）
- 状态管理：Zustand（客户端状态，localStorage persist）+ TanStack Query（服务端状态）
- 组件库：antd 6 + Tailwind 4（布局工具类）

## Backend Stack

- NestJS + TypeScript
- SQLite（better-sqlite3）
- 可选 Python 薄代理：仅用于 DashScope 视觉模型读取本地图片路径，Node server 保持业务编排主体

## State Management Approach

- 前端：Zustand（设置/登录/下载队列，持久化到 localStorage）+ TanStack Query（列表/详情等服务端数据）
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
- Docker（两个独立 Dockerfile：`packages/docker/Dockerfile.server` 构建 `bilibili-downloader-server` = Node 服务 + 前端静态资源 + FFmpeg + tini；`packages/docker/Dockerfile.vision-proxy` 构建 `bilibili-downloader-vision-proxy` = Python venv 视觉代理 + tini；两镜像相互独立、无共享构建阶段，经 `packages/docker/docker-compose.yml` 编排为两个独立容器。镜像 tag = 对应包 version：`bilibili-downloader-server:<packages/server/package.json 的 version>`、`bilibili-downloader-vision-proxy:<packages/vision-proxy/pyproject.toml 的 version>`，由 `packages/docker/compose.mjs` 推导并同步到本目录 `.env`，`SERVER_VERSION` / `VISION_PROXY_VERSION` 环境变量可覆盖；compose 层以 `${VAR:?}` 必填插值保证每次构建/启动版本显式、缺失即报错）

## Deployment Shape

- Docker compose 双容器部署：`server`（NestJS + 静态文件托管前端构建产物 + FFmpeg）与 `vision-proxy`（Python 视觉薄代理）各自独立容器，镜像以各自包 version 打 tag（见 Build And Package Tools），均配置 `restart: unless-stopped`，任一容器主进程崩溃由 Docker 单独自动重启，不影响健康容器；对外仅暴露 `server` 的 3000 端口。
- server 经 compose 默认网络的服务名 `vision-proxy:8765` 调用代理（`QWEN_VISION_PROXY_URL` 默认 `http://vision-proxy:8765/v1/chat/completions`，由 compose 注入，运行期可完全自定义）；vision-proxy 容器内监听 `0.0.0.0:8765` 实现跨容器可达，但不向宿主机发布端口。
- 两容器共享同一宿主机目录挂载到 `/download`（默认 `${HOME:-$USERPROFILE}/Downloads/bilibili_download`，可用 `DOWNLOAD_HOST_PATH` 覆盖，Windows 宿主经 `USERPROFILE` 回退）；日志默认写入 `/download/logs`
- NAS 用户通过挂载 volume 将容器内下载目录映射到宿主机；大模型密钥由前端设置页存 DB，Node 经 `Authorization` 头传给 vision-proxy 容器，不写入镜像、不经 compose env

## External Platforms

- Bilibili API：无需登录即可获取视频基本信息、播放流地址
- FFmpeg / ffprobe：音视频合并与视频截图（作为外部依赖，需系统预装或容器内置）
- 阿里云百炼 / DashScope：视频分析总结功能使用 Qwen 文本与视觉理解模型；视觉本地文件输入通过可选 Python 薄代理接入 DashScope Python SDK

## Stable Rules

- Core 不依赖 UI 框架、CLI 框架、HTTP 框架
- Adapters 实现 Core 中定义的 Ports 接口
- Server / Docker 作为运行时入口，只做参数适配和编排，不包含下载细节
- 下载链路：解析 → 获取元信息 → 流选择 → 下载 → 合并 → 产物输出
- 所有 B站 API 调用集中在 adapters/src/bilibili/ 中
- `bilibili-api-sdk` 内建接口级缓存与业务错误码自动重试：GET 读接口默认缓存 24h（内存 `MemoryCacheStore` 或磁盘 `FileCacheStore`，key 含登录身份指纹）；`-412`/HTTP 412 默认指数退避重试、总共最多 5 次请求；两者均经 `ClientOptions.cache` / `ClientOptions.retry` 配置，默认开启
- server 的 parse/download 创建 SDK client 时注入共用磁盘缓存目录 `join(OUTPUT_DIR, 'bili-api-cache')`，实现跨实例与跨重启复用
- adapter 默认通过异常向上暴露失败，并在异常中保留安全摘要上下文；server 和其他上层入口负责高语义日志与对外错误语义
- adapter 内部只在吞错、静默降级或 fallback 且上层无法感知失败时记录少量低频 `debug`/`warn` 诊断
- adapter 级错误消息和诊断日志不得暴露 cookie、Authorization、完整 callback URL、完整 headers、完整字幕正文、完整上游响应体或其他非必要敏感内容
