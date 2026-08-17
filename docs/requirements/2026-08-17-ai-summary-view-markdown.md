# 2026-08-17 AI 总结列表查看总结文档（Markdown 预览）

## Source

- Owner Doc: `docs/design/app-overview.md`
- Related Requirement: `docs/requirements/2026-08-12-ai-summary-raw-record-and-retrigger.md`（"查看原始"按钮与 raw-response 端点，本需求沿用其模式）
- Related Requirement: `docs/requirements/2026-08-03-download-task-list-ai-summary.md`
- Live Baseline:
  - `packages/server/src/analysis/document-generator.ts`（`generateMarkdown` 生成 md，图片链接为相对路径 `screenshots/<basename>`，全文使用正斜杠；含 YAML frontmatter）
  - `packages/server/src/analysis/analysis-engine.ts`（把 md 写入 `summaryDir/<sanitizeTitle>-summary.md`）
  - `packages/server/src/analysis/analysis-trigger.service.ts`（`resolveSummaryDir` 以 `resolve(process.cwd(), "summaryDir")` 为根）
  - `packages/server/src/analysis/analysis-task.controller.ts`（`GET /api/summary-tasks/:id/raw-response` 为单条详情拉取端点模板）
  - `packages/server/src/main.ts`（已有 `app.useStaticAssets(publicDir)` 无前缀挂载）
  - `packages/frontend/src/pages/AiSummaryTasks.tsx`（操作列现有：查看原始 / 重新总结 / 删除）
  - `packages/frontend/src/api/index.ts`、`packages/frontend/vite.config.ts`（dev 仅代理 `/api`）

## Problem

1. AI 总结完成后生成的 Markdown 文档（含截图插图）只落地磁盘，`ai_summary_task.summary_output` 仅存绝对路径，前端没有任何入口查看渲染后的文档内容。
2. md 内插图是相对路径（相对 md 所在目录），浏览器直接渲染时图片无法加载，无法"完整预览"。

## Goal

- AI 总结任务列表操作列新增"查看总结"按钮，点击后在弹窗中完整预览对应的 Markdown 总结文档（文字 + 插图均可显示）。

## 已确认的产品决策（用户确认，2026-08-17）

1. 图片处理方式：**后端读取 md 文件，把相对图片链接统一替换为可访问的绝对静态路径后，将改动后的 md 文档内容返回前端**；前端拿到后直接渲染，不做图片路径二次处理。
2. **不处理内容中的 HTML `<img>` 标签**（本需求只处理 Markdown 图片语法 `![alt](url)`；当前生成器只产出该语法）。
3. 需要一并评估并验证该改动对 **Docker 镜像打包与使用** 的影响（见下方"部署影响"）。
4. frontmatter 处理方式：**服务端剥离 YAML frontmatter 并提取结构化元数据（title / video_url / model / created_at），随返回内容一并下发；前端仅负责把 meta 渲染成元数据条**（正文不再出现 `---`/`key: value` 原文行）。

## In Scope

- 后端新增统一摘要目录常量（根目录 = `cwd/summaryDir`，与 `AnalysisTriggerService.resolveSummaryDir` 同一根源），供静态挂载、触发服务、详情端点共用，消除重复推导。
- 后端在现有静态挂载基础上新增 `summary-files` 前缀静态挂载，作用于摘要目录。
- 新增 `GET /api/summary-tasks/:id/markdown`：按需读取 md，**剥离头部 YAML frontmatter 并提取元数据**（title / video_url / model / created_at），图片相对链接统一重写后返回 `{ content, meta }`（单条拉取，列表接口载荷不变）。
- 前端 `AiSummaryTasks.tsx` 操作列新增"查看总结"按钮，弹窗顶部渲染元数据条（B站原视频链接 / 模型 / 生成时间），下方渲染正文（图片经静态前缀可正常加载，支持点击查看大图与全屏）。
- 前端 dev 代理补充 `/summary-files` 前缀。
- 前端引入 Markdown 渲染方案并在摘要弹窗内提供基础排版样式。
- 部署影响评估与验证（Docker 镜像构建/运行不受影响或按需修正）。

## Out Of Scope

- 不处理 md 内容中可能出现的 HTML `<img>`（用户确认）。
- 不解析元数据之外的 YAML 内容（仅识别 4 个已知键；未知键忽略）。
- 不改变 `summary_output` 的存储语义（仍为绝对路径）、不迁移数据库、不改 `generateMarkdown` 生成逻辑；md 磁盘文件保持原样（含 frontmatter），剥离仅发生在接口返回层。
- 不做 md 编辑/下载/导出；图片查看器能力以 antd `<Image>` 预览为准（点击大图/缩放/旋转）。
- 不为列表接口新增字段（按钮可用性由 `status === "completed"` 判断）。
- 不新增 markdown 渲染安全透传 HTML 的能力（保持默认转义，杜绝 XSS）。

## User Flows

### Flow 1: 查看总结

1. 用户进入 AI 总结任务列表页，某条 `completed` 记录行"操作"列显示"查看总结"按钮（`pending` / `analyzing` / `failed` 禁用）。
2. 用户点击"查看总结"。
3. 前端调用 `GET /api/summary-tasks/:id/markdown`；弹窗展示加载态。
4. 服务端读取该记录 `summary_output` 指向的 md 文件，剥离头部 frontmatter 并提取元数据，将正文中 `![alt](相对路径)` 图片链接重写为 `/summary-files/…` 绝对静态路径，返回 `{ content, meta }`。
5. 弹窗顶部渲染元数据条（B站原视频链接 / 模型 / 生成时间），下方渲染 Markdown 正文：标题、段落、引用、插图正常显示；插图从静态资源前缀加载，点击可查看大图。
6. 文件已缺失（磁盘被删）时弹窗显示友好错误，不崩溃。

## API Contract

### 新增：`GET /api/summary-tasks/:id/markdown`

- `id` 必须为正整数；非法 id 返回 HTTP 400（`无效的任务 ID`）。
- 记录不存在返回 HTTP 404（`AI 总结任务不存在`）。
- 记录状态非 `completed` 或 `summary_output` 为空返回 HTTP 409（`仅已完成的 AI 总结可查看总结文档` / `该总结无输出文档`）。
- 磁盘文件不存在返回 HTTP 404（`总结文档不存在或已被删除`）。
- 成功返回 HTTP 200：`{ "content": "<剥离 frontmatter 后的 md 正文，图片链接已重写>", "meta": { "title"?, "videoUrl"?, "model"?, "createdAt"? } }`。
- frontmatter 剥离与 meta 提取规则：
  - 仅处理文档开头 `---\n…\n---` 块；frontmatter 缺失或格式畸形时 `meta` 为空对象 `{}`、`content` 原样返回（不剥离不报错）。
  - 只识别 `title` / `video_url` / `model` / `created_at` 四个键；值按 JSON 字符串解析（`JSON.parse` 还原引号与转义），解析失败则跳过该键；未知键忽略。
  - `video_url` → `meta.videoUrl`，`created_at` → `meta.createdAt`。
- 图片重写规则：
  - 仅处理 Markdown 图片语法 `![alt](url)`。
  - `url` 已是绝对地址（`http(s)://`、`//`、`data:`）、根相对（`/` 开头）或锚点（`#` 开头）时原样保留。
  - 相对 `url` 基于 md 文件所在目录计算，统一重写为 `/summary-files/<相对摘要根目录>/<url 规范化后>`（同源相对 URL，与页面/代理同源，天然适配反代前缀）；`\` 归一为 `/`；`./` 前缀剥离；`../` 穿越摘要根目录时放弃重写（原样保留，避免把任意磁盘路径映射为公网 URL）。
  - 输出的 URL 各路径段做 URL 编码（兼容非 ASCII 标题/目录名）。

## Business Rules

- 列表视图不携带 md 内容（载荷隔离），内容仅按需单条获取。
- 按钮可用性：仅 `completed` 显示且可点击；其余状态禁用。
- 重写/剥离后的内容仅用于预览渲染，**不改写磁盘文件、不入库**（磁盘 md 保留原始 frontmatter 与相对路径）。
- 元数据条按字段缺失分别隐藏（仅渲染存在的字段）；全部缺失时不渲染元数据条。

## Edge Cases

- 目录/标题含中文或空格：摘要目录常量与 URL 编码处理，静态挂载与重写均兼容。
- 空总结（`segmentCount = 0`）：md 仍有标题与 frontmatter，meta 正常提取，正文可渲染。
- 图片文件本身缺失：`<img>` 加载失败显示裂图 alt 文案，页面不崩溃。
- frontmatter 缺失 / 损坏（不以 `---` 开头、无结束行、值非合法 JSON 字符串）：`meta = {}`、正文原样透传，接口不报错。
- 记录 `completed` 但磁盘文件被删：端点 404，前端显示友好提示。
- 多人/多次刷新重复打开弹窗：每次点击按需拉取最新内容（不做缓存承诺）。
- LLM 生成内容含外部图片绝对链接：原样保留并渲染（外部可访问性由网络决定）。

## Open Questions

- 无（图片重写方向、不处理 HTML 图片、docker 一并评估均已由用户确认）。

## Deployment Impact（部署影响评估，2026-08-17）

- **Dockerfile / entrypoint：无需改动。** 摘要目录 `summaryDir` 在容器内为 `cwd/summaryDir`（`WORKDIR /app`，`/app/summaryDir`），静态挂载是运行时 NestJS 配置，不涉及镜像分层、端口、环境变量或健康检查变更。
- 前端构建产物已拷贝至 `/app/public` 并在根路径挂载；新增的 `/summary-files` 是第二条同源挂载前缀，浏览器同源访问，无需 CORS/代理。
- 注意（既有行为，非本需求引入）：摘要目录位于容器内部文件系统（`/app/summaryDir`），未挂到 `OUTPUT_DIR`（`/download`）卷上，容器重建会丢失总结文档与截图——本需求不改变该行为，仅提示知晓。
- 验证要求：`pnpm docker:build` 通过；镜像运行后能通过 `/api/summary-tasks/:id/markdown` 与 `/summary-files/…` 正常预览含插图的总结。

## Acceptance Criteria

- [ ] 新增 `GET /api/summary-tasks/:id/markdown`：非法 id → 400；不存在 → 404；非 `completed` 或无 `summary_output` → 409；文件缺失 → 404；成功返回 `{ content, meta }`（frontmatter 已剥离、meta 已提取）。
- [ ] md 内 `![alt](screenshots/xxx.jpg)` 被重写为 `/summary-files/<目录>/screenshots/xxx.jpg`，浏览器可直接加载；绝对链接/根相对/锚点原样保留；`../` 穿越不重写。
- [ ] frontmatter 剥离与 meta 提取：4 个已知键解析正确；frontmatter 缺失/畸形时 `meta = {}` 且正文原样；未知键忽略。
- [ ] 摘要目录根常量与 `AnalysisTriggerService.resolveSummaryDir` 共用同一来源，无重复推导漂移。
- [ ] AI 总结任务列表页操作列新增"查看总结"按钮：`completed` 可点击，其余状态禁用；点击后弹窗顶部显示元数据条（B站原视频/模型/生成时间），下方渲染正文（文字 + 插图），插图点击可查看大图，弹窗支持全屏。
- [ ] 磁盘文件缺失时弹窗显示友好错误，不崩溃。
- [ ] 前端 dev 代理支持 `/summary-files`；生产同源直接可访问。
- [ ] `pnpm typecheck`、`pnpm build` 通过。
- [ ] Docker：`pnpm docker:build` 通过；镜像运行后预览含插图的总结正常（或明确记录人工确认项）。