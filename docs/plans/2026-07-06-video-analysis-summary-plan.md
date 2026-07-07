# 视频分析总结功能实施计划

> Plan Status: completed
> Plan Audit: required
> Closure Audit: required
> Last Reviewed: 2026-07-06
> Source: `docs/input/source-video-analysis-summary.md` + `docs/requirements/2026-07-06-video-analysis-summary.md` + `docs/architecture/2026-07-06-video-analysis-baseline.md`
> Related: 无
> Audit: required

## Current Baseline

- 视频下载链路已完整，下载产物为 `{outputDir}/downloads/{title}/{title}.mp4` 和 `{title}.{langKey}.srt`
- ffmpeg 项目已集成 ffmpeg 支持（`FfmpegMerger` 音视频合并）
- HTTP 客户端（`fetch`）可用，用于 LLM API 调用
- 后端为 NestJS（server 包），已有 download service、scheduler、数据库模块
- 已有环境变量管理概念（`OUTPUT_DIR` 用于下载目录，`COOKIE_FILE` 用于 Cookie 持久化）

## Goals

1. 新增 LLM 适配层 — 封装千问 3.6 Flash API（纯文本 + 多模态）
2. 新增 ffmpeg 截图能力
3. 新增 SRT 字幕解析器
4. 新增分析引擎编排器（字幕分析 → 截图 → 多模态筛选 → 文档生成）
5. 新增 Markdown 文档生成器
6. 打通从已有视频+字幕文件到生成总结文档的完整链路

## Non-Goals

- 不涉及前端 UI（无触发按钮、无进度展示）
- 不涉及 CLI 参数
- 不修改 Core 层
- 不涉及用户交互、认证、权限
- 不设计 API 端点和 NestJS Module 注册（下个 phase 做）
- 不需要 API Key 前端管理界面（仅环境变量）
- 不需要 LLM 调用的重试/降级逻辑
- 不支持多 P 视频

## Execution Plan

### Phase 1 — Adapter: LLM 客户端

Status: planned
Targets: `packages/adapters/src/llm/`

- Item Types: Add

- [ ] 创建 `packages/adapters/src/llm/qwen-client.ts`，封装千问 3.6 Flash API 调用
  - `chatCompletion(params: ChatCompletionRequest): Promise<object>` — 纯文本调用，强制 JSON 输出
  - `multimodalChat(params: MultimodalRequest): Promise<object>` — 多模态调用（文本 + 图片 URL）
  - 支持配置文件 `LlmConfig` 从外部注入（apiKey, baseUrl, modelName）
  - 请求格式为 OpenAI 兼容格式
  - 图片传输使用腾讯云 COS 临时签名 URL，禁止使用 base64 data URL
- [ ] 创建 `packages/adapters/src/llm/index.ts`，统一导出
- [ ] No adapter README update required（新建包）

Exit Criteria:

- [ ] 可通过 `chatCompletion()` 发送纯文本请求并解析 JSON 响应
- [ ] 可通过 `multimodalChat()` 发送文本+图片请求
- [ ] `pnpm typecheck` 通过

### Phase 2 — Adapter: ffmpeg 截图

Status: planned
Targets: `packages/adapters/src/ffmpeg/`

- Item Types: Add

- [ ] 创建 `packages/adapters/src/ffmpeg/ffmpeg-screenshot.ts`
  - `takeScreenshots(params: ScreenshotParams): Promise<ScreenshotResult>`
  - 对每个时间点，执行 `ffmpeg -ss {time} -i {video} -vframes 1 -q:v 3 {outputPath}`
  - 文件名格式：`{filenamePrefix}-frame-{index}.jpg`
  - 复用 `FfmpegMerger` 的 ffmpeg path 检测（将 `isAvailable` 提取为共享函数，或截图模块自己执行 `which ffmpeg` / `ffmpeg -version`）
  - 如果视频或输出目录不存在，抛出明确错误
- [ ] 更新 `packages/adapters/src/ffmpeg/index.ts`，导出新模块
- [ ] No adapter README update required

Exit Criteria:

- [ ] 给定视频文件和时间点列表，能生成对应的 JPEG 截图文件
- [ ] 截图文件名符合约定格式
- [ ] `pnpm typecheck` 通过

### Phase 3 — Server: 字幕解析器

Status: planned
Targets: `packages/adapters/src/parser/`

- Item Types: Add

- [ ] 创建 `packages/adapters/src/parser/subtitle-srt-parser.ts`
  - `parseSrt(filePath: string): SrtEntry[]`
  - 解析标准 SRT 格式，支持：序号、时间戳 `HH:MM:SS,mmm --> HH:MM:SS,mmm`、多行文本
  - 时间戳转换为秒（float）
  - 对解析错误的行容错处理（跳过而不是抛出异常）
  - 返回按时间排序的条目列表
- [ ] 创建 `packages/adapters/src/parser/index.ts`，统一导出
- [ ] No owner-doc update required

Exit Criteria:

- [ ] 给定合法 SRT 文件，正确解析所有条目
- [ ] 时间戳正确转换为秒
- [ ] 对包含错误的 SRT 文件容错
- [ ] `pnpm typecheck` 通过

### Phase 4 — Server: 文档生成器

Status: planned
Targets: `packages/server/src/analysis/`

- Item Types: Add

- [ ] 创建 `packages/server/src/analysis/document-generator.ts`
  - `generateMarkdown(input: DocumentInput): string`
  - Markdown 结构：
    - H1: 视频标题
    - 整体总结段落
    - H2: "重点内容"
    - 每个关键段落：
      - H3: 段落主题
      - 图片引用：`![图片说明](screenshots/filename.jpg)`（相对路径）
      - 字幕原文引用（引用格式）
  - 空文档：包含 `[该视频无重点内容可总结]` 标记
  - 图片引用使用相对路径（相对于 `summary/{title}/`）
- [ ] No owner-doc update required

Exit Criteria:

- [ ] 给定含段落和截图的数据，生成正确的 Markdown 文本
- [ ] 空输入生成空文档标记
- [ ] 图片路径为相对路径
- [ ] `pnpm typecheck` 通过

### Phase 5 — Server: 分析引擎编排器

Status: planned
Targets: `packages/server/src/analysis/`

- Item Types: Add

- [ ] 创建 `packages/server/src/analysis/analysis-engine.ts`
  - `analyze(input: AnalysisInput): Promise<AnalysisOutput>`
  - 编排流程：
    1. 读取字幕文件（调用 `parseSrt` 从 `adapters/src/parser/`）
    2. LLM 调用 #1：将完整字幕原文发送给千问，获取关键段落列表 + 整体总结
    3. 对每个关键段落计算时间窗 `[start-3, end+3]`，生成时间点列表（每秒一点）
    4. 将截图上传到腾讯云 COS 临时目录，并用临时签名 URL 调用 LLM #2（多模态）选图
    5. 模型分析完毕后清理 COS 临时图片
    6. 调用 `documentGenerator`（Phase 4）生成 Markdown
    7. 写入文件到 `summary/{title}/`
  - 空段落列表处理：生成标注"该视频无重点内容可总结"的空文档，`emptySummary = true`
  - 每个步骤的错误处理不阻塞后续步骤（截图失败跳过该段落，LLM 调用失败记录日志并跳过）
  - LLM 客户端支持 HTTP 客户端注入，便于单元测试时替换为 mock（无需真实 API Key 即可验证请求/响应格式）
  - 读取环境变量 `QWEN_API_KEY`, `QWEN_API_BASE`, `QWEN_MODEL` 构造 `LlmConfig`
  - 从 `OUTPUT_DIR` 环境变量推导下载目录和 summary 目录路径
- [ ] No owner-doc update required

Exit Criteria:

- [ ] 给定有效视频+字幕路径，完整执行 6 步流程（包含 Phase 4 文档生成器）
- [ ] 空字幕/无关键段落时生成空文档
- [ ] 生成的截图文件和文档位于 `summary/{title}/` 目录下
- [ ] 可通过注入 mock HTTP 客户端测试 LLM 调用逻辑（无需真实 API Key）
- [ ] `pnpm typecheck` 通过

### Phase 6 — 验证

Status: planned

- Item Types: Proof

- [ ] `pnpm typecheck` 全部包通过
- [ ] `pnpm build` 全部包通过
- [ ] `docs/testing/known-good-baselines.md` 更新

Exit Criteria:

- [ ] `pnpm typecheck` 零错误
- [ ] `pnpm build` 零错误

## Plan Audit

- Status: passed
- Reviewer / Agent: independent subagent (`General_4880410`)
- Evidence: 审计发现 3 个阻塞问题，已在下方修复。

### 阻塞问题修复记录

1. **阶段排序冲突** — Phase 5（文档生成器）原排在 Phase 4（引擎）之后，但 Phase 4 调用了文档生成器。已将 Phase 5 移到 Phase 4 之前（文档生成器 → 引擎），重新编号。
2. **"text consistency" 门控未定义** — 已在 Closure Gates 中明确操作定义：比对 requirement/architecture/代码三者的关键术语一致性。
3. **LLM mock 策略缺失** — Phase 5 中补充了"LLM 客户端支持 HTTP 客户端注入"的要求，使得无需真实 API Key 即可进行单元测试。

### 非阻塞建议处理

4. **SRT 解析器位置** — 从 `packages/server/src/analysis/` 移到 `packages/adapters/src/parser/`，符合"Adapter 关注通用性"的架构原则。
5. **基线表述修正** — ffmpeg 从"已作为项目依赖存在"修正为"项目已集成 ffmpeg 支持"。

## Closure Gates

- [ ] Phase 1-6 全部 exit criteria 满足
- [ ] 给定视频+字幕文件，完整分析流程可触发
- [ ] 生成的 Markdown 文档格式正确，图片可追踪到本地文件
- [ ] 无字幕/无重点内容时生成空文档
- [ ] 每个阶段错误独立处理不阻塞后续
- [ ] plan audit 通过
- [ ] implementation audit 通过
- [ ] text consistency 验证通过（需求文档、架构文档、最终代码三者的关键术语、接口命名、数据类型定义一致；例如 `AnalysisInput` 的字段名在 requirement、architecture、实际代码中一致）

## Deferred But Adjudicated

### NestJS Module / API 端点注册

- Classification: out-of-scope improvement
- Why Not Blocking Closure: 当前 phase 仅实现核心逻辑，注册到 NestJS Module 和 API 入口是下一个 phase
- Successor Required: yes

### 前端 UI（触发按钮、进度展示、结果查看）

- Classification: out-of-scope improvement
- Why Not Blocking Closure: 当前仅实现后端核心能力
- Successor Required: yes

### LLM 调用重试与降级

- Classification: optimization candidate
- Why Not Blocking Closure: 当前单次失败直接跳过，后续可加入重试逻辑
- Successor Required: no

### summary 目录清理策略

- Classification: watch-only residual
- Why Not Blocking Closure: 当前仅追加写入，不涉及清理。后续可加入过期删除
- Successor Required: no

## Closure

Status Note: 已完成。核心分析链路已实现：字幕分析、截图、COS 临时签名 URL 传图、多模态选图、清理临时对象、本地相对路径 Markdown 生成。

Closure Audit Evidence:
- Reviewer / Agent: independent subagent (`General_4902919`)
- Evidence: 审计通过。未发现阻塞问题；确认未使用 Base64 图片传输，截图上传 COS 临时目录后以签名 URL 传给模型，模型分析结束后清理临时 COS 对象，Markdown 保持本地相对图片路径。
- Verification: `pnpm typecheck` passed; `pnpm build` passed.

Follow-up:
- 本 plan 完成后，下一个 phase 将分析引擎注册到 NestJS Module 并提供 HTTP API 端点和前端触发入口