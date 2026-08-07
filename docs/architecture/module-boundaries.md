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
- Forbidden dependencies: `packages/frontend/`, `packages/server/`
- Owner docs: `docs/architecture/system-baseline.md`
- Error boundary: 默认向上抛出带安全上下文的错误，不承担最终请求级、任务级或编排级错误日志职责。
- Diagnostic exception: 只有当 adapter 内部吞错、静默降级或 fallback 且上层无法感知该失败信号时，才允许在 adapter 内记录少量 `debug`/`warn` 诊断日志。
- Logging constraint: adapters 不得依赖 Nest Logger 或 `packages/server/` 的日志实现。

### `packages/server/`

- Responsibility: NestJS 后端 API，下载任务管理 REST 接口，数据库持久化
- Allowed dependencies: `packages/core/`, `packages/adapters/`
- Forbidden dependencies: `packages/frontend/`
- Owner docs: `docs/design/app-overview.md`
- Logging ownership: server 负责 adapter 失败的高语义日志表达，包括请求、任务状态、编排分支、降级决策和对外错误语义。

### `packages/frontend/`

- Responsibility: Vue 3 Web 前端，视频输入界面、下载列表、设置页
- Allowed dependencies: `packages/server/`（仅通过 HTTP API 通信，不直接导入）
- Forbidden dependencies: `packages/core/`（Core 模型不应直接暴露给前端）, `packages/adapters/`
- Owner docs: `docs/design/app-overview.md`

### `packages/docker/`

- Responsibility: Dockerfile 和构建脚本，将 Server + Frontend 打包为 Docker 镜像
- Allowed dependencies: `packages/server/`, `packages/frontend/`（仅通过构建流程，不通过代码导入）
- Forbidden dependencies: 不包含业务代码
- Owner docs: `docs/architecture/system-baseline.md`

## Dependency Direction

```
frontend ──(HTTP)──→ server ──→ adapters ──→ core
docker ──(build)──→ server + frontend
```

- Core 是最内层，不依赖任何其他包
- Adapters 依赖 Core（实现其 Ports）
- Server 依赖 Core + Adapters（编排用例）
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

For adapter failures specifically: prefer upward propagation with safe context; use adapter-local diagnostics only for hidden failures or hidden degradation that upper layers cannot otherwise observe.