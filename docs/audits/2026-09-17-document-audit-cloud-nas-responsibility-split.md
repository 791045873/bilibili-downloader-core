# Document Audit — 云端 / NAS 职责重划分需求草案（2026-09-17）

## 1. 审计对象与方式

- 对象：`docs/discussions/2026-09-17-cloud-nas-responsibility-split.md`（审计时为 `docs/requirements/`，后按方案 3 移入 discussions），支撑文档 `docs/analysis/2026-09-17-cloud-nas-split-feasibility.md`
- 方式：两次**独立子代理**审计（用户明确要求，补足 `reviewer availability=none` 的限制）
  - Pass A：事实与技术准确性（逐条 `file:line` 复核 + 代码行为核验）
  - Pass B：需求质量、内部一致性、范围、流程与保护区合规
- 结论均经主执行者用 live repo 复核（见 §3）。

## 2. 总体裁决

**技术方向成立、核心事实基本准确，但需求未达实现就绪门槛，不得直接转为计划。**

- 拆分边界（NAS 数据面 / 云端控制面）、真源划分（内容 = 云 DB、截图 = COS、视频 = NAS）、`claimNextCreatedTask` / `claimAiSummaryTask` 认领基座、`onDelete: Cascade`、`raw_response` 为可重建源等关键判断，均与当前代码一致。
- 但存在 5 项 Blocker 级缺陷（§4）与 3 项 owner-doc / 既有需求冲突未声明（§5），且 9 个牵涉 schema / 契约 / 部署的决策未裁决。
- 按 `ai-autonomy-policy.md:68`，部署（`ask-first`）与数据删除（`ask-first`）在 `reviewer availability=none` 下实现必须保持 blocked。

## 3. 事实纠正（已用 live repo 复核）

| # | 原表述 | 实际 | 证据 |
| --- | --- | --- | --- |
| F1 | 截图命名 `segment-N.jpg`（需求 §8.2、Q10） | 实际为 `${filenamePrefix}-frame-${i}.jpg`，即 `segment-0-frame-0.jpg` | `packages/adapters/src/ffmpeg/ffmpeg-screenshot.ts:91`；`analysis-engine.ts:349-355,425`；`knowledge-publisher.service.ts:137,144-145` |
| F2 | `ai-autonomy-policy.md:62` 为部署保护区 | 部署保护区在 `:63`，`:62` 是 payment | `docs/context/ai-autonomy-policy.md:61-63` |
| F3 | 分析 §3.2.1「没有持久化作业队列」 | 表述过强：高清下载已有持久化认领（`task` 行 `created → downloading` 守卫 UPDATE），真正内存态的是并发集 / 低清队列 / 回调 | `database.service.ts:586-609`；`download-scheduler.ts:30-33,53-93,220-291` |
| F4 | Q10「段 ID 稳定」作为原地更新的主要理由 | 目前**无任何持久化消费方**引用 `summary_segment.id`（`reply_sources` 只存 bvid/cid 等，不含 segmentId） | `chat.types.ts:15-25`；`chat.service.ts:322-353`；`database.service.ts:1563,1630` |
| F5 | `QwenClient` 直连为「唯一确定的实现工作」 | 代码中不存在多模态直连端点配置或 OpenAI↔DashScope 原生格式转换；`DASHSCOPE_NATIVE_API_URL` 是私有原生端点，兼容基址只配给 embedding | `qwen-client.ts:143-161`；`analysis.controller.ts`（native 基址）；`embedding.service.ts` |

补充说明（非错误，但被简化）：截图源解析实为**三级**——远端流 → 已完成本地下载（quality≥80）→ 同步重下；主链路在本地高清存在时本就直用本地。`analysis-video-resolver.ts:173-207,209-235,270-315`。

## 4. 缺陷（按严重度）

### Blocker

**B1. `completed` 与「存在 `summary` 行」不等价，云端 DB 渲染会漏读。**
当前 `completed` 在 publish 之前写入，且 `summary` 行只在发布成功后存在（`analysis-trigger.service.ts:481-517`；`database.service.ts:1423-1459`）。若渲染源严格限定为 `summary + summary_segment`，则「`completed` 但从未 synced / 同步失败」的记录在云端**连正文都渲染不出**。Q8/Q9 只覆盖了「有文本无图」，未覆盖「无 `summary` 行」。
建议：明确渲染兜底——优先 `summary+segments`，缺失时回退 `ai_summary_task.raw_response` 用纯函数 `generateMarkdown` 现渲；并把「发布成功才置 `completed`」写成渲染契约。

**B2. 重总结「按 (summary_id, seq) 原地 upsert」会遗留陈旧向量。**
两段写的第二步只回写「有向量」的行（`knowledge-publisher.service.ts:264-271`；`database.service.ts:1517-1528`）。删旧插新时未算出向量的段为 NULL 并被检索过滤（`:1557`）；改为原地更新后，文本已变但第二步失败 / 跳过的行会**保留旧向量**，造成文本与向量不匹配且仍被 pgvector 命中（静默错误）。
建议：文本变化时显式 `embedding = NULL` 再回写。

**B3. 内联发布失去本地 md 后，「段 ↔ 截图」映射无替代实现。**
现发布器靠解析本地 md 的图片 URL、按 basename 前缀匹配段（`knowledge-publisher.service.ts:123-162`），并改写本地 md（`:183-187`）。`AnalysisOutput.screenshotFiles` 是扁平列表，段级图片关系（`processedSegments[].images`）未对外暴露。
建议：让 `AnalysisEngine` 输出 `segments[].screenshotFiles`，发布器按结构映射，不再回读 md。

**B4. 云端多模态「直连」缺端点配置与格式转换（被低估）。**
见 F5。直连需要：可配置多模态基址 env、`image_url/video_url` → DashScope 原生 `{image}/{video}` 转换、原生响应 → `choices[].message.content` 提取。
建议：在需求/计划中显式包含该适配契约。

**B5. 历史 `completed` 无图时的用户可见渲染语义未定（Q8 明确推迟）。**
直接决定 AC 与前端契约；与「图文完备」硬门存在表述矛盾。

### High

- **H1. COS 前缀清理无底层能力。** `CosStoreService` 只有 `upload` / `uploadBuffer` / `publicUrl`，**无 list / delete**（`cos-store.service.ts:70-145`）。Q10 的清理作业需新增 COS API 封装。
- **H2. 角色拆分未定义「角色 → 路由 / 模块」白名单。** `POST /api/analysis/run`、`/summary-tasks/repair`、`/rebuild`、`/integrity-check` 都需本地磁盘 / ffmpeg；`api` 角色若不硬禁会误跑并失败；`main.ts:24-27` 还会在无 NAS 卷时挂载空 `/summary-files`。
- **H3. 完整性检查新语义未定义取哪条 task。** 同资源可能有多条 task（`findLatestTaskByBvidAndCid` vs `findCompletedTaskByBvidAndCid`），未定取值与多任务不一致时的判定。
- **H4. `summary.raw_response` 为 `Jsonb` 且发布强制 `JSON.parse`。** 失败路径可能把错误字符串写入 `ai_summary_task.raw_response`（`analysis-trigger.service.ts:529-536`）；需约束 `summary` 只由合法 JSON 源写入，且 rebuild 校验源为模型 JSON。
- **H5. 迁移 / 回填的顺序、门控、半成功恢复与 rollback 未写。**

### Medium

- 后端角色拆分未列入可观测性（队列积压 / 离线告警 / heartbeat 日志）与 **cancel 语义**（分析 §10.5 要求，但 job kind 列表缺 cancel）。
- 失败 / 空 / 加载 / 超时状态与 409 / 503 语义变化的映射缺失。
- 鉴权方案与「对外访问」目标冲突（见 §5）。
- COS 公网 / 签名 URL 可达性与安全无方案。

## 5. 流程与真源冲突（Pass B）

1. **Owner-doc 正面冲突**：`docs/architecture/2026-07-06-video-analysis-baseline.md:40,69` 明写「所有部署形态均需配置 `QWEN_VISION_PROXY_URL`，无公网 URL 直连路径」。这与本草案「云端多模态 URL 直连、不设代理」直接冲突。该文件是 vision-proxy 的 owner doc（`module-boundaries.md:43`）。用户已人工确认端点支持 URL，但**仍需显式更新该 owner doc**（人工批准）。
2. **既有需求取代关系未声明**：
   - `2026-09-07-summary-integrity-check.md` 的 Non-Goals 明确「不检查视频文件本体、不检查 COS 对象」，本草案 Q5 恰好纳入，需声明 supersede。
   - `2026-08-24-cos-summary-knowledge-publish.md`（影子双写 / `knowledge_status` / publish）、`2026-09-01-knowledge-backfill.md`（回填子系统）需声明下线范围；但 API Impact 未列 `POST /api/summary-tasks/:id/publish`、`POST/GET /api/knowledge/backfill` 的移除。
3. **Implementation-Ready Gate**：3 项 FAIL（in-scope 具体度、roles/permissions、错误/空/加载态）、4 项 PARTIAL（主流程、data/model、API、AC）。
4. **内部矛盾**：Q1 图文硬门 vs Q8 历史无图；Out Of Scope「业务语义不变」vs Q1/Q3/Q4/Q10 的行为与模型变更；Phase 3「环境变量切换」vs Q6「两个镜像」。
5. **保护区证据未落实**：deployment 需 owner doc + Dockerfile 验证；数据删除需 owner doc + tests；auth 需 owner doc + tests。文件仅笼统写「owner docs 同步更新」。
6. **目录定位**：`docs/requirements/README.md:8-10` 要求此处只放实现就绪的合成需求；本文件自述 draft、非就绪、多 phase，宜先留 `docs/discussions/` 或注明越权理由，并补 backlog 登记。

## 6. 已确认有效、可保留的判断

- 网络模型「NAS 仅出站、控制走 DB、数据走 COS」与作业 claim / lease / heartbeat 方向正确。
- 「触发是投递作业，不是调用 NAS」正确，且下载已有持久化认领基座。
- 「云端不 join 媒体路径」作为硬约束正确且必要。
- 截图源排序目标（本地高清 → 下载 → 远端兜底）与 LLM 用低清的方向正确。
- Q1（图文完备硬门）、Q2（远端兜底）为用户裁决，保留。

## 7. 建议的整改顺序

1. 人工裁决 B1、B2、B3、B4、B5 五项契约问题（渲染兜底源、发布与 completed 先后、向量失效、段↔截图映射、直连端点契约）。
2. 声明 Supersedes 关系并更新冲突 owner doc（尤其 `2026-07-06-video-analysis-baseline.md`）。
3. 将需求拆为可独立计划/审计的切片，优先 **Phase 1a：纯读取侧 DB 渲染 + 云端不 join 媒体路径**（无 schema 变更、无数据删除），先落地。
4. 修订 §3 事实错误与 §5 内部矛盾，补 Deployment/Config、Testing/Observability、Local-Copy Lifecycle、Cancel 语义。
5. Phase 1b/2/3/4 各自另立需求；部署与数据删除在人工批准前保持 blocked。

## 8. 审计后澄清与裁决（2026-09-17，用户质询后）

**B1（completed ≠ 存在 `summary` 行）—— 确认成立。**
证据链：
1. `runAnalysis` 先把 `ai_summary_task.status` 置 `completed`（`analysis-trigger.service.ts:481-490`），**之后**才 fire-and-forget 调 `publish`（`:497-517`）。
2. `summary` 行只在 `upsertSummaryKnowledge` 内创建（`database.service.ts:1423-1442`），即只有在 publish 成功执行到那一步才存在。
3. publish 失败或 COS 未配置时只写 `knowledge_status=failed` 并返回，不建 `summary` 行（`knowledge-publisher.service.ts:70-78,199-210`）。
4. 历史记录（知识发布功能 2026-08-24 之前）也普遍是 `completed` 且无 `summary` 行。
结论：`completed` 是**分析任务生命周期状态**，与"云端知识已发布"无关。云端渲染若只读 `summary`+`summary_segment`，这类记录连正文都渲染不出 → 需渲染兜底（回退 `ai_summary_task.raw_response` + 纯函数 `generateMarkdown`），并把"发布成功才置 completed"写成新流程契约。

**B2（原地 upsert 的陈旧向量）—— 裁决：删除旧向量。**
用户确认：静态字段与文本可原地 upsert，但旧向量必须删除。实现要求：文本归一化后发生变化时，先 `embedding = NULL`（必要时 `embedding_model = NULL`）再重算写回；段数减少时删除尾部行（其向量随之删除）。这样在第二步失败/跳过时该段为 NULL、被检索过滤（`database.service.ts:1557`），不会残留旧向量被 pgvector 静默命中。

**B3（段 ↔ 截图映射）—— 降级：不是根本阻塞，属实现管道问题。**
用户观点正确：截图路径由规则确定。`AnalysisEngine.buildOutput` 对每个段以 `filenamePrefix: segment-${si}` 调截图（`analysis-engine.ts:349-355`），产出 `segment-${si}-frame-0.jpg`（`ffmpeg-screenshot.ts:91`），并已在内部 `processedSegments[].images` 持有映射。问题仅在于：`AnalysisOutput` 只对外暴露扁平 `screenshotFiles`（`analysis-engine.ts:64-66,460-463`），而 `KnowledgePublisherService` 只收到 `summaryPath`，于是**从本地 md 反解**映射（`knowledge-publisher.service.ts:123-162`）。去掉 md 后需改为：让引擎直接输出 `segments[].screenshotFiles`（或结构化映射），发布器按结构使用，不再回读 md。非阻塞，但需在计划中显式包含。

**B4（多模态直连格式）—— 解除。**
用户确认该端点调用方式兼容 OpenAI：直接由 OpenAI Node SDK 负责请求/响应格式，无需自写 DashScope 原生转换。仅剩兼容基址路径（现原生基址 `.../api/v1`）与 `enable_thinking` / `response_format` 的处理细节。

**B5（历史 `completed` 无图的可见语义）—— 澄清 + 待裁决。**
`completed` 指 `ai_summary_task.status = 'completed'`：一次分析成功跑完（LLM 返回 + 截图 + 写 md）后置入，与云端发布无关。在"图文完备"硬门（Q1）之前产生的历史 `completed` 记录，其截图可能从未上传 COS。需要裁决历史记录在云端的呈现：先回填后开放 / 文本占位 / 未回填前返回 409。建议：回填作为 Phase 1 门控项，回填完成前对历史记录渲染正文、图片缺省（并在 UI 标注）。

**B1/B5 后续修订（用户，2026-09-17）—— `completed` 重新定义，两 blocker 消解。**
用户重新定义：`completed` = **分析任务结束且最终分析结果（文本内容）已完整、正确写入云 DB**；**截图是否入 COS 不阻塞 `completed`**，作为独立、可手动重试的事项。
- B1 消解：完成门槛改为"内容入库"，即 `completed` 保证存在 `summary` + `summary_segment`；云端渲染可靠读 DB。历史"completed 无 summary 行"仍属异常/待回填，保留渲染兜底（回退 `ai_summary_task.raw_response`）。
- B5 消解：图片缺失成为**正常可发生状态**，由 `screenshot_url` 为空表示，前端缺省展示并提供"重试截图"入口（NAS 作业，按已存时间戳重截，不重跑分析/LLM）。
- 连带修改：撤销"COS 必需配置""图文完备硬门"结论；`rebuild` 语义收窄为"重试截图"（md 已改为 DB 现渲，无需再生成）。
