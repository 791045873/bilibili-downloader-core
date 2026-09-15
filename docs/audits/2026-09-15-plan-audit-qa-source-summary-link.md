# 2026-09-15 计划审计：QA 回答来源视频增加"AI 总结"整页链接

> Audit Type: plan audit（实现前）
> Target: `docs/plans/2026-09-15-qa-source-summary-link-plan.md`
> Requirement: `docs/requirements/2026-09-15-qa-source-summary-link.md`
> Reviewer / Agent: cold-replay self-review
> Reviewer Availability: `none`（`docs/context/ai-autonomy-policy.md`）
> Risk Classification: 非保护区域、非高风险（不涉及 auth/权限、数据删除、支付、部署）
> Result: `pass`（含 3 项实现注意项，不构成阻断）

## Method

执行期实现上下文隔离，仅以仓库真实文件与 live 代码为证据，逐项核对计划的现状、范围、决策与退出条件。因 `reviewer availability = none`，按政策对本计划（非保护、非高风险）使用 cold-replay 自检，不以独立 reviewer 名义声明通过。

## Evidence Checked

- 来源渲染与类型：`packages/frontend/src/pages/QaChat.tsx:57-61,579-600`、`packages/frontend/src/types/index.ts:287-293`、`packages/server/src/chat/chat.types.ts:17-23`。
- 来源组装与持久化：`packages/server/src/chat/chat.service.ts:130-133,321-351`、`database.service.ts:1612-1625`（`message.reply_sources` jsonb）。
- 检索 SQL：`database.service.ts:1529-1568`（未取 bvid/cid）。
- 总结定位/查看：`database.service.ts:927-935`、`analysis-task.controller.ts:184-230`、`summary-dir.ts:87-171`。
- 唯一约束：`prisma/contract.d.ts` `ai_summary_task` uniques `(bvid,cid)`、`summary` 模型含 `bvid/cid`。
- 前端路由与渲染基线：`router.tsx:1-21`、`AiSummaryTasks.tsx:343-360,855-910`、`App.tsx:37,154-156`。

## Findings

1. 现状与缺口描述与代码一致：来源确无 `bvid/cid`，检索 SQL 未取这两列，且无整页总结路由/按资源接口。计划范围足以覆盖需求。
2. 路由不冲突：`/summary-tasks/by-resource/:bvid/:cid/markdown`（4 段）与既有 `/summary-tasks/:id/markdown`（2 段）段数不同，无覆盖风险；比较 `analysis-task.controller.ts` 现有路由后确认。
3. 唯一约束与接口定位成立：`ai_summary_task.(bvid,cid)` 唯一，`getAiSummaryTaskByResource` 已存在，接口可一次定位。
4. 单点修改面评估：`searchKnowledgeSegments` 亦被 `KnowledgeSearchController` 直接返回，新增字段属附加变更，非契约破坏；计划已声明"只做字段新增"。
5. 前端类型兼容决策合理：历史 jsonb 无新字段，前端置可选并以"两者均有值"渲染链接，符合用户"不做降级 + 缺失即详情页报错"的组合意图（历史条目无标识则无链接，不属总结缺失降级）。
6. 退出条件可验证：typecheck/build 为仓库真实命令（`project-context.md`），错误分支可用手工/curl 核对。

## Non-Blocking Implementation Notes

- N1：`summary.cid` 为 `int8`，`node-postgres` 原始查询按字符串返回，检索映射时须 `Number(row.cid)` 转换（`searchKnowledgeSegments` 现有 `timestampSeconds` 已用同类处理）。
- N2：新页面组件须沿用懒加载约定导出（`export function Component()`，参照 `QaChat.tsx:73`）。
- N3：抽取 markdown 私有方法时须保留既有日志与异常语义，确保按 id 路由行为不变。

## Conclusion

计划在范围、现状、决策、验证与闭合门禁上自洽，无阻断问题。3 项实现注意项已并入实现约束，无需修订计划后重审。
