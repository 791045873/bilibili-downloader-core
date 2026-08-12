# Codebase Map

## Purpose

This file gives AI agents a compact map of the live repository so they do not rediscover the structure by repeatedly searching imports and directories.

Keep it current enough to route common work. Do not turn it into a full architecture document.

## Entry Points

| Area         | Path                          | Notes                                          | Last Verified | Confidence |
| ------------ | ----------------------------- | ---------------------------------------------- | ------------- | ---------- |
| Core         | `packages/core/src/`          | 下载领域模型、用例编排、ports 接口                | 2026-06-02    | high       |
| Bilibili SDK | `packages/bilibili-api-sdk/`  | B站非官方 REST API SDK（workspace 包，含 vitest 测试） | 2026-08-07    | high       |
| Adapters     | `packages/adapters/src/`      | B站 API 适配（基于 bilibili-api-sdk）、HTTP 下载器、FFmpeg、文件系统 | 2026-08-07    | high       |
| Server       | `packages/server/src/`        | NestJS 后端 API，下载任务管理、视频分析编排、全局请求日志 | 2026-08-11    | high       |
| Server Logging | `packages/server/src/logging/` | RequestLoggingInterceptor、safe log allowlist、请求体安全裁剪 | 2026-08-02 | high |
| Vision Proxy | `packages/server/python/`     | 可选 Python 薄代理，仅负责 DashScope 本地视觉文件调用（pyproject.toml 锁定依赖 + .venv） | 2026-08-11    | medium     |
| Frontend     | `packages/frontend/src/`      | Vue 3 前端，视频输入、下载列表、设置              | 2026-06-02    | high       |
| Docker       | `packages/docker/`            | Dockerfile 与构建脚本                            | 2026-06-02    | high       |
| Config       | `tsconfig.base.json`, `pnpm-workspace.yaml`, `package.json` | 项目配置                          | 2026-06-02    | high       |
| Tests        | 无统一测试目录                    | 当前无自动化测试                                  | 2026-06-02    | low        |

## Common Change Routes

| Task Type           | Start Here                    | Then Check                                | Verification                    | Last Verified | Confidence |
| ------------------- | ----------------------------- | ----------------------------------------- | ------------------------------- | ------------- | ---------- |
| 新增下载能力         | `packages/core/src/`          | `packages/adapters/src/`                  | `pnpm typecheck`                | 2026-06-02    | high       |
| 新增 API 端点        | `packages/server/src/`        | `packages/core/src/` (usecase)            | `pnpm typecheck`                | 2026-06-02    | high       |
| 修改 server 可观测性 | `packages/server/src/logging/` | `packages/server/src/download/`, `packages/server/src/analysis/`, `docs/testing/2026/` | `pnpm --filter @bilibili-downloader/server typecheck`, `pnpm typecheck`, `pnpm build` | 2026-08-02 | high |
| 修改视频分析能力      | `packages/server/src/analysis/` | `packages/adapters/src/llm/`, `packages/adapters/src/ffmpeg/`, `packages/server/python/` | `pnpm typecheck`, `pnpm build` | 2026-08-12    | high       |
| 新增 UI 页面         | `packages/frontend/src/`      | `packages/server/src/` (API)              | `pnpm typecheck`                | 2026-06-02    | high       |
| 修改下载器行为        | `packages/adapters/src/`      | `packages/core/src/` (ports)              | `pnpm typecheck`                | 2026-06-02    | high       |
| 修改 B站 API 适配     | `packages/adapters/src/bilibili/` | `packages/bilibili-api-sdk/` (底层接口), `packages/core/src/` (domain models) | `pnpm typecheck`, `pnpm --filter bilibili-api-sdk test` | 2026-08-07    | high       |
| 修改部署配置          | `packages/docker/`            | `package.json` (scripts)                  | `pnpm docker:build`             | 2026-06-02    | high       |

## Large Or Fragile Files

| Path                                  | Risk                               | Preferred Approach                                     |
| ------------------------------------- | ---------------------------------- | ------------------------------------------------------ |
| `packages/core/src/`                  | 核心编排逻辑，改动需谨慎             | 优先阅读现有 usecase 和 port 接口，理解领域模型后再修改    |
| `packages/adapters/src/bilibili/`     | B站 API 适配，外部 API 变更敏感      | 底层接口调用统一走 bilibili-api-sdk，新增/修改接口优先改 SDK 并补测试 |
| `packages/server/src/`                | NestJS 模块装配，依赖注入复杂度高     | 新增 API 遵循现有 controller/service 模式               |
| `packages/server/src/logging/`        | 安全字段 allowlist 漂移会直接影响敏感信息暴露 | 修改时优先保持 allowlist 思路，再用 route matrix + testing 文档验证 |
| `packages/server/src/analysis/`       | 视频分析编排横跨 LLM、字幕、截图、文档生成 | 保持 Node.js 作为业务编排主体，Python 只做本地视觉文件薄代理 |
| `packages/server/python/`             | Python 依赖与本地文件路径能力，容易和 Node 编排漂移 | 仅透传 Node 指定的多模态请求，不加入业务语义 |

## Project-Specific Search Hints

- Use file patterns: `packages/*/src/**/*.ts`
- Use content anchors: `DownloadRequest`, `DownloadUseCase`, `ResourceParser`, `MediaDownloader`, `FFmpegMerger`
- Avoid editing generated files: `node_modules/`, `dist/`, `*.d.ts`（非手写的类型声明）

## Update Rule

Update this file when a change creates a new major entry point, moves common code, adds a new test location, or repeatedly causes agents to rediscover the same path.

If a listed path is missing, placeholders remain, or live imports contradict this map, do not treat the map as authority. Verify with the live repo, then update the map or mark the row low confidence before implementation.

If `Last Verified` is old for the project's pace, predates major structural changes, or the task touches a listed route's boundary, verify the live repo before relying on the row. Low-confidence rows do not block low-risk work after live verification, but protected-area, migration, or cross-module work should update the row before implementation.