# 2026-09-28 文档审计 — 云端/NAS umbrella 及其子需求独立复核

> 对象：umbrella `docs/discussions/2026-09-17-cloud-nas-responsibility-split.md` 及 8 份子需求（Phase 1a/1b/2/3/4 + auth + 完整性检查重定义 + 重试截图）。
> 方式：逐份文档审计 + 跨阶段一致性核对 + live code 抽验（`contract.prisma` 列/级联、`analysis-trigger.service.ts` raw_response 写入）。
> 结论：分解完整、依赖拓扑自洽、代码引用准确，可作实现基线。发现 2 处中等一致性缺陷 + 2 处低severity，均为文档同步问题，非结构性缺陷。

## 复核确认无误

- 依赖拓扑（1a→1b、2→3、auth→3、1a+1b+2+3→4、{完整性,重试截图}依赖 1b+2）在 umbrella 与各子需求头部/前置声明一致。
- Q1–Q16 全部裁决；Q9（回填已完成）、Q14（embedding 不动）为有意排除。
- 代码引用抽验准确：`contract.prisma:162` `summary_segment onDelete: Cascade` ✓；`:42-44` `integrity_status/detail/checked_at` ✓；`:31/40/41` `summary_output/knowledge_status/knowledge_error` ✓；H4 失败路径把 error 写进 `rawResponse`（`analysis-trigger.service.ts:153-154、532-533`）✓。
- 保护区处置正确：Phase 3 部署 `ask-first`、Phase 4 数据删除 reviewer=none 时 blocked、additive-first 迁移、auth 先行、server-common 独立前置阶段。
- Phase 1a 丢图回归与 1a/1b 窗口风险有显式说明并经用户人工检视存量数据消解。

## 发现

### F1（中）— "Supersedes 待人工确认" 标签已过期，与已确认的取代指针矛盾
- 4 份被取代文档（`2026-09-07-summary-integrity-check`、`2026-08-24-cos-summary-knowledge-publish`、`2026-09-01-knowledge-backfill`、`2026-08-17-ai-summary-view-markdown`）头部均已含"取代提示（2026-09-23，人工确认）"指针（已读盘确认存在）。
- 但 umbrella 头部 L10「Supersedes（待人工确认）」、umbrella Supersedes 段、Phase 1a 头部「需人工确认」、integrity-rescope 头部「需人工确认」、以及 `2026-09-23-document-audit-cloud-nas-family.md` 的"仍开放（用户暂缓）"段仍称其待确认/暂缓/未改动。
- 且该 family 审计文件自相矛盾：2026-09-23 段称"未改动/暂缓"，2026-09-28 第三轮段称指针"全部 PRESENT 且指向正确后继（人工确认 2026-09-23）"。
- 磁盘证据（指针已存在且标"人工确认"）表明确认已发生，上游"待确认"标签为陈旧态。
- 建议：把 umbrella L10 + Supersedes 段、Phase 1a 头部、integrity-rescope 头部、family 审计"仍开放"段统一改为"已确认（2026-09-23）"。

### F2（中）— 登录失败锁定（最小限流）决策未回写 umbrella
- family 审计 2026-09-23 item 5 裁决"同一 IP 多次登录失败临时封禁"最小防护，auth 子需求已纳入（In Scope L28、BR L68、AC L106、OOS L44）。
- 但 umbrella 仍在三处（L224、Q11 L280、Q11 子项7 L420）写"限流本期不做"，未提该登录锁定裁决。
- umbrella 为裁决之源，安全相关决策只落子需求会误导后续读者。
- 建议：在 umbrella Q11 补记 2026-09-23 登录锁定裁决，并注明通用请求限流仍不做。

### F3（低）— 跨阶段悬置项循环延迟
- umbrella L12 将 `knowledge_status/error` 最终去留、`worker_job` 终态保留期两项登记为"统一由本总纲裁决"；Phase 1b/2/4 均延迟至总纲。但 umbrella 未实际给出裁决，仅登记为开放。
- 已正确标为开放（非伪闭合），故低severity；但"由总纲裁决"措辞暗示已有结论。建议在 umbrella 直接给出结论或改措辞为"尚待裁决"。

### F4（低/提示）— 行号引用漂移
- 多处引用 `analysis-trigger.service.ts:529-536 / :531-535 / :152-156 / :534`，实际约 153-154、532-533。方向正确、无害，但随代码演进会继续漂移，实现时以符号定位为准。

## 判定

8 份子需求对 umbrella 构成完整、自洽的分解，可作排期与实现基线。F1/F2 为文档同步缺陷，建议实现前就地修正以消除真源歧义；F3/F4 非阻塞。
