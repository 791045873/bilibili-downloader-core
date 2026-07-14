# Document Structure Optimization — Testing Directions

> 对应 plan: `docs/plans/2026-07-07-document-structure-optimization-plan.md`
> 对应需求: `docs/requirements/2026-07-07-document-structure-optimization.md`
> 类型: 需求级测试方向（非单元测试、非脚本）

## 测试目的

验证视频分析生成的 Markdown 文档结构从"总结报告"形态转为"带元数据的结构化文档"形态后，front matter 字段、正文平铺 segment 结构、字段名对齐、空内容文档行为符合需求。本文件描述应观察到的需求级状态与反状态。

## 测试方向

### 1. Front Matter 字段存在且正确

**应成立（should be true）:**

- 生成的 Markdown 文档头部包含 YAML front matter 块（`---` 包裹）。
- front matter 包含 `title`、`video_url`、`model`、`created_at` 四个字段。
- `title` 值为视频标题。
- `model` 值为 `visionModelName`（如配置）或 `modelName`。
- `created_at` 值为时间字符串。

**不应成立（should not be true）:**

- 文档直接以 `# title` 开头，缺少 front matter 块。
- front matter 缺少任一必需字段。

### 2. video_url 取值由 metadata.type 决定

**应成立:**

- `metadata.type=bilibili` 时，front matter `video_url` 为 `metadata.videoUrl` 的值。
- `metadata.type=local` 时，front matter `video_url` 为空字符串。

**不应成立:**

- `metadata.type=local` 时 `video_url` 为 `undefined` 或 `null` 字面量。
- `video_url` 从环境变量或硬编码默认值读取。

### 3. 正文为平铺 segment 结构

**应成立:**

- 文档保留 H1（内容为视频标题）。
- H1 之后直接平铺每个 segment，每个 segment 一个 H2。
- 每个 segment 依次展示：H2 标题 → content 正文 → 截图 → 截图说明（`>` 引用格式）。

**不应成立:**

- 文档中出现 `## 内容总结` 或 `## 重点内容` 章节。
- segment 使用 H3 而非 H2。
- segment 中出现 `**相关原文：**` 引用块。

### 4. 截图说明来自 frameDescription

**应成立:**

- 截图下方的 `>` 引用文字内容来自 LLM 返回的 `frameDescription` 字段。
- `buildAnalysisSystemPrompt()` 指示 LLM 返回 `frameDescription` 字段。

**不应成立:**

- 截图说明使用 segment title 或其他字段作为说明文字。
- LLM 返回结构中缺少 `frameDescription` 字段定义。

### 5. DocumentInput.segments 字段名与 LLM 返回结构一致

**应成立:**

- `DocumentInput.segments` 使用 `title`、`content`、`timestamp`、`frameDescription`、`images` 字段名。
- `images` 数组元素使用 `relativePath` 字段名。

**不应成立:**

- segments 使用 `topic`、`subtitleText`、`selectedImages`、`reason` 等旧字段名。
- `DocumentInput` 保留 `summary` 或 `emptySummary` 字段。

### 6. 空内容文档保留 front matter 和 H1

**应成立:**

- LLM 返回空内容或分析失败时，生成的文档包含 front matter（字段正常填充）和 H1。
- 文档正文为空（H1 之后无任何内容）。

**不应成立:**

- 空内容文档输出 `[该视频无重点内容可总结]`。
- 空内容文档缺少 front matter 或 H1。

### 7. AnalysisEngine 注入模型名

**应成立:**

- `AnalysisEngine` 构造函数保留 `llmConfig` 引用。
- front matter `model` 字段值为 `this.llmConfig.visionModelName ?? this.llmConfig.modelName`。

**不应成立:**

- `model` 字段为空字符串或硬编码值。
- 引擎不持有 `llmConfig`，无法注入模型名。

## 范围外（由其他 plan 覆盖）

- `AnalysisInput` 权威定义（含 `metadata`/`screenshotVideoPath?`）—— 由 `2026-07-07-analysis-formal-api` plan 覆盖（已完成）。
- `POST /api/analysis/run` 接口契约与校验 —— 由 `2026-07-07-analysis-formal-api` plan 覆盖（已完成）。
- 截图逻辑与 `screenshotVideoPath` 降级 —— 由 `2026-07-07-screenshot-fallback-3b` plan 覆盖。

## 验证命令

- `pnpm typecheck` —— 零错误
- `pnpm build` —— 零错误
- 手动检查生成的 Markdown 文件结构（front matter 字段、正文格式、空内容路径）

## 2026-07-14 执行记录

- 结果：通过
- 命令：`pnpm typecheck`（通过，存在 Node engine warning: 期望 24.16.0，当前 22.22.3）
- 命令：`pnpm build`（通过，存在相同 engine warning）
- 手动验证（非空 segments）：通过 `pnpm --filter @bilibili-downloader/server exec node -e "...generateMarkdown(...)..."` 生成样例，确认存在 front matter 四字段、H1、平铺 H2、图片与 `>` 引用说明。
- 手动验证（空 segments）：通过同类命令生成空样例，确认仅保留 front matter 与 H1，正文无占位符文本。
- 反状态检查：输出中未出现 `## 内容总结`、`## 重点内容`、`**相关原文：**`、`[该视频无重点内容可总结]`。
