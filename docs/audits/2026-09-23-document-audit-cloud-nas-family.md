# 2026-09-23 文档审计 — 云端/NAS 子需求族逐份复核

> 对象：umbrella `docs/discussions/2026-09-17-cloud-nas-responsibility-split.md` 及其 6 份子需求（Phase 1a/1b/2/3/4 + auth）与 Phase 1a 计划。
> 方式：逐份文档审计 + umbrella 绑定决策独立子代理抽取 + live code 复核（`raw_response` 写入、`worker_job` 字段、cookie 真源）。
> 结论：单份质量高；纰漏集中在跨阶段依赖、职责缝隙、上游状态未同步。已就地修正可确定项；决策/安全项经用户 2026-09-23 裁决后落文。

## 已就地修正（文档一致性）

| # | 发现 | 严重度 | 落点 |
|---|------|--------|------|
| A | umbrella 头部过期状态（"未达就绪/blocked"） | 中 | umbrella 头部 |
| G | `knowledge_status/error`、`worker_job` 保留期重复悬置 | 低 | umbrella + Phase 1b/2/4 |
| Phase3-common | `server-common` 抽离须独立前置阶段 | 中 | Phase 3 头部 |
| Phase2-* | 保护区术语、`cos_cleanup` 生产者、module-boundaries owner doc | 低 | Phase 2 |
| 1a-* | Supersedes + Owner-Doc Deltas + 丢图回归定性 | 高/中 | Phase 1a 需求 |
| H | feature-inventory 纳入更新集 | 中 | Phase 1a 计划 |

## 人工裁决结果（2026-09-23，逐点落文）

1. **QWEN 冲突 → 澄清为非冲突**：`QWEN_VISION_PROXY_URL` 为所有部署形态所需（owner doc `2026-07-06-video-analysis-baseline.md:40,69` 保持有效）；"云端 OpenAI SDK 直连"的真实含义是**用 `openai` SDK 连接所配置的 `QWEN_VISION_PROXY_URL`**（仅换调用库，模型/端点/配置不变）。已更正 umbrella（头部冲突行、L41 owner-doc delta、L109、L412、L432）与 Phase 3（头部、In Scope LLM 段、AC）。**Phase 3 的实现前置阻塞门取消**（仅余部署批准 + server-common 前置 + auth 先行）。
2. **先做权限（auth 先行）**：auth 须先于 Phase 3 公网暴露完成（与 Phase 3 互为门控）。已更新 auth 头部前置、Phase 3 头部鉴权前置、umbrella 状态行。
3. **Supersedes → 暂缓**：umbrella L10 三项 + 新增 `2026-08-17-ai-summary-view-markdown` 读路径，维持"待确认"，用户稍后再看。**未改动。**
4. **repair → 选 A**：`repair` 端点/本地修复子系统下线纳入 Phase 1b 范围。已把 Phase 1b item 6 的"范围假设/需确认"改为"已裁决纳入本阶段（选项 A）"。
5. **限流 → 最小成本（IP 锁定）**：实现"同一 IP 多次登录失败后临时封禁"最小防护（Node 内实现不新增依赖）；通用请求限流仍不做。已把 auth 的 In Scope / Business Rules / AC / OOS 相应更新。
6. **`raw_response` 窗口风险 → 无需处理**：用户已人工检视存量数据，确认无 `completed` 且 `raw_response` 非 JSON 的记录，窗口风险消解。已更新 Phase 1a Edge 说明。

## 仍开放（用户暂缓）

- Supersedes 指针（点 3）：待用户回头确认后，在被取代文档头部加"已被取代"指针。

## 复核确认无误（非纰漏）

渲染规格、meta 取值链、`getSummaryWithSegmentsByResource`、错误码有意变更、`worker_job` 字段/租约/心跳、cookie 真源=`app_settings`、COS 公网可读——与 umbrella/reaudit 一致。

## 备注

本次文档编辑因 IDE `Edit` 工具本会话故障（`applyDocumentEdits is not a function`），改用一次性 node 脚本做精确字符串替换完成，替换后已抽样核对；临时脚本已删除。

## 覆盖完备性复核（2026-09-23，第二轮子代理）

对 umbrella 全文 vs 6 份子需求做覆盖核对，发现 2 处实质遗漏 + 3 处中/低遗漏，已全部补齐：

- GAP 1（完整性检查重定义，Q5）：新建 `docs/requirements/2026-09-17-integrity-check-rescope.md`（内容/截图/视频三类、`integrity_status` complete/partial/missing、`integrity_detail` 结构化 JSON、作业化；取代旧 `2026-09-07-summary-integrity-check.md`，Supersedes 待确认）。
- GAP 2（rebuild→screenshot_retry 处理器）：新建 `docs/requirements/2026-09-17-screenshot-retry.md`（本地视频按 timestamp 重截、传 COS、回写 `screenshot_url`，不重跑分析/LLM；作业化）。
- GAP 3（Q12 `enable_thinking`/`response_format`）：登记进 Phase 3 Open Questions。
- GAP 4（Cookie 手动粘贴 + 云端登录承接 + `ParseService` 刷新）：登记进 Phase 3 In Scope（Cookie 段）。
- GAP 5（截图源优先级 + 远端兜底）：登记进 Phase 3 Business Rules，引用既有 3a/3b 与 screenshot-retry。

子需求总数由 6 增至 8；umbrella 状态行、「子需求关系与实现顺序」拓扑/顺序/下线时点、遗留问题 5/7/8 已同步。两份新需求沿用 `2026-09-17-` 前缀与兄弟一致，均标 `前置：Phase 1b/2`、非保护区、需 plan audit。

## 覆盖完备复核结论（2026-09-28，第三轮子代理）

对 8 份子需求 vs umbrella 全文再核：**GAP 1–5 全部 RESOLVED，实质遗漏 = 0**。

- 两份新需求全覆盖 GAP1/2；GAP3/4/5 已分别登记进 Phase 3（Open Questions / In Scope Cookie 段 / Business Rules）。
- Q1–Q16、Business Rules、Data/Model、API、Config 全量逐项 COVERED；Q9 回填已完成、Q14 embedding 不动为有意排除。
- 4 份被取代需求头部取代指针全部 PRESENT 且指向正确后继（人工确认 2026-09-23）。
- 无新引入的实质遗漏 / 矛盾 / 悬空引用；仅 3 处非实质自记录细化（COS HEAD 探测降为可选、`videoMissing` 澄清、截图源顺序三处交叉引用）。

判定：8 份子需求现已构成对 umbrella 的完整、自洽分解，可作为排期与实现的稳定基线。
