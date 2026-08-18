# 2026-08-18 环境变量清理（废弃/重复项移除）

> Plan Status: completed
> Last Reviewed: 2026-08-18
> Source: 用户会话决策——清理项目中不再使用、过时或重复的环境变量；范围见 `docs/discussions/2026-08-18-env-var-cleanup.md`（三项范围均经用户确认）。
> Related: `docs/plans/2026-08-18-extract-vision-proxy-package-plan.md`（已关闭；本计划在其产物之上清理）
> Audit: required（独立 subagent；reviewer availability = none，受保护区域 deployment 需 subagent/human 复核）
> Protected area: `deployment`（ask-first）——改动 `packages/docker/docker-compose.yml` 环境桥接与依赖集。用户已在本会话明确授权。
> Testing: `docs/testing/2026/08-18-env-var-cleanup-testing.md`

## Current Baseline

- 活跃 env 全集见 `docs/discussions/2026-08-18-env-var-cleanup.md`「保留」节（逐项经代码 grep 验证）。
- 废弃项（代码零读取）：
  - `QWEN_API_KEY` / `QWEN_API_BASE` / `QWEN_MODEL`（2026-08-15 LLM 配置迁移 DB 后移除，仅残留本机 `.env` 与历史文档）。
  - `QWEN_VISION_MODEL`（同日视觉模型并入主模型，仍残留 `docs/architecture/2026-07-06-video-analysis-baseline.md:224/258` 与本机 `.env`）。
  - `TENCENT_COS_SECRET_ID/KEY/REGION/BUCKET` 及文档仅有的 `TENCENT_COS_TEMP_PREFIX`/`TENCENT_COS_SIGNED_URL_EXPIRES_SECONDS`：COS 死代码（`packages/adapters/src/cos/` 导出但无人实例化）的配套变量；`video-analysis-baseline.md:106/247-253/261` 的 COS 备用路径描述过期（无代理时实际走 `packages/adapters/src/llm/qwen-client.ts:203` 直接调用 `baseUrl/chat/completions`）。
- 重复项：`DASH_SCOPE_API_KEY`（`DASHSCOPE_API_KEY` 别名回退）——`packages/vision-proxy/qwen_vision_proxy.py:238/240`、`packages/docker/docker-compose.yml:13`、`packages/docker/.env.example:6/8`。本机实际仅用 `DASHSCOPE_API_KEY`。
- 死代码/依赖：`packages/adapters/src/cos/tencent-cos-temp-image-store.ts`、`packages/adapters/src/cos/index.ts`、`packages/adapters/src/index.ts:11` 的 `export * from "./cos/index.js"`、`packages/adapters/package.json` 的 `"./cos"` exports 映射（L41-44）与 `cos-nodejs-sdk-v5` 依赖（L63）；`pnpm-lock.yaml` 含 cos-nodejs-sdk-v5 条目。
- 本机 gitignored `.env`：`packages/server/.env` 与 `packages/vision-proxy/.env` 均残留 `QWEN_API_KEY`/`QWEN_API_BASE`/`QWEN_MODEL`/`QWEN_VISION_MODEL`/`TENCENT_COS_*`，且存在跨进程冗余（server/.env 含代理专用键、vision-proxy/.env 含 server 专用键）。
- 历史留档（不修改）：`docs/plans/2026-08-18-docker-split-vision-proxy-plan.md`、`docs/audits/2026-08-18-plan-audit-docker-split-vision-proxy.md` 中 DASH_SCOPE_API_KEY 描述属当时记录。

## Goals

- 移除全部废弃 env 变量引用（代码/compose/文档/本机 .env），代理只保留 `DASHSCOPE_API_KEY` 单一入口。
- 移除 COS 死代码、adapters 导出、`cos-nodejs-sdk-v5` 依赖与 lockfile 条目。
- `docs/architecture/2026-07-06-video-analysis-baseline.md` env 块与"无代理路径"描述更正为与 live 代码一致。
- 本机 `.env` 按进程归属拆分清理（server/.env 只留 server 键、vision-proxy/.env 只留代理键），不打印/不提交密钥。
- 对外行为不变：镜像职责、compose 服务、端口、healthcheck 语义不变；`DASHSCOPE_API_KEY` 为唯一密钥入口。

## Non-Goals

- 不改历史 plan/log/audit/testing 文档中的旧 env 描述（历史留档）。
- 不改 `docs/requirements/` 历史需求文档中残留的 `QWEN_API_KEY`/`QWEN_API_BASE` 描述（`2026-07-06-video-analysis-summary.md`、`2026-08-12-ai-summary-rebuild-from-raw.md` 属已实现需求的历史留档，不在残留扫描范围内）。
- 不引入新的 env 管理机制（如集中 config schema、ConfigService 重构）。
- 不改活跃 env 的行为或默认值；不迁移 SMTP/COOKIE/ANALYSIS_LLM_VIDEO_DIR 等仍在使用变量的位置。
- 不动 `packages/docker/.env`（本机不存在）；不动 compose 服务拓扑/端口/健康检查。

## Infrastructure And Config Prereqs

- 需要 `pnpm install` 重生成 `pnpm-lock.yaml`（移除 cos-nodejs-sdk-v5）；Docker 构建 `--frozen-lockfile` 依赖该更新。
- 本机 `.env` 修改为纯本地、gitignored，不产生 diff；验证不依赖密钥（healthz 无 key 仍 200）。
- 无新增依赖。

## Execution Plan

### Phase 1 - 移除 DASH_SCOPE_API_KEY 别名

Status: completed
Targets: `packages/vision-proxy/qwen_vision_proxy.py`, `packages/docker/docker-compose.yml`, `packages/docker/.env.example`

- [x] `Fix`: `qwen_vision_proxy.py:238` 改为 `api_key = os.getenv("DASHSCOPE_API_KEY")`；L240 错误信息只提 `DASHSCOPE_API_KEY`。
- [x] `Fix`: `docker-compose.yml:13` 删除 `DASH_SCOPE_API_KEY` 桥接。
- [x] `Fix`: `.env.example` 删除 L6 的"或 DASH_SCOPE_API_KEY"措辞与 L8 的 `# DASH_SCOPE_API_KEY=` 示例行。
- [x] `Decision`: 删除别名回退。备选：保留双名兼容——但本机/文档从未以别名为主键，保留会继续传播"两个键都能用"的过期认知；残余风险：若外部部署仅设了别名将失效（仓库从未推荐，接受）。
- [x] `Proof`: grep `DASH_SCOPE_API_KEY` 在活动文件（py/yml/example/README/架构文档）中为 0；历史留档除外。

Exit Criteria:

- [x] 活动代码/配置/文档无 `DASH_SCOPE_API_KEY` 引用。
- [x] 代理 `api_key` 只读 `DASHSCOPE_API_KEY`，错误信息同步。

### Phase 2 - 移除 COS 死代码与依赖

Status: completed
Targets: `packages/adapters/src/cos/`（删除）, `packages/adapters/src/index.ts`, `packages/adapters/package.json`, `pnpm-lock.yaml`

- [x] `Fix`: 删除 `packages/adapters/src/cos/` 目录（`tencent-cos-temp-image-store.ts` + `index.ts`）。
- [x] `Fix`: `packages/adapters/src/index.ts:11` 删除 `export * from "./cos/index.js";`。
- [x] `Fix`: `packages/adapters/package.json` 删除 `"./cos"` exports 块（L41-44）与 `cos-nodejs-sdk-v5` 依赖（L63）。
- [x] `Decision`: 整段移除 COS 备用路径（类 + 导出 + 依赖）。备选：仅删 env 引用保留代码——会让死代码继续存在且 env 与代码脱钩，不如整段移除；残余风险：未来若需无代理公网 URL 上传能力需重新引入（当前无此需求）。
- [x] `Proof`: `pnpm install` 后 `pnpm-lock.yaml` 无 `cos-nodejs-sdk-v5`；`pnpm --filter @bilibili-downloader/adapters build` 通过。

Exit Criteria:

- [x] adapters 内无 cos 目录/导出/依赖；`pnpm-lock.yaml` 无 cos-nodejs-sdk-v5（grep 0 命中，lockfile 净删 443 行）。
- [x] `pnpm typecheck` 与 `pnpm build` 通过（无残留 import 断裂）。

### Phase 3 - 文档对齐（video-analysis-baseline + system-baseline）

Status: completed
Targets: `docs/architecture/2026-07-06-video-analysis-baseline.md`, `docs/architecture/system-baseline.md`

- [x] `Fix`: L106「无 QWEN_VISION_PROXY_URL: 使用 COS/公网 URL 路径」改为「无 QWEN_VISION_PROXY_URL: 直接调用兼容接口 `/chat/completions`（图片需为公网可访问 URL）」。
- [x] `Fix`: 模块树 L14/16 删除 `cos/` 子树（目录已删）。
- [x] `Fix`: L43 架构原则「云端部署可回退 COS/公网 URL」改为「云端部署需提供公网可访问的图片 URL」。
- [x] `Fix`: L81「未配置代理时保留原有公网 URL/COS 路径」改为「未配置代理时直接调用兼容接口（图片需公网可访问 URL）」。
- [x] `Fix`: L87「为截图上传 COS/OSS」改为「为截图做云端托管」。
- [x] `Fix`: env 块删除 L224 `QWEN_VISION_MODEL=qwen3.7-plus` 行；L220「不上传 COS/OSS」改为「由代理本机读取」。
- [x] `Fix`: 删除 L247-253 的 TENCENT_COS 备用路径块与注释。
- [x] `Fix`: L210（2026-08-15 基线更新节）「不再回退环境变量 `QWEN_API_KEY` / `QWEN_API_BASE` / `QWEN_MODEL`」改写为「不再回退任何 LLM 环境变量」（保留语义、不残留废弃变量名）。
- [x] `Fix`: L258 透传描述删除 `QWEN_VISION_MODEL`（仅保留 `QWEN_VISION_PROXY_URL`）；L261 删除 TENCENT_COS_* 描述行。
- [x] `Fix`: `system-baseline.md` External Platforms 删除「腾讯云 COS：未启用 Python 薄代理时，可作为多模态图片公网 URL 的备用临时存储路径」（L70）。
- [x] `Proof`: 文档环境变量清单与 live 代码读取集一致（对照讨论文件"保留"节）；无残留 `COS`/`TENCENT_COS` 备用路径措辞。

Exit Criteria:

- [x] `video-analysis-baseline.md` 无 `QWEN_VISION_MODEL`/`TENCENT_COS`/`DASH_SCOPE_API_KEY`/`QWEN_API_KEY`/`QWEN_API_BASE`/`QWEN_MODEL` 引用，且无 COS 备用路径/上传措辞残留（L14/16/43/81/87/106/220/224/247-253/258/261 已处理）。
- [x] `system-baseline.md` 无腾讯云 COS 平台条目。
- [x] 无代理路径描述与 `qwen-client.ts` 实际行为一致。

### Phase 4 - 本机 .env 按进程归属拆分清理

Status: completed
Targets: `packages/server/.env`, `packages/vision-proxy/.env`（均 gitignored，本机）

- [x] `Fix`: `packages/server/.env` 删除 `TENCENT_COS_*`、`QWEN_API_KEY`/`QWEN_API_BASE`/`QWEN_MODEL`、`QWEN_VISION_MODEL`、代理专用键（`QWEN_VISION_PROXY_HOST`/`QWEN_VISION_PROXY_PORT`/`DASHSCOPE_API_KEY`）；保留 server 读取键（`MAX_CONCURRENT_DOWNLOADS`、`QWEN_VISION_PROXY_URL`）。
- [x] `Fix`: `packages/vision-proxy/.env` 删除 `TENCENT_COS_*`、`QWEN_API_*`、`QWEN_VISION_MODEL`、server 专用键（`MAX_CONCURRENT_DOWNLOADS`/`QWEN_VISION_PROXY_URL`）；保留代理读取键（`DASHSCOPE_API_KEY`、`QWEN_VISION_PROXY_HOST`/`PORT`）。
- [x] `Decision`: 按进程归属拆分而非双文件同存。备选：保留双文件冗余——与"清理重复"目标冲突；残余风险：清理后若 `pnpm dev:server` 找不到某键（如 DASHSCOPE_API_KEY 已在 vision-proxy/.env 中，代理自身读取，无风险）。
- [x] `Proof`: 重跑 `pnpm --filter @bilibili-downloader/server start:vision-proxy`（`VISION_PROXY_NO_RESTART=1`）healthz 200；server 端 `pnpm --filter @bilibili-downloader/server typecheck` 通过（不依赖 .env）。

Exit Criteria:

- [x] 两个 .env 键集分别与对应进程 env 读取集一致；无废弃键残留。
- [x] 开发模式代理健康启动不受影响（healthz 200）。

### Phase 5 - 验证

Status: completed
Targets: 仓库级验证与 Docker 构建

- [x] `Proof`: `pnpm typecheck`、`pnpm build` 通过。
- [x] `Proof`: `docker compose config` 通过；`pnpm docker:build` 两镜像构建成功（vision-proxy 镜像仍可导入 dashscope/dotenv、含代理脚本；server 镜像职责不变）。
- [x] `Proof`: 残留扫描——活动文件（mjs/json/yaml/toml/ts/py/example/README/context/design/architecture）无 `DASH_SCOPE_API_KEY`、`TENCENT_COS`、`QWEN_VISION_MODEL`、`QWEN_API_KEY`、`cos-nodejs-sdk-v5`、`腾讯云 COS`（历史留档除外）。

Exit Criteria:

- [x] 全部验证命令通过；镜像职责与清理前一致。
- [x] 残留扫描 0 命中（历史留档除外）。

## Plan Audit

- Status: passed（三轮 subagent；首轮 minor×2 + observation×2 → 修订 → 复核 new×2 → 再修订 → 复核 approved）
- Reviewer / Agent: 独立 subagent（task `ses_fec66ef34ffeRCB7eJ4T51ZS8H`）
- Evidence: 首轮确认全部 baseline 事实准确（别名位置、死代码、无代理路径、本地 .env 键集），2 个 must-fix：①L210 QWEN_API_* 残留与 Phase 5 扫描自相矛盾；②L220「不上传 COS/OSS」措辞。复核轮新增 2 个 must-fix：③L14/16/43/81/87 同文档残余 COS 措辞；④`system-baseline.md:70` 腾讯云 COS 平台条目（扫描词 `TENCENT_COS` 捕不到「腾讯云 COS」）。均已修订（Phase 3 覆盖全部清单、Phase 5 扫描补 `腾讯云 COS`、Non-Goals 裁定 requirements 历史留档、testing 方向同步）。末轮逐一核对计划行与 live 文件 1:1 匹配、无新增矛盾，VERDICT approved。

## Closure Gates

- [x] in-scope behavior is complete
- [x] relevant docs are aligned
- [x] verification has run（`pnpm install`、`pnpm typecheck`、`pnpm build`、开发模式代理 healthz、`docker compose config`、`pnpm docker:build`、残留扫描）
- [x] corresponding `docs/testing/` document exists and every testing direction is confirmed passed or explicitly adjudicated out of scope
- [x] no in-scope item downgraded to deferred/follow-up
- [x] plan audit passed before implementation
- [x] micro-plan exception not applicable（涉 deployment、依赖移除、多模块，full plan）
- [x] text consistency verified: status, phases, gates, testing document, and log all agree
- [x] closure audit was independent（subagent 或 human）
- [x] closure evidence exists in files

## Deferred But Adjudicated

### 重建无代理公网 URL 上传能力（COS/OSS）

- Classification: `out-of-scope improvement`
- Why Not Blocking Closure: 本计划关闭时多模态无代理时直接调用兼容接口、公网可访问 URL 即可工作；COS 上传类已无消费者。（现状补充：该"无代理直连"能力已随 `docs/plans/2026-08-18-remove-llm-dead-paths-plan.md` 移除，多模态现强制经 Python 视觉代理；本 Deferred 项改为重建直连或云端托管能力。）
- Successor Required: `no`
- Reopen Trigger: 若未来需要在无代理模式下对本地截图做云端托管（如容器内无 file:// 读取或需私有化上传），再重新引入 COS/OSS 存储类或直连路径。

### 集中化 env 契约清单（config schema / 文档单一来源）

- Classification: `optimization candidate`
- Why Not Blocking Closure: 本次清理后 env 集合与代码一致，尚无重复/废弃漂移；引入 schema 属结构性改造。
- Successor Required: `no`
- Reopen Trigger: 若 env 数量再次增长或出现新的别名/漂移，再评估集中 schema。

## Closure

Status Note: 环境变量清理已完整落地并通过仓库级与 Docker 验证；独立 closure audit 复核通过后关闭。

Closure Audit Evidence:

- Reviewer / Agent: 独立 subagent（闭包复核，task `ses_febf85d85ffeNJ97oy6Z1yo5in`）
- Evidence: 首轮 VERDICT reject closure——唯一阻塞为日志文件缺失（Phase 5 目标 `docs/logs/2026/08-18-env-var-cleanup.md` 未创建，closure gate「log all agree」被提前勾选）；其余 6 项验证（密钥单一化、COS 移除、文档对齐、.env 拆分、镜像职责、残留扫描）全部 PASS、无 scope 泄漏、历史文档未改动、Deferred 项正确非阻塞。日志已补齐后复核通过（见下）。
- 复核：日志文件已创建并含实施摘要/决策/验证结果；cold-replay 重查 plan 状态、阶段状态、退出标准、closure gates、testing 文档、log 全部一致后 VERDICT approve closure。

Follow-up:

- 用户若在外部部署中仅配置了 `DASH_SCOPE_API_KEY`，需改用 `DASHSCOPE_API_KEY`（README/.env.example 已唯一化）。