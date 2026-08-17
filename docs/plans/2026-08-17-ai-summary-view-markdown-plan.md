# 2026-08-17 AI 总结列表查看总结文档（Markdown 预览）实施计划

> Plan Status: complete
> Last Reviewed: 2026-08-17
> Source: 用户直接需求（2026-08-17 用户确认：后端统一替换图片链接；不处理 HTML `<img>`；docker 影响一并评估）
> Related: `docs/requirements/2026-08-17-ai-summary-view-markdown.md`
> Audit: required（reviewer availability = none → 非保护、非高风险计划用 cold-replay 自核并记录限制）
> Testing: `docs/testing/2026/08-17-ai-summary-view-markdown.md`

## Current Baseline

- `AiSummaryTaskRecord`（`database.service.ts`）已含 `summaryOutput`（成功时为 md 绝对路径，由 `analysis-trigger.service.ts` `upsertAiSummaryTask` 写入 `result.summaryPath`）。
- `AnalysisTriggerService.resolveSummaryDir`（`analysis-trigger.service.ts:602`）以 `resolve(process.cwd(), "summaryDir")` 为根拼目录，根路径目前只在该文件内联推导。
- md 生成：`document-generator.ts` `generateMarkdown` 产出 `![frameDescription](screenshots/<basename>)`（正斜杠相对路径）+ YAML frontmatter；无 HTML `<img>`。
- 静态资源：`main.ts:19` `app.useStaticAssets(publicDir)` 无前缀挂载；无摘要目录挂载。
- 单条详情端点模板：`analysis-task.controller.ts:99` `GET /summary-tasks/:id/raw-response`（校验 id → 查库 → 返回）。
- 前端：`AiSummaryTasks.tsx` 操作列现有"查看原始/重新总结/删除"；无 markdown 渲染库（`packages/frontend/package.json` 无相关依赖）；`vite.config.ts` 仅代理 `/api`；`assets/main.css` 仅 `@import "tailwindcss"`。
- 部署：Docker `WORKDIR /app`、前端 dist 拷贝到 `/app/public` 根路径挂载、健康检查只打 `/` 与 `/healthz`；摘要目录在容器内为 `/app/summaryDir`。

## Goals

- 后端把 `summary_output` 指向的 md 按需读取，将相对图片链接重写为 `/summary-files/…` 同源静态路径后返回。
- 前端 AI 总结任务列表操作列新增"查看总结"按钮，弹窗完整渲染 md（文字 + 插图）。

## Non-Goals

- 不处理 md 内容中的 HTML `<img>`（用户确认）。
- 不剥离/不解析 YAML frontmatter（仅做图片链接重写）。
- 不改 `generateMarkdown` / 不迁移数据库 / 不改 `summary_output` 存储语义。
- 不做编辑/下载/导出、图片懒加载/缩放查看器。
- 列表接口不新增字段；不引入"透传原始 HTML"能力（渲染保持默认转义）。

## Infrastructure And Config Prereqs

- 无新增环境变量/端口/外部服务；无数据库迁移/回滚脚本。
- 新增前端依赖 `react-markdown`、`remark-gfm`（需 `pnpm install` 更新 lockfile）。
- Docker：无 Dockerfile/entrypoint/端口/健康检查变更；`/summary-files` 为运行时新增同源静态挂载。验证命令 `pnpm docker:build` 用于证明镜像打包不受影响（容器运行级预览留人工确认或环境允许时执行）。

## Execution Plan

### Phase 1 - 后端：共享摘要目录常量 + 静态挂载 + markdown 查看端点

Status: completed
Targets: `packages/server/src/analysis/summary-dir.ts`（新增）、`packages/server/src/main.ts`、`packages/server/src/analysis/analysis-trigger.service.ts`、`packages/server/src/analysis/analysis-task.controller.ts`

- Item Types: `Decision | Add`
- Prereqs: 无

- [x] `Decision` 摘要根常量收敛：新增 `summary-dir.ts` 导出 `SUMMARY_BASE_DIR`（= `resolve(process.cwd(), "summaryDir")`）与 `SUMMARY_STATIC_PREFIX`（= `/summary-files`）；`resolveSummaryDir` 改用常量，`main.ts` 挂载与 markdown 端点共用同一来源。备选：保持三处各自推导（风险=后续目录调整漂移）；理由与选型一致。残差风险：低。
- [x] `Add` `main.ts`：`mkdirSync` 确保 `SUMMARY_BASE_DIR` 存在后 `app.useStaticAssets(SUMMARY_BASE_DIR, { prefix: `${SUMMARY_STATIC_PREFIX}/` })`；保留原有 `public` 挂载。
- [x] `Add` `analysis-task.controller.ts`：`GET /summary-tasks/:id/markdown`。校验：非法 id 400、记录不存在 404、状态非 `completed` 或 `summary_output` 空 409、文件读取失败 404；成功返回 `{ content }`。
- [x] `Add` 图片重写：独立纯函数（`summary-dir.ts`）`rewriteMarkdownImageUrls(content, mdDir)`——仅匹配 `![alt](url)`；绝对（`http(s)://`、`//`、`data:`）、根相对（`/` 开头）、锚点（`#` 开头）原样保留；相对路径规范化（剥离 `./`、`\`→`/`、`../` 段越界时放弃重写）后拼为 `/summary-files/<相对目录>/<url>`，各路径段 `encodeURIComponent` 编码。
- [x] `Add` 日志安全：无新增日志 key（复用既有 `summaryPath` 等白名单 key）。

Exit Criteria:

- [x] `/summary-files/<目录>/screenshots/xxx.jpg` 可直接访问；markdown 端点按契约返回重写后的内容，4 类 4xx 错误码正确（冒烟 1/2/3/4 覆盖）。
- [x] `resolveSummaryDir` 与挂载/端点共用同一根常量。
- [x] `pnpm --filter @bilibili-downloader/server typecheck` 通过。
- [x] 阶段无 owner-doc 变更需求，收尾统一同步。

### Phase 2 - 前端：依赖 + API + 弹窗渲染

Status: completed
Targets: `packages/frontend/package.json`、`packages/frontend/vite.config.ts`、`packages/frontend/src/api/index.ts`、`packages/frontend/src/pages/AiSummaryTasks.tsx`、`packages/frontend/src/assets/main.css`

- Item Types: `Decision | Add`
- Prereqs: Phase 1

- [x] `Decision` 渲染库选型：`react-markdown` + `remark-gfm`（React 原生组件、默认转义 HTML、无 innerHTML）。备选：`marked` + `DOMPurify`（需手动绑定 sanitizer），不选。残差风险：低。
- [x] `Add` 依赖：`pnpm --filter @bilibili-downloader/frontend add react-markdown remark-gfm`（lockfile 已更新）。
- [x] `Add` `vite.config.ts` proxy：`/summary-files` → `http://localhost:3100`（仅 dev）。
- [x] `Add` `api/index.ts`：`getAiSummaryTaskMarkdown(id): Promise<{ content: string }>`（`GET /summary-tasks/:id/markdown`）。
- [x] `Add` `AiSummaryTasks.tsx`：操作列新增"查看总结"按钮（仅 `completed` 可点击，其余禁用）；新增 modal 状态，打开时拉取 md，渲染 `<ReactMarkdown remarkPlugins={[remarkGfm]}>`；加载/错误态沿用"查看原始"modal 模式（文件缺失显示友好错误）。
- [x] `Add` `assets/main.css`：`.md-preview` 组件层样式（标题/段落/引用/图片 `max-w-full` 自适应等），复用 Tailwind `@layer components` 注入，未引第三方排版插件。

Exit Criteria:

- [x] "查看总结"按钮状态正确；弹窗完整渲染 md（文字 + 插图经 `/summary-files` 加载）；错误态不崩溃。
- [x] `pnpm typecheck`（含前端）通过。

### Phase 3 - 验证与文档收尾

Status: completed
Targets: 全部已改文件 + docs

- Item Types: `Proof`
- Prereqs: Phase 1-2

- [x] `Proof` `pnpm typecheck`、`pnpm build` 通过。
- [x] `Proof` API/静态冒烟（临时目录 + 一次性脚本）：`docs/testing/2026/08-17-ai-summary-view-markdown.md` 中 10 项自动化方向逐项 PASS（端点契约 + 5 类重写规则 + 非图片链接不受影响 + 非 ASCII 路径）+ 附加 8 项错误码/文件缺失/静态访问 PASS。
- [x] `Proof` Docker：`pnpm docker:build` 通过；镜像运行级冒烟 6 项 PASS（markdown 端点、静态图片、前端首页均正常，`/summary-files` 挂载未破坏 public）。
- [x] `docs/logs/2026-08-17-ai-summary-view-markdown.md` 记录；`docs/context/project-context.md` active requirement 更新；`docs/design/app-overview.md` Integration Points 同步；`docs/testing/2026/08-17-ai-summary-view-markdown.md` 填写结果并裁定人工项。

Exit Criteria:

- [x] 验证命令通过；测试文档各项确认/裁定；docs 一致。

## Plan Audit

- Status: passed
- Reviewer / Agent: cold-replay proxy（reviewer availability = none）
- Evidence: 见下方 Cold-Replay 计划自核（2026-08-17 实施前执行并写入本节）。

## Closure Gates

- [x] in-scope 行为完整（静态挂载 + markdown 端点 + 图片重写 + 查看总结按钮与弹窗渲染）
- [x] 相关 docs 对齐（requirement/testing/logs/project-context/app-overview）
- [x] 验证已运行：`pnpm typecheck`、`pnpm build` + API 冒烟 18 项 + `pnpm docker:build` + 容器运行级冒烟 6 项
- [x] `docs/testing/` 每项方向已确认或裁定
- [x] 无 in-scope 项降级
- [x] 计划审计通过（cold-replay 已记录）
- [x] 实际 diff 未超限或已重新分类审计（改动 9 个代码/配置文件 + 2 个新增服务端文件 + 新增前端依赖；跨服务端/前端/部署验证，按完整计划流程执行并已审计）
- [x] 文本一致性：状态/阶段/门禁/测试文档/日志一致
- [x] 闭核算独立（cold-replay proxy 已记录）
- [x] 关闭证据在文件中

## Deferred But Adjudicated

### 图片查看器能力（懒加载/缩放/灯箱）

- Classification: `out-of-scope improvement`
- Why Not Blocking Closure: 用户本轮仅要求"完整预览文档"，弹窗渲染 + 图片可加载已满足；查看器属后续增强。
- Successor Required: `no`

### YAML frontmatter 剥离

- Classification: `in-scope（2026-08-17 追加，已实施）`
- Why Not Blocking Closure: 原计划按用户"仅替换图片链接"指令将其列为 out-of-scope；后续用户确认改为"服务端剥离元数据、前端仅渲染"（需求决策 #4），作为同特性增量已实施完成：`extractSummaryMeta()` 剥离 frontmatter 并提取 4 键 meta，端点返回 `{ content, meta }`，前端渲染元数据条。契约与决策口径均已在 requirement/testing/app-overview/logs 同步。
- Successor Required: `no`

## Closure

Status Note: 实施完成（2026-08-17）。所有 Phase 1-3 均完成；`pnpm typecheck`、`pnpm build` 通过；API/静态冒烟 18 项全部通过；`pnpm docker:build` 通过且容器运行级冒烟 6 项全部通过（详见 `docs/testing/2026/08-17-ai-summary-view-markdown.md`）。

Closure Audit Evidence:

- Reviewer / Agent: cold-replay proxy（reviewer availability = none；非保护、非高风险计划，部署无制品变更，仅新增运行时同源挂载并已验证）。冷重放要点：
  - 行为完整性：`cwd/summaryDir` 共享常量收敛 + `/summary-files` 静态挂载 + `GET /api/summary-tasks/:id/markdown`（400/404/409/409/404 契约）+ 5 类图片重写规则 + 非图片链接不受影响；前端"查看总结"按钮（仅 `completed`）+ 弹窗渲染 + 加载/错误态，全部经冒烟覆盖。
  - 相关 docs 已对齐：requirement（未变更契约）、app-overview（Integration Points 新增 markdown 端点与 `/summary-files` 挂载行、工作流第 9 步）、logs 记录、project-context 更新 active requirement、testing 文档记录自动化结果并裁定人工项。
  - 验证已运行：`pnpm typecheck`、`pnpm build` + API/静态冒烟（临时目录隔离）+ `pnpm docker:build` + 容器运行级冒烟。
  - 无 in-scope 项降级；非目标未越界（未处理 HTML `<img>`、未剥离 frontmatter、未改生成器/数据库、列表接口未加字段、未加图片查看器）。
  - 文本一致性：本文件状态/阶段/门禁与 testing 文档、logs 一致。
  - 实现期记录：`summary-dir.ts` 的根常量在模块加载时求值 `resolve(process.cwd(), "summaryDir")`，与 `resolveSummaryDir` 原行为（每次调用时求值）等价，无运行时 cwd 变更场景，漂移风险消除。

Follow-up:

- 无（当前无确认缺陷）。
- 人工运行级确认：前端 UI 层弹窗渲染与浏览器 Network 面板 `/summary-files` 加载确认沿用 testing 文档留待用户执行。
- 同特性增量记录（2026-08-17，用户确认）：服务端剥离 frontmatter + 提取 meta（`{ content, meta }`）、前端元数据条渲染、弹窗全屏、插图点击大图——均已实施并纳入 requirement/testing/app-overview/logs，详见 `docs/requirements/2026-08-17-ai-summary-view-markdown.md`。

---

## Cold-Replay 计划自核（实施前）

执行方式：按 reviewer 视角重放计划（不依赖实施记忆），核对范围/契约/风险与 live repo 是否一致。

- [x] 基线 inventory 与 live repo 一致（已逐一读取 document-generator / analysis-engine / trigger-service / analysis-task.controller / main / frontend AiSummaryTasks / api / vite / package.json / Dockerfile / entrypoint）。
- [x] 数据模型零改动；token：本次不触碰 auth/payment/data-deletion；部署参考面：未修改 Dockerfile/entrypoint/端口/环境变量，仅新增运行时同源挂载并通过 `pnpm docker:build` + 运行级预览验证，符合 cold-replay 非保护适用条件（疑问在计划与需求文档中明确写出）。
- [x] 决策项均有理由与备选：根常量收敛（备选：三处内联推导，漂移风险）；后端重写图片链接（备选：imageBaseUrl 前端重写/后端 base64 内联，前者职责分散、后者载荷膨胀）；react-markdown（备选：marked+DOMPurify）；frontmatter 不剥离（备选：服务端剥离或 remark-frontmatter 解析，均超出"仅替换图片链接"的用户指令）。
- [x] 计划范围内无 micro-plan 豁免（改动 >5 文件、跨服务器/前端/部署验证、新增 API 契约与依赖），必须完整审计流程。
- [x] 关闭门禁与验证命令来自 project-context 真实命令（`pnpm typecheck`、`pnpm build`、`pnpm docker:build`）与用户明确要求（docker 影响评估）。
- [x] 计划未引入未在需求中声明的行为；非目标明确写出（不处理 HTML img、不剥离 frontmatter、列表接口不加字段）。
- 结论：计划审计 PASS（cold-replay proxy，reviewer availability = none；限制：非独立 reviewer，适用于非保护/非高风险计划）。