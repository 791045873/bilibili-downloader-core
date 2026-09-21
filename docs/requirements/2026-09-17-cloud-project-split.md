# 需求：拆分为 cloud-server / nas-worker 两个独立 NestJS 项目（Phase 3）

> 来源：拆自 `docs/discussions/2026-09-17-cloud-nas-responsibility-split.md`（Phase 3）
> Owner Doc：`docs/architecture/system-baseline.md`、`docs/architecture/module-boundaries.md`、`docs/design/app-overview.md`
> 前置：Phase 2（持久化作业与跨主机触发）已落地
> 保护区：**部署（`ask-first`）**——需 owner doc + Dockerfile 验证 + 人工批准；reviewer availability=none 时实现 blocked
> 状态：实现就绪（部署细节需人工批准）

## Goal

把当前单体 server 拆成两个**相互独立的 NestJS 项目**——`cloud-server`（云端 api）与 `nas-worker`（NAS worker），共享代码抽到 `server-common`；各自独立镜像。云端对外提供全部 HTTP；worker 只经 DB + COS + 本地 vision-proxy 工作，不暴露公网 HTTP。云端项目**物理上不含** ffmpeg / 分析执行 / vision-proxy 代码。

## In Scope

### 包结构（讨论 `Target Package Layout`）

- 新增 `packages/server-common`：DB/Prisma 访问、logging、`worker_job` 仓储、settings/cookie 读写、共享类型与配置。
- 新增 `packages/cloud-server`（`@bilibili-downloader/cloud-server`）：NestJS api。
- 新增 `packages/nas-worker`（`@bilibili-downloader/nas-worker`）：NestJS worker。
- `core` / `adapters` / `bilibili-api-sdk` / `frontend` / `vision-proxy` 保持。
- 依赖方向：`cloud-server` / `nas-worker` → `server-common` → `adapters` → `core`。

### 模块归属

- **cloud-server**：parse、download（创建/读取）、analysis（触发/查询）、chat/RAG、knowledge 检索、auth、prompt、settings、作业生产。
- **nas-worker**：下载执行、分析引擎、截图、`screenshot_retry`、完整性检查、vision-proxy 客户端、作业消费、`PathsService` / 媒体路径锚点。
- **server-common**：DB/Prisma、logging、作业仓储、settings/cookie、共享类型。

### LLM / 缓存 / Cookie

- 云端多模态改用 **OpenAI 官方 Node.js SDK**（`openai` 包）直连同一端点；`QwenClient` 仅保留 NAS 经代理模式。
- 云端 `QWEN_VISION_PROXY_URL` 不再强制；vision-proxy 仅 NAS。
- 云端用 `FileCacheStore`；NAS 不落磁盘缓存（SDK 默认 `MemoryCacheStore`）。
- Cookie 真源 `app_settings`；NAS 启动物化 + 作业前按版本刷新。

### 部署（保护区）

- 两个独立镜像（各自 Dockerfile）；`vision-proxy` 保持独立镜像。共三个镜像。
- 云端镜像**不含** ffmpeg / Python / vision-proxy；NAS 镜像含 ffmpeg，并在 compose 内运行 vision-proxy。
- worker 使用独立最小权限 DB 角色。
- 验证：`pnpm docker:build`、`docker compose config`。

## Out Of Scope

- 用户系统（auth 独立需求）。
- 完整性检查判据 / 报告结构变更。
- 下载迁移到 `worker_job`（若 Phase 2 未完成则在本阶段补）。
- 删除既有本地文件（Phase 4）。

## Main User Flows

1. 前端 → 云端 api（parse / 读 / 问答 / 触发）。
2. 云端写作业 → NAS worker 轮询认领执行 → 回写 DB / COS。
3. NAS worker → 本地 vision-proxy（视频分析）；云端 → OpenAI SDK（问答图片）。

## Business Rules

- **物理隔离**：云端项目不得依赖 ffmpeg / 分析执行 / vision-proxy 模块。
- **NAS 仅出站**：worker 只出站连 DB / COS / 模型 / B站。
- **媒体命名空间仅 NAS**：云端不 join 媒体路径。
- **共享不复制**：DB/logging/作业仓储只在 `server-common`。

## Roles / Permissions

- 沿用现状（auth 独立需求）。

## Data / Model Impact

- 无 schema 变更（Phase 2 已完成）。

## API / Integration Impact

- 所有对外 HTTP 由 `cloud-server` 提供；`nas-worker` 无公网端点。
- 端点归属按模块表调整；行为与 Phase 2 一致。

## Edge Cases

- 云端无 NAS 卷：所有读走 DB/COS（Phase 1a/1b 已保证）。
- NAS 离线：作业排队，UI 显示等待。
- Cookie 变更：worker 作业前刷新。
- vision-proxy 崩溃：仅影响 NAS 分析，不影响云端读 / 问答。

## Open Questions

- 无阻塞项（部署细节在计划中展开，需人工批准）。

## Acceptance Criteria

- [ ] 存在三个独立包：`server-common`、`cloud-server`、`nas-worker`，依赖方向正确。
- [ ] 云端镜像**不含** ffmpeg / Python / vision-proxy；NAS 镜像含 ffmpeg。
- [ ] 云端在无 NAS 卷条件下可完成读 / 问答 / 触发；NAS worker 可认领并执行作业。
- [ ] 云端多模态经 OpenAI SDK；`QWEN_VISION_PROXY_URL` 仅 NAS 使用。
- [ ] 云端用 `FileCacheStore`，NAS 用内存缓存（无磁盘缓存）。
- [ ] Cookie 由 `app_settings` 物化并支持版本刷新。
- [ ] `pnpm typecheck`、`pnpm build`、`pnpm docker:build`、`docker compose config` 通过。
- [ ] 部署与 Dockerfile 变更经人工批准；owner doc 更新。
