# Adapter 错误边界与诊断日志 — 需求文档

## Goal

为 `packages/adapters/` 建立明确、可执行的错误传播与诊断日志边界：默认由 adapter 向上抛出带安全上下文的错误，由上层编排层承担高语义日志；只有在 adapter 内部吞错、降级或回退且上层无法感知时，才允许输出少量低频诊断日志。

## In Scope

### 1. adapter / server 边界规则

- 明确 `packages/adapters/` 的默认错误处理方式是“补充安全上下文后抛出”，而不是直接记录高语义错误日志。
- 明确 `packages/server/` 或其他上层调用方负责记录请求级、任务级、编排级和对外语义级日志。

### 2. 传播型 adapter 错误规范

- 传播型失败应保留足够的诊断上下文，例如操作名称、已重试但失败、裁剪后的目标 URL、裁剪后的输出路径、状态码或简短错误原因。
- 不要求为所有 adapter 新建统一错误基类；已有 typed error 可继续沿用。
- 不允许在仍会向上抛出的路径上额外增加重复的 `error` 级别日志。

### 3. 吞错 / 降级 / 回退型 adapter 诊断规范

- 如果 adapter 内部把失败转换成空结果、`null`、`false`、部分结果或静默回退，且上层无法知道这里出过错，则允许 adapter 内输出少量 `debug` 或 `warn`。
- 这类诊断日志必须低频，不得把主流程仍可继续的情况提升为 `error`。
- 本次要求至少覆盖当前 live repo 中已知的隐藏失败家族：bilibili、bilibili-auth、downloader、ffmpeg、parser、cos、fs、task-store。

### 4. 敏感信息裁剪规则

- adapter 的错误消息和本地诊断日志不得输出 cookie、Authorization、完整 callback URL、完整 headers、完整字幕正文、完整上游响应体、完整 LLM 原始返回和其他非必要敏感内容。
- 可以输出为定位问题所需的安全摘要字段。

### 5. 兼容性要求

- adapter 改造不得引入 `@nestjs/common`、`packages/server/` 依赖或其他会破坏当前依赖方向的运行时依赖。
- adapter 改造不得改变现有对外成功/失败语义，除非计划中明确标记为需要更强诊断的边界澄清。

## Out Of Scope

- 不引入 monorepo 级统一日志库替换。
- 不实现 requestId / traceId 跨包传播。
- 不搭建新的自动化测试框架。
- 不把 server 的高语义编排日志迁移到 adapters。
- 不对前端、server API 合约或数据库结构做直接功能性变更。

## Main User Flows

### 1. 上层调用传播型 adapter 失败

1. 上层调用 adapter 能力，例如资源解析、下载、合并或 LLM 调用。
2. adapter 在失败后抛出带安全上下文的错误。
3. 上层根据自身语境决定如何记录日志、更新任务状态或转换对外错误语义。

### 2. adapter 内部发生可恢复降级

1. adapter 内部遇到某个局部失败，但按当前契约仍需继续主流程，例如返回空字幕、跳过单个截图、清理失败后继续。
2. 如果上层无法从返回值判断这里刚刚失败过，adapter 输出一条低频诊断日志。
3. 主流程继续，且对外语义不因诊断日志而改变。

## Business Rules

- `packages/adapters/` 默认不承担最终错误日志职责。
- “向上抛出”优先于“本地记录并继续”，除非继续是当前明确支持的契约。
- adapter 内允许的日志级别默认仅限 `debug` 和 `warn`；`error` 属于上层高语义日志域。
- 如果 adapter 已经通过返回值显式告诉上层发生了降级，优先由上层在业务决策点记录日志，而不是在 adapter 内重复记录。
- 任何新增诊断都必须是低频、可裁剪、可关闭的，不得把健康路径变成噪声路径。

## Roles / Permissions

- 无用户角色差异。
- 本需求不触及 auth/permissions 产品行为；仅在 adapter 包内部定义错误边界和诊断约束。

## Edge Cases

- 传播型 adapter 可能经过重试后才失败；错误消息仍需保留“已重试但仍失败”的上下文。
- 吞错型 adapter 可能把不同失败折叠成同一个空结果；诊断日志必须帮助区分“健康空结果”和“降级空结果”。
- 某些 fallback 会在清理阶段二次失败，例如临时对象删除失败；此类失败若不会改变主流程结果，应作为低频诊断而非主流程错误。
- 任何敏感值即使对排查有帮助，也必须裁剪后才能进入错误消息或日志。

## Open Questions

- 无阻塞性开放问题。是否未来抽取共享 adapter 诊断 helper 属于后续优化，不阻塞本次实现。

## Acceptance Criteria

1. `packages/adapters/` 的传播型失败路径默认只抛出带安全上下文的错误，不新增重复 `error` 日志。
2. `packages/adapters/` 的隐藏失败或降级路径仅在上层无法感知失败时增加少量 `debug` 或 `warn` 诊断。
3. adapter 级错误和诊断信息不包含 cookie、Authorization、完整 callback URL、完整 headers、完整字幕正文、完整上游响应体或其他非必要敏感内容。
4. adapter 改造不引入 `packages/server/` 或 NestJS 运行时依赖。
5. 当前已知的隐藏失败家族盘点覆盖 bilibili、bilibili-auth、downloader、ffmpeg、parser、cos、fs、task-store。
6. `pnpm --filter @bilibili-downloader/adapters typecheck`、`pnpm typecheck` 和 `pnpm build` 可作为本次改造的验证基线。