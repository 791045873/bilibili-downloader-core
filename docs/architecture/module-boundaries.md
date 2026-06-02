# Module Boundaries

## Purpose

Define the main code ownership boundaries for `bilibili-downloader-core`.

## Package Boundaries

### `packages/core/`

- Responsibility: 下载领域模型、用例编排、Ports 接口定义、领域事件
- Allowed dependencies: 无（不依赖其他包，仅依赖 TypeScript 标准库和通用工具库）
- Forbidden dependencies: Vue, NestJS, CLI 框架, Express, B站 API 特定类型
- Owner docs: `docs/architecture/system-baseline.md`

### `packages/adapters/`

- Responsibility: Core 中所有 Ports 的具体实现
  - `bilibili/` — B站资源解析、视频详情 API、播放流 API
  - `transport/` — HTTP 下载器实现
  - `ffmpeg/` — 音视频合并
  - `fs/` — 文件系统操作、输出目录管理
- Allowed dependencies: `packages/core/`（仅使用其 Ports 接口和领域模型）
- Forbidden dependencies: `packages/frontend/`, `packages/cli/`, `packages/server/`
- Owner docs: `docs/architecture/system-baseline.md`

### `packages/cli/`

- Responsibility: 命令行参数解析，将 CLI 参数转换为 `DownloadRequest`，调用 Core UseCase，输出结果到终端
- Allowed dependencies: `packages/core/`, `packages/adapters/`
- Forbidden dependencies: `packages/frontend/`, `packages/server/`
- Owner docs: `docs/design/app-overview.md`

### `packages/server/`

- Responsibility: NestJS 后端 API，下载任务管理 REST 接口，数据库持久化
- Allowed dependencies: `packages/core/`, `packages/adapters/`
- Forbidden dependencies: `packages/frontend/`, `packages/cli/`
- Owner docs: `docs/design/app-overview.md`

### `packages/frontend/`

- Responsibility: Vue 3 Web 前端，视频输入界面、下载列表、设置页
- Allowed dependencies: `packages/server/`（仅通过 HTTP API 通信，不直接导入）
- Forbidden dependencies: `packages/core/`（Core 模型不应直接暴露给前端）, `packages/adapters/`, `packages/cli/`
- Owner docs: `docs/design/app-overview.md`

### `packages/docker/`

- Responsibility: Dockerfile 和构建脚本，将 Server + Frontend 打包为 Docker 镜像
- Allowed dependencies: `packages/server/`, `packages/frontend/`（仅通过构建流程，不通过代码导入）
- Forbidden dependencies: 不包含业务代码
- Owner docs: `docs/architecture/system-baseline.md`

## Dependency Direction

```
frontend ──(HTTP)──→ server ──→ adapters ──→ core
cli ──────────────→ adapters ──→ core
docker ──(build)──→ server + frontend
```

- Core 是最内层，不依赖任何其他包
- Adapters 依赖 Core（实现其 Ports）
- Server/CLI 依赖 Core + Adapters（编排用例）
- Frontend 通过 HTTP 与 Server 通信，不直接导入任何内部包
- Docker 仅作为构建打包层

## Test Ownership

- 当前无自动化测试框架
- 未来测试应按包划分：
  - `packages/core/` — 单元测试（领域逻辑）
  - `packages/adapters/` — 集成测试（B站 API mock、FFmpeg mock）
  - `packages/server/` — E2E 测试（API 端点）
  - `packages/frontend/` — 组件测试 + E2E 测试

## Rule

If a recurring design argument depends on module ownership, write the answer here instead of re-litigating it in chat.