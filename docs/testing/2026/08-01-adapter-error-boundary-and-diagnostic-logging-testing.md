# Adapter Error Boundary And Diagnostic Logging - Testing Directions

> 对应 plan: `docs/plans/2026-08-01-adapter-error-boundary-and-diagnostic-logging-plan.md`
> 对应来源: 2026-08-01 direct user request + `docs/architecture/module-boundaries.md` + `docs/architecture/system-baseline.md`
> 类型: 需求级测试方向（非单元测试、非脚本）

## 测试目的

验证 adapters 改造后的分层边界是否清晰：传播型错误应保留安全上下文并交给上层处理；吞错或降级型 adapter 只有在上层无法感知失败时才输出少量低频诊断；整体行为不应退化为重复报错或敏感信息泄漏。

## 环境前置

- 使用当前 monorepo 默认开发环境。
- 如需手动验证 Bilibili 相关链路，`COOKIE_FILE` 应指向有效 cookie 文件。
- 如需手动验证截图链路，`ffmpeg` 与 `ffprobe` 应可在本机环境中调用。

## 测试方向

### 1. 传播型 adapter 错误由上层统一承接

Requirement / Change Covered:
- 传播型 adapter 不直接记录 `error` 日志，而是向上抛出带安全上下文的错误。

Should Be Observable:
- 当资源解析、下载、合并或 LLM 调用失败时，上层能够从异常文本、HTTP 错误或任务失败状态中识别失败操作。
- 同一失败最终由 server 或调用方形成一次高语义诊断，而不是在 adapter 层先记录一条重复 `error`。

Should Not Be Observable:
- 同一失败既在 adapter 内输出 `error`，又在 server 编排层再次输出 `error`。
- 传播型 adapter 把可判断的失败压成缺乏上下文的泛化字符串。

Status: passed
Evidence: 2026-08-02 通过 built-module 探针验证 `packages/adapters/dist/bilibili/resource-parser.js` 会把 URL 输入裁剪为 `?...` 摘要，不再暴露完整 query；同时 `packages/adapters/src/**/*.ts` 中未发现 `logger.error(...)` 残留于 propagation adapter 家族。

### 2. 吞错或降级路径只输出低频诊断

Requirement / Change Covered:
- 只有吞错、静默降级或内部 fallback 且上层无法得知时，adapter 才允许输出 `debug` 或 `warn`。

Should Be Observable:
- 被吞掉的失败会留下可追踪的低频诊断信号，便于后续定位隐藏降级。
- 主流程继续时，诊断级别保持在 `debug` 或 `warn`，不把可恢复降级误报为全局失败。
- 代表性的隐藏失败家族至少覆盖字幕、截图或临时对象清理这类“上层看不到原始失败”的场景。

Should Not Be Observable:
- 健康路径出现重复的 `warn` 噪声。
- adapter 在继续执行主流程的情况下输出 `error`。

Status: passed
Evidence: 2026-08-02 通过 built-module 探针验证 `packages/adapters/dist/parser/subtitle-srt-parser.js` 在遇到 malformed block 时输出单条 `WARN` 并继续返回其余条目；同时代码审查确认 `subtitle-provider`、`web-client`、`auth-provider`、`aria2-downloader`、`ffmpeg-screenshot`、`cos temp image store`、`node-file-store`、`task-store` 均改为低频 `warn`/`debug` 诊断而未提升为 `error`。

### 3. 现有业务语义保持不变

Requirement / Change Covered:
- adapter 错误与日志改造不改变下载、解析、分析链路对外的成功/失败语义。

Should Be Observable:
- 原本应继续运行的路径仍然继续运行，例如字幕缺失或局部截图失败不应直接终止整个上层流程。
- 原本应直接失败的路径仍以失败形式暴露给上层，例如资源解析失败或下载最终失败。

Should Not Be Observable:
- 仅因新增诊断日志而改变 HTTP 结果、任务状态迁移或分析结果文件产出行为。
- 原本会被上层感知的失败被错误吞掉并伪装为成功。

Status: passed
Evidence: 2026-08-02 代码审查确认传播型 adapter 仍通过异常向上暴露失败；隐藏失败路径仍保持原有空结果、`null`、`false` 或 fallback 契约，仅新增诊断，不改变主流程结果。

### 4. 敏感信息不会出现在 adapter 错误或日志中

Requirement / Change Covered:
- adapter 错误消息和 adapter-local diagnostics 必须遵守敏感信息裁剪规则。

Should Be Observable:
- 错误和诊断只保留必要摘要，例如操作类型、已裁剪路径、状态码或简短原因。

Should Not Be Observable:
- cookie、Authorization、完整 callback URL、完整 headers、完整字幕正文、完整原始上游响应体直接出现在日志或错误消息中。

Status: out of scope
Evidence: 2026-08-02 用户明确要求忽略 qwen-client 上游响应体裁剪的额外手工探针验证；本计划保留代码审查证据，且不再追加该条运行时 proof。该裁定仅影响 proof 范围，不改变已落地的敏感信息裁剪实现。

### 5. adapters 仍保持独立于 server 的运行时边界

Requirement / Change Covered:
- `packages/adapters/` 不引入 Nest Logger 或 server 专属日志组件。

Should Be Observable:
- adapters 仍只依赖自身轻量实现和 core 边界，不需要 server/Nest 运行时就可编译。

Should Not Be Observable:
- adapter 为了输出诊断而引入 `@nestjs/common` 或引用 `packages/server/` 的日志代码。

Status: passed
Evidence: 2026-08-02 grep 检查 `packages/adapters/src/**/*.ts` 未发现 `@nestjs/common` 或 `packages/server` 依赖引入；新增诊断仍仅依赖 adapters 自身 `logger` 和本地安全摘要工具。

### 6. 计划相关验证命令可支撑 closure

Requirement / Change Covered:
- 本计划的包级和仓库级验证命令足以证明边界规则未破坏现有编译链路。

Should Be Observable:
- `pnpm --filter @bilibili-downloader/adapters typecheck`、`pnpm typecheck`、`pnpm build` 能完成，并为手工抽查提供稳定基线。

Should Not Be Observable:
- 计划关闭时缺少任何实际运行过的验证或缺少 testing 文档状态回填。

Status: passed
Evidence: 2026-08-02 已运行 `pnpm --filter @bilibili-downloader/adapters typecheck`、`pnpm typecheck`、`pnpm build`，均通过；存在 Node engine warning（期望 24.16.0，当前 22.22.3），但不影响命令完成。

## 范围外

- monorepo 级统一日志库替换
- requestId / traceId 跨包传播
- 新建自动化测试框架

## 预期验证命令

- `pnpm --filter @bilibili-downloader/adapters typecheck`
- `pnpm typecheck`
- `pnpm build`