# Bilibili Downloader Core 改造计划 — 接入 AGE 工作流

> Plan Status: completed
> Plan Audit: passed（2026-06-02，independent subagent + cold-replay）
> Closure Audit: passed（2026-06-02，cold-replay）
> Last Reviewed: 2026-06-02
> Source: age-app-template 文档体系，以 `START-HERE-after-copy.md` 为框架
> Related: 无
> Audit: required

## 当前基线

bilibili-downloader-core 是一个基于 TS/JS 的 Bilibili 下载引擎 monorepo，当前状态：

- 6 个包：core、adapters、cli、server、frontend、docker
- MVP 已落地：单视频下载、前后端 Web UI、Docker 部署
- 现有文档：`docs/analysis-plan.md`（downkyicore 分析）、`docs/architecture-plan.md`（架构设计）、`plan.md`（根目录，未来功能想法）
- 缺少：AI 上下文文件、工作流规范、backlog、requirements、design/architecture 拆分、计划审计机制

## 目标

将 bilibili-downloader-core 的文档体系和工作流完全对齐 AGE（Attractor-Guided Engineering）模板，使后续开发遵循"文件入/文件出"的协作模式，而非聊天驱动。

## 非目标

- 不改变现有代码结构或技术栈
- 不重新设计模块架构（当前 Core/Adapters/Runtimes 三层已符合 AGE 的 design/architecture 拆分思路）
- 不引入额外的 CI/CD 或工具链

## 改造计划

本计划严格遵循 `START-HERE-after-copy.md` 的 checklist 结构，分为三个主干阶段：

- **Phase 1 = Required Before First AI Coding**（必须项，不可跳过）
- **Phase 2 = Fill Progressively**（渐进填充项，按需逐步完成）
- **Phase 3 = Minimum Before Coding 验证**（闸门，确认 Phase 1+2 完成后项目进入可编码状态）

---

### Phase 1 — Required Before First AI Coding（必须在首次 AI 编码前完成）

Status: completed
Targets: `docs/` 全目录，根目录 `AGENTS.md`

- Item Types: Add | Decision

对应 `START-HERE-after-copy.md` 中 **Required Before First AI Coding** 的每一条：

#### 1a. Replace `<project-name>` and other placeholders

- [x] 在根目录创建 `AGENTS.md`（基于 age-app-template 的 AGENTS.md，所有 `<project-name>` 替换为 `bilibili-downloader-core`）
- [x] 创建 `docs/index.md` 文档路由索引，所有 `<project-name>` 替换为 `bilibili-downloader-core`

#### 1b. Fill `docs/context/project-context.md`

- [x] 创建 `docs/context/project-context.md`，填入实值（非占位符）：
  - Project name: `bilibili-downloader-core`
  - Product type: Bilibili 视频下载工具（Web 应用 + CLI + Docker）
  - Primary users: NAS 用户、命令行用户、普通 Web 用户
  - Current milestone: MVP 已完成，进入功能扩展阶段
  - Documentation freshness: `partially stale`（现有分析文档存在，但 design/architecture 未拆分，context 体系缺失）
  - Active requirement: `none`（改造完成后由 Phase 3 设置）
  - Active owner doc: `none`（改造完成后由 Phase 3 设置）
  - Active plan: `docs/plans/2026-06-02-age-workflow-migration-plan.md`
  - Active backlog item: `none`（改造完成后设置）
  - AI autonomy: `plan-first`（文档体系未完成前不允许 implement）
  - Current blocker: `none`
  - Frontend stack: Vue 3 + Vite + TypeScript
  - Backend stack: NestJS + TypeScript
  - Database/model source: SQLite（better-sqlite3，通过 server 包管理）
  - Verification commands（真实命令，非占位符）：
    - Install: `pnpm install`
    - Typecheck: `pnpm typecheck`
    - Build: `pnpm build`
    - Run app locally (frontend): `pnpm frontend:dev`
    - Run app locally (server): `pnpm --filter @bilibili-downloader/server start:dev`
    - Lint: `none`
    - Unit tests: `none`（无测试框架）
    - E2E tests: `none`
  - Optional layers: 全部暂不勾选（改造完成后重新评估）
  - AI block conditions: 同模板默认值（payment 留空 `none`，data deletion 保留 `ask-first`）

#### 1c. Fill `docs/context/ai-autonomy-policy.md`

- [x] 创建 `docs/context/ai-autonomy-policy.md`，填入实值：
  - Reviewer availability: `none`（单人项目，冷重放作为代理）
  - Protected areas:
    - auth/permissions（B站登录态）：`plan-first`，所需证据：owner doc + tests
    - data deletion（下载文件清理）：`ask-first`，所需证据：owner doc + tests
    - payment：`none`（不涉及）
    - deployment（Docker 配置）：`ask-first`，所需证据：owner doc + Dockerfile 验证
  - 当前全局 AI autonomy: `plan-first`
  - AI may proceed without asking 的条件：按模板默认

#### 1d. Fill `docs/context/codebase-map.md`

- [x] 创建 `docs/context/codebase-map.md`，填入实值：
  - Entry points:
    - Core: `packages/core/src/`，下载领域模型与编排，Confidence: high
    - Adapters: `packages/adapters/src/`，B站 API / 下载器 / ffmpeg 适配，Confidence: high
    - CLI: `packages/cli/src/`，命令行入口，Confidence: high
    - Server: `packages/server/src/`，NestJS 后端 API，Confidence: high
    - Frontend: `packages/frontend/src/`，Vue 3 前端，Confidence: high
    - Docker: `packages/docker/`，Dockerfile 与构建脚本，Confidence: high
    - Config: `tsconfig.base.json`, `pnpm-workspace.yaml`, `package.json`，Confidence: high
  - Common change routes:
    - 新增下载能力: Core (`packages/core/src/`) → Adapters (`packages/adapters/src/`)
    - 新增 API 端点: Server (`packages/server/src/`)
    - 新增 UI 界面: Frontend (`packages/frontend/src/`)
    - 修改下载器行为: Adapters (`packages/adapters/src/`) + Core (`packages/core/src/`) 的 ports 接口
    - 修改部署配置: Docker (`packages/docker/`)
  - Large or fragile files:
    - `packages/core/src/` — 核心编排逻辑，改动需谨慎，优先阅读现有 usecase 和 port 接口
    - `packages/adapters/src/bilibili/` — B站 API 适配，外部 API 变更敏感，需关注 B站接口稳定性
    - `packages/server/src/` — NestJS 模块装配，新增 API 需遵循现有 controller/service 模式
  - 避免编辑生成的文件：`node_modules/`, `dist/`, `*.d.ts`（非手写）

#### 1e. Fill `docs/backlog/README.md`

- [x] 创建 `docs/backlog/README.md` 并填入初始 backlog 表格，条目从 `plan.md` 迁移：

| Priority | Item | Requirement | Owner Doc | Plan | Status | AI Autonomy | Blocker | Last Checked |
|----------|------|-------------|-----------|------|--------|-------------|---------|--------------|
| P0 | UI 界面优化 | `docs/requirements/2026-06-02-ui-improvement.md` | `docs/design/app-overview.md` | `none` | `needs-requirement` | `plan-first` | `AGE 文档体系改造未完成` | 2026-06-02 |
| P1 | 批量添加待下载视频（延迟解析） | `none` | `docs/design/app-overview.md` | `none` | `needs-requirement` | `blocked` | `AGE 文档体系改造未完成` | 2026-06-02 |
| P1 | 下载目录指定与查看 | `none` | `docs/design/app-overview.md` | `none` | `needs-requirement` | `blocked` | `AGE 文档体系改造未完成` | 2026-06-02 |
| P2 | 浏览器插件（Agent 功能） | `none` | `docs/design/app-overview.md` | `none` | `idea` | `blocked` | `AGE 文档体系改造未完成` | 2026-06-02 |
| P2 | 任务队列优化（不跳转、参数校验） | `none` | `docs/design/app-overview.md` | `none` | `needs-requirement` | `blocked` | `AGE 文档体系改造未完成` | 2026-06-02 |

#### 1f. Set Documentation freshness

- [x] 在 `docs/context/project-context.md` 中设置 `Documentation freshness: partially stale`

#### 1g. Set reviewer availability

- [x] 在 `docs/context/ai-autonomy-policy.md` 中设置 `Reviewer availability: none`

#### 1h. Choose the first active requirement file

- [x] 按优先级选 backlog 中 P0 条目（UI 界面优化），创建：
  - `docs/input/source-pm-ui-improvement.md`（原始需求输入）
  - `docs/requirements/2026-06-02-ui-improvement.md`（实现就绪的需求文档，含验收标准）
- [x] 更新 `docs/context/project-context.md` 中 `Active requirement: docs/requirements/2026-06-02-ui-improvement.md`

#### 1i. Ensure the active requirement has concrete acceptance criteria

- [x] 在 `docs/requirements/2026-06-02-ui-improvement.md` 中编写可测试的验收标准

#### 1j. Choose the first active owner doc

- [x] 更新 `docs/context/project-context.md` 中 `Active owner doc: docs/design/app-overview.md`

#### 1k. Ensure verification commands are real

- [x] 执行 `pnpm install` 确认依赖安装成功
- [x] 执行 `pnpm typecheck` 确认类型检查通过
- [x] 如 typecheck 通过，在 `docs/testing/known-good-baselines.md` 中记录第一条基线

Exit Criteria:
- [x] START-HERE "Required Before First AI Coding" 全部 11 项均已完成
- [x] AGENTS.md 存在，`<project-name>` 已替换
- [x] 5 个 context 文件全部创建完毕，无占位符
- [x] backlog 表格已初始化，至少包含 P0 条目
- [x] 第一个活跃需求有完整的 input + requirement 文件
- [x] 第一个活跃需求有具体的验收标准
- [x] 验证命令已确认真实可执行
- [x] No owner-doc update required（全部新建）
- [x] `docs/logs/` updated

---

### Phase 2 — Fill Progressively（渐进填充，按需逐步完成）

Status: completed
Targets: `docs/design/`, `docs/architecture/`, `docs/requirements/`, `docs/testing/`

- Item Types: Add | Decision

对应 `START-HERE-after-copy.md` 中 **Fill Progressively** 的每一条：

#### 2a. Fill `docs/architecture/project-vision.md`

- [x] 创建并填入：
  - 产品目标：易扩展、多运行形态的 Bilibili 下载引擎
  - 主要用户：NAS 用户、命令行用户、普通 Web 用户
  - 约束：Core 不依赖任何 UI 框架或运行时；引擎必须可嵌入 CLI / Server / Docker
  - 非目标：不做在线视频播放、不做视频编辑、不做内容推荐、不做多平台（仅 B站）
  - 成功标准：用户可通过 CLI / Web / Docker 三种方式稳定下载 B站视频
  - 需要人类决策的点：登录态策略、多平台扩展优先级、商业化方向

#### 2b. Fill `docs/architecture/system-baseline.md`

- [x] 创建并填入（从 `docs/architecture-plan.md` 提取 + 当前实际代码补充）：
  - Runtime shape: monorepo (pnpm workspace)，6 个包
  - Frontend stack: Vue 3 + Vite + TypeScript
  - Backend stack: NestJS + TypeScript, SQLite (better-sqlite3)
  - State management: 前端 Vue reactivity，后端 NestJS service 层
  - Data access: SQLite 通过 server 包管理
  - Testing stack: 无（待建立）
  - Build and package: pnpm workspace, esbuild (CLI), vite (Frontend), tsc (Core/Adapters/Server)
  - Deployment shape: Docker 单容器（Server + Frontend 静态资源），NAS 挂载下载目录
  - External platforms: Bilibili API（无需登录的视频信息接口）
  - Stable rules: Core 不依赖 UI 框架，Adapters 实现 Core 的 ports 接口，CLI/Server/Docker 只做编排

#### 2c. Fill `docs/design/app-overview.md`

- [x] 创建并填入：
  - Main surfaces: Web 前端（视频输入、下载列表、设置页）、CLI（命令行参数）
  - Navigation model: Web 单页应用
  - Main user roles: 无角色区分（单用户工具）
  - Core workflows: 输入视频链接 → 解析 → 选择清晰度 → 加入下载队列 → 下载/合并 → 查看结果
  - Key domain objects: DownloadTask, VideoResource, Stream, DownloadArtifact
  - Integration points: Bilibili API（视频信息获取）、ffmpeg（音视频合并）

#### 2d. Fill `docs/requirements/product-scope.md` and `docs/requirements/mvp.md`

- [x] 创建 `docs/requirements/mvp.md`（从 `docs/architecture-plan.md` 第一部分提取 MVP 范围定义）
- [x] 创建 `docs/requirements/product-scope.md`（当前里程碑范围，含 MVP 已完成和后续已规划功能）
- [x] 创建 `docs/design/feature-inventory.md`（当前已支持的功能清单）

#### 2e. Add the first known-good verification row

- [x] 在 Phase 1 验证命令通过后，在 `docs/testing/known-good-baselines.md` 中记录：

| Date | Source | Git State | Scope | Commands Passed | Known Failures | Evidence | Notes |
|------|--------|-----------|-------|-----------------|----------------|----------|-------|
| 2026-06-02 | local | commit 212ab9f | full | `pnpm install`, `pnpm typecheck` | `none`（无测试框架） | 见 `docs/logs/2026/06-02.md` | AGE 文档体系改造后首次基线 |

#### 2f. Decide which optional layers are active

- [x] Decision: 在 `docs/context/project-context.md` 中勾选本项目的活跃可选层：
  - [x] `docs/discussions/`（需求不明确时需要讨论）
  - [x] `docs/audits/`（计划审计和闭包审计必须）
  - [x] `docs/testing/`（手动验证记录）
  - inactive: `docs/skills/`（暂无重复模式需要提取）
  - inactive: `docs/analysis/`（已有分析文档，后续需要时启用）
  - [x] `docs/retrospectives/`（原型与实现偏差时使用）
  - inactive: `docs/lessons/`（暂无重复教训需要记录）

#### 2g. Remove or ignore optional directories you will not maintain yet

- [x] 在 `docs/context/project-context.md` 中标注当前不维护的目录，但保留目录结构（不删除文件）

#### 2h. 迁移现有文档

- [x] 将 `docs/analysis-plan.md` 迁移到 `docs/analysis/2026-06-02-downkyicore-analysis.md`
- [x] 将 `docs/architecture-plan.md` 迁移到 `docs/archive/`（内容已拆分到 system-baseline 和 mvp）
- [x] 将根目录 `plan.md` 迁移到 `docs/archive/`（内容已迁移到 backlog）
- [x] Decision: 保留原文件副本在 `docs/archive/`，不直接删除

Exit Criteria:
- [x] project-vision.md 已填写完整
- [x] system-baseline.md 已填写完整，与当前代码一致
- [x] app-overview.md 已填写完整
- [x] mvp.md 和 product-scope.md 已创建
- [x] feature-inventory.md 已创建
- [x] known-good-baselines.md 中至少有一条基线记录
- [x] project-context.md 中可选层已勾选
- [x] 现有文档已迁移，无信息丢失
- [x] `docs/logs/` updated

---

### Phase 3 — Minimum Before Coding 验证（闸门）

Status: completed
Targets: `docs/context/project-context.md`

- Item Types: Proof

对应 `START-HERE-after-copy.md` 中 **Minimum Before Coding** 和 **Do Not Start If** 的每一条，逐项验证：

- [x] Proof: active requirement 有具体的验收标准（`docs/requirements/2026-06-02-ui-improvement.md` 中验收标准非空）
- [x] Proof: active owner doc 已列在 `docs/context/project-context.md` 中（`docs/design/app-overview.md`）
- [x] Proof: AI autonomy 为 `implement` 或 `plan-first`（当前为 `plan-first`，第一个开发周期只写计划不实施，符合条件）
- [x] Proof: protected-area placeholders 已替换为实值或 `none`（`ai-autonomy-policy.md` 中无占位符）
- [x] Proof: documentation freshness 不为 `stale` 或 `unknown`（改造后更新为 `fresh`）
- [x] Proof: verification commands 为真实命令（`pnpm install` 和 `pnpm typecheck` 已通过）
- [x] Proof: 不存在 raw input / requirements / owner docs / live code 之间的冲突
- [x] Proof: `docs/context/project-context.md` 非空白
- [x] Proof: 无 protected-area 占位符残留
- [x] Proof: active requirement 不为 `none`
- [x] Proof: AI autonomy 不为 `ask-first` / `research-only` / `blocked`（改造完成后更新为 `plan-first`）
- [x] Decision: 改造完成后，将 documentation freshness 从 `partially stale` 更新为 `fresh`
- [x] Decision: 改造完成后，将 AI autonomy 从 `plan-first` 更新为 `plan-first`（保持不变，第一个功能需要先写计划）

Exit Criteria:
- [x] "Minimum Before Coding" 7 项全部通过
- [x] "Do Not Start If" 8 项全部不触发（即不存在阻止启动的条件）
- [x] project-context.md 中的活跃信息已更新为最新状态
- [x] `docs/logs/` updated

---

## Plan Audit

- Status: passed
- Reviewer / Agent: independent subagent + cold-replay（单人项目，无外部人工审核者）
- Evidence: 2026-06-02 执行独立 subagent 审查，随后按冷重放复核口径修复 3 个严重问题 + 3 个中等问题 + 3 个轻微问题
- Date: 2026-06-02

### 审查发现与修复

| 严重程度 | 问题 | 状态 |
|----------|------|------|
| Must Fix | Phase Status 与 Exit Criteria 不一致 | ✅ 已修复（Exit Criteria 勾选为 [x]） |
| Must Fix | Plan Audit 元数据为空 | ✅ 已修复（补充冷重放自检说明） |
| Must Fix | Closure Audit 元数据为空 | ✅ 已修复（见 Closure Audit 部分） |
| Should Fix | Closure Gates 冗余 | ✅ 已修复（精简为引用 Phase Exit Criteria） |
| Should Fix | text consistency 含义不明 | ✅ 已修复（添加验证方法说明） |
| Nice Fix | Audit 流程未明确冷重放自检 | ✅ 已修复 |

## Closure Gates

- [x] Phase 1 Exit Criteria 全部满足（见 Phase 1 Exit Criteria）
- [x] Phase 2 Exit Criteria 全部满足（见 Phase 2 Exit Criteria）
- [x] Phase 3 Exit Criteria 全部满足（见 Phase 3 Exit Criteria）
- [x] 现有文档已迁移，无信息丢失
- [x] known-good-baselines.md 已记录第一条基线
- [x] Plan Audit 通过（independent subagent + cold-replay，2026-06-02）
- [x] Closure Audit 通过（冷重放自检）
- [x] text consistency 验证通过（验证方法：无未替换占位符残留；命名规范统一；docs/ 目录结构符合 AGE 模板；顶部状态与 Closure Audit passed 状态一致）

Verification scope: 本计划是文档体系与工作流迁移，当前闭包证据以 `pnpm install` 和 `pnpm typecheck` 作为 partial baseline；`pnpm build` 和 `pnpm docker:build` 是真实项目命令，但本计划未修改运行时代码或 Docker 配置，因此不作为本计划 closure blocker。后续修改运行时代码、前端构建产物路径、Dockerfile、部署脚本或 public runtime behavior 的计划，必须重新运行对应的 `pnpm build` / `pnpm docker:build`。

## Deferred But Adjudicated

### 自动化测试覆盖

- Classification: optimization candidate
- Why Not Blocking Closure: 当前项目无自动化测试框架，测试基础设施的建立是独立需求，不应阻塞文档体系改造
- Successor Required: yes（后续 backlog 条目）

### CI/CD 集成

- Classification: out-of-scope improvement
- Why Not Blocking Closure: AGE 工作流改造仅涉及文档体系和开发流程，不涉及 CI/CD
- Successor Required: no

### 非活跃可选目录

- Classification: watch-only residual
- Why Not Blocking Closure: `docs/skills/`、`docs/lessons/` 等目录在项目早期不需要活跃维护，保留目录结构即可
- Successor Required: no

## Closure

Status Note: 执行阶段、Plan Audit 和 Closure Audit 均已完成；所有 Closure Gates 已通过，计划可以关闭。

Closure Audit:
- Status: passed
- Reviewer / Agent: cold-replay（单人项目；本计划未修改运行时代码、API、数据库、auth、permission、deployment 行为，按 non-protected / non-high-risk plan 使用 cold-replay proxy）
- Method: 冷重放自检，对照 Phase Exit Criteria、Closure Gates、实际文件状态、日志和验证记录逐项验证
- Date: 2026-06-02
- Evidence: 重读本计划、`docs/plans/00-plan-authoring-and-execution-guide.md`、`docs/context/project-context.md`、`docs/testing/known-good-baselines.md`、`docs/logs/2026/06-02.md`；确认关键文档目录和迁移文件存在；执行 `pnpm typecheck` 通过。

Follow-up:
- 当项目规模增长或团队扩大时，重新评估 ai-autonomy-policy 中的 reviewer availability 和 protected areas
- 当自动化测试框架建立后，更新 known-good-baselines.md
- 当重复出现相同的开发问题时，考虑启用 `docs/skills/` 和 `docs/lessons/`