# Plan Audit — SDK 接口缓存与 -412 自动重试

- 计划：`docs/plans/2026-08-12-sdk-cache-and-retry-plan.md`
- 需求来源：`docs/requirements/2026-08-12-sdk-cache-and-retry.md`
- 审计日期：2026-08-12
- 审计方式：独立 subagent（冷启动，task `ses_009c0c9d2ffeT8lyxEZVGDqBxN`），对照 live 代码与计划编写规则

## 首轮审计结论

`needs revision`

### 阻断问题（唯一）

- Phase 1 Exit Criteria 要求 `pnpm --filter bilibili-api-sdk test` 全量通过（Phase 1 落地默认开启的接口级缓存），但"适配受默认缓存影响的存量用例"Fix 项被安排在 Phase 3。阶段序矛盾：Phase 1 门禁在存量适配未做时无法诚实通过。
- 修订：存量用例适配 Fix 项移入 Phase 1（与缓存落地同相位），Phase 3 改为全量回跑验证；Phase 1 门禁与实现范围自此一致。

### 非阻断建议（均已吸收）

1. testing 方向 7 补"首次重试前凭据刷新（GenWebTicket 请求计数）"观测。
2. Phase 1 缓存用例清单补"磁盘写失败静默降级"（原仅"损坏文件自愈"）。
3. Phase 1 失效机制项引用需求约束：`setCookies()` 不绑定全量清空缓存。
4. 注明 `createBilibiliApiAdapter`（`adapters/src/bilibili/bilibili-api.ts`）创建的 client 走默认内存缓存。
5. 修正 Phase 1 Item Types 行笔误。

## 规则符合性确认

- scope 诚实性：Goals/Non-Goals 与需求 In Scope/Out Of Scope 一致；AC1-14 全部可追踪；四个已定决策（maxRetries=4、PGC 不覆盖、统一 24h、playurl 排除）均被计划吸收。
- closure gates 可验证：五条验证命令均存在于相应 package.json。
- 隐藏依赖：Targets 路径全部真实存在；Prereqs（P2←P1、P3←P1）合理；无遗漏文件。
- 反 slack：in-scope 项无禁词；4 个 Deferred 项均写明重开触发条件。
- Decision 项含理由/备选/残余风险。
- Item Types 符合规则（HTTP 412 归一化为 Fix；Phase 1 相位级声明 Add）。
- testing 文档 10 个方向覆盖 AC1-14，停留在需求可观测层。

## 事实核查

Current Baseline 关键声明与 live 代码一致（抽查通过）：OUTPUT_DIR 约定（`database.service.ts:91-93`）、`createBilibiliSdkClient(cookieString)` 单参（`sdk-client.ts:46-50`）、parse/download 各自建 client（`:54/:103`）、`history.delete` GET 写语义（`history.ts:62`）、`biliTicket.reset()` public（`biliTicket.ts:61`）、http 层不查状态码/默认重试 1/String(value) 语义（`http.ts:38,88,110`）、绕过 request 的接口清单、v_voucher 复用旧 w_rid 怪癖（`base.ts`）。

## 修订后结论

阻断问题已消解，非阻断建议已全部吸收，计划进入 `passed` 状态，可进入实施阶段。

## 关闭审计

本计划尚未实施；closure audit 将在计划关闭时另行独立执行（证据另行归档）。
