# Server Observability Logging - Testing Directions

> 对应 plan: `docs/plans/2026-08-01-server-observability-logging-plan.md`
> 对应来源: 2026-08-01 direct user request + `docs/design/app-overview.md` + `docs/context/codebase-map.md`
> 类型: 需求级测试方向（非单元测试、非脚本）

## 测试目的

验证 server 日志改造后是否能覆盖所有接口的最小请求可观测性，并为下载与分析这两条复杂编排链路提供足够的阶段、分支、状态迁移和失败定位信息，同时避免敏感信息泄漏与控制台风格漂移。

## 环境前置

- Server 以当前仓库推荐方式运行。
- 若验证分析相关接口，保留现有分析链路所需环境变量与外部依赖。
- 验证期间维护 `docs/testing/2026/08-01-server-observability-route-matrix.md`，用于确认 23 个端点已被盘点，其中 20 个非受保护端点已实际回放，3 个 auth 端点明确保持 `blocked-protected` 状态。

## 测试方向

### 1. 所有非受保护 HTTP 端点都有最小请求级日志覆盖

Requirement / Change Covered:
- 所有 20 个非受保护 server 端点都应具备统一的 request started / completed / failed 可观测性；3 个 auth 端点需在 route matrix 中保持受保护阻断标记。

Should Be Observable:
- 每个端点在实际请求时都能产生日志，至少能看出请求进入、结束状态和失败情况。
- 轻量端点即使没有额外业务日志，也能靠全局请求日志完成第一层排障。

Should Not Be Observable:
- 某些 controller 仍完全无日志入口，导致是否命中 handler 都无法判断。
- 仅靠局部 controller 打印而没有全局统一请求日志。
- auth 端点在未满足受保护区域前提时被误标为已实施完成。

Status: pending
Evidence: not run

### 2. 下载与任务链路能定位失败阶段

Requirement / Change Covered:
- 下载、调度、任务状态流转应在关键节点产生日志，足以定位问题阶段。

Should Be Observable:
- 能从日志区分任务创建、调度抢占、流解析、执行开始、进度摘要、完成写回、失败写回、停止、恢复、删除、清空和低清队列行为。
- 下载失败时，可判断失败发生在调度、流解析、执行、持久化还是回调阶段。

Should Not Be Observable:
- 下载失败只能看到最终异常，看不到前面执行到了哪一步。
- 进度日志对每次数据库写入都刷屏，导致核心日志被淹没。

Status: pending
Evidence: not run

### 3. 分析与 fallback 链路能解释“为什么没跑”和“跑到哪一步失败”

Requirement / Change Covered:
- 分析触发、低清等待、截图源降级、LLM 失败、通知失败等关键分支都应可观察。

Should Be Observable:
- 能从日志区分 auto-summary 关闭、主任务未成功、低清未完成、字段缺失、远端截图失败回落本地、LLM 返回空结果、通知发送失败、临时文件清理结果等情况。
- 对同一个分析任务，日志中至少能串起关键业务标识和阶段变化。

Should Not Be Observable:
- 分析没有执行时，日志无法判断是被 guard 跳过、等待子任务，还是直接失败。
- 远端截图失败后缺少 fallback 决策日志，导致只能看到最终截图为空。

Status: pending
Evidence: not run

### 4. parse 和 video 轻量接口也具备可诊断分支日志

Requirement / Change Covered:
- 解析类和视频轻量接口虽非长链路，也需要在关键分支和异常映射点可观察；auth 路由在当前计划中只做 protected bookkeeping，不进入实施型 proof scope。

Should Be Observable:
- 分页参数错误、资源类型分支、封面代理失败、单视频解析和批量解析失败，都能从日志中定位到对应分支。
- auth 路由在 route matrix 中保持 `blocked-protected` 状态，而不是被当作已实施或待实施的本计划 proof 项。

Should Not Be Observable:
- 这些轻量接口只能依赖 HTTP 502 或返回体字符串，完全看不到后端分支决策。
- testing scope 通过“轻量接口验证”重新把 auth 分支日志带回本计划的实施证明范围。

Status: pending
Evidence: not run

### 5. 日志不会泄漏敏感信息

Requirement / Change Covered:
- server 日志工具必须对请求体和错误上下文执行安全裁剪。

Should Be Observable:
- 日志只输出安全字段和必要摘要，例如 taskId、bvid、cid、状态、画质、路由、方法和裁剪后的路径摘要。

Should Not Be Observable:
- cookie、Authorization、完整 callbackUrl、完整 headers、完整字幕内容、完整 LLM 响应、SMTP 凭据或其他敏感值出现在日志中。

Status: pending
Evidence: not run

### 6. server 源码不再依赖零散 console 作为正式诊断手段

Requirement / Change Covered:
- 计划内 server 文件中的 `console` 诊断应被统一 Logger 机制取代。

Should Be Observable:
- 启动、分析异常和主要请求诊断都通过统一日志出口呈现。

Should Not Be Observable:
- `packages/server/src/main.ts` 或计划范围内分析文件继续保留正式排障依赖的 `console.error` / `console.log`。

Status: pending
Evidence: not run

### 7. 验证闭环覆盖全部路由和关键分支

Requirement / Change Covered:
- 计划 closure 不能只做代表性抽样，必须依赖 route-coverage matrix 和 testing 文档逐条收口。

Should Be Observable:
- 全部 23 个端点都在矩阵中有明确状态；20 个非受保护端点有手动回放记录；复杂端点有额外关键分支验证记录；3 个 auth 端点保留 `blocked-protected` 说明。
- testing 文档和覆盖矩阵的状态与 plan 的 phase/closure gate 一致。

Should Not Be Observable:
- 只验证少数代表接口就宣称“所有接口都补齐了日志”。
- testing 文档仍是 `pending`，但 plan 已声称 closure 完成。

Status: pending
Evidence: not run

## 范围外

- 第三方日志库接入
- 文件日志 sink
- requestId / trace context 传播
- 自动化 API 测试框架搭建

## 预期验证命令

- `pnpm --filter @bilibili-downloader/server typecheck`
- `pnpm typecheck`
- `pnpm build`