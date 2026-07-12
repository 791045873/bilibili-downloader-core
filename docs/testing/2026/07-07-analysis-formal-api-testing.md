# Analysis Formal API — Testing Directions

> 对应 plan: `docs/plans/2026-07-07-analysis-formal-api-plan.md`
> 对应需求: `docs/requirements/2026-07-07-analysis-formal-api.md`
> 类型: 需求级测试方向（非单元测试、非脚本）

## 测试目的

验证 `POST /api/analysis/run` 正式接口取代调试端点后，入参契约、校验规则、可选字幕路径行为符合需求。本文件描述应观察到的需求级状态与反状态。

## 测试方向

### 1. 正式接口接受有效入参

**应成立（should be true）:**

- 以合法 `AnalysisRequest`（含 `videoPath` 绝对路径、`videoTitle`、`metadata`、可选 `subtitlePath`/`screenshotVideoPath`）调用 `POST /api/analysis/run` 返回成功，并产出分析结果。
- `metadata.type=bilibili` 且 `videoUrl`/`bvid`/`cid` 齐全时，请求被接受。
- `metadata.type=local` 且不传 `videoUrl`/`bvid`/`cid` 时，请求被接受。

**不应成立（should not be true）:**

- 合法请求不会被误判为 400。

### 2. 校验规则拒绝无效入参

**应成立:**

- `videoPath` 非绝对路径 → 返回 400。
- `subtitlePath` 传入但非绝对路径 → 返回 400。
- `screenshotVideoPath` 传入但非绝对路径 → 返回 400。
- `videoTitle` 缺失或空字符串 → 返回 400。
- `metadata` 缺失 → 返回 400。
- `metadata.type` 非 `"bilibili"`/`"local"` → 返回 400。
- `metadata.type=bilibili` 但 `videoUrl`/`bvid`/`cid` 任一缺失或空 → 返回 400。

**不应成立:**

- 无效请求不会被处理后传入分析引擎。

### 3. 调试端点移除

**应成立:**

- `POST /api/analysis/debug` 不再存在（返回 404）。

**不应成立:**

- 调试端点仍可访问。
- 代码中残留 `test_assets/video1.mp4`、`test_assets/video1.srt` 硬编码或 `getDebugAnalysisInput`/`findProjectRoot`/`readVideoTitle`/`DEBUG_VIDEO_FILENAME`/`DEBUG_SUBTITLE_FILENAME`。

### 4. 可选字幕路径

**应成立:**

- `subtitlePath` 未传入时，分析跳过字幕解析，仅传入视频给 LLM，流程正常完成。
- `subtitlePath` 传入且文件存在时，行为与改动前一致（字幕参与 LLM 分析）。

**不应成立:**

- `subtitlePath` 未传入时报错或流程中断。
- `subtitlePath` 未传入时仍尝试解析不存在的 SRT 文件。

### 5. AnalysisInput 权威定义

**应成立:**

- `AnalysisInput` 包含 `videoPath`、`subtitlePath?`、`summaryDir`、`videoTitle`、`metadata`、`screenshotVideoPath?` 字段。
- `metadata` 含 `type`/`videoUrl?`/`bvid?`/`cid?`。

**不应成立:**

- `AnalysisInput` 的 `subtitlePath` 仍为必填 `string`。
- 缺少 `metadata` 或 `screenshotVideoPath?` 字段。

## 范围外（由其他 plan 覆盖）

- front matter `video_url` 取值（AC#5/AC#6）—— 由 `2026-07-07-document-structure-optimization` plan 覆盖。
- `screenshotVideoPath` 降级解析逻辑 —— 由 `2026-07-07-screenshot-fallback-3b` plan 覆盖。
- 下载完成后自动触发分析 —— 由 `2026-07-07-ai-summary-trigger-5b` plan 覆盖。

## 验证命令

- `pnpm typecheck` —— 零错误
- `pnpm build` —— 零错误
- 手动调用 `POST /api/analysis/run` 覆盖上述方向（curl 或 HTTP 客户端）
