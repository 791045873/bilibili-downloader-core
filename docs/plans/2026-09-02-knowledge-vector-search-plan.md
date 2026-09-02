# Plan：Phase 2 — 总结知识向量化与向量检索 API（pgvector）

> 日期：2026-09-02
> 需求：`docs/requirements/2026-09-01-knowledge-vector-search.md`（决策已由用户确认：DashScope `qwen3.7-text-embedding`、维度 1024、chunk=summary_segment、纯向量 top-k、结果反查 screenshotUrl）
> 前置：knowledge-backfill 已实现（真实回填由用户部署后触发）；Prisma 改造 P0–P4 闭合；**RDS PG 17.0（用户确认）**，支持 pgvector 扩展
> Audit: 已通过独立 subagent 审计并修订，见 `docs/audits/2026-09-02-plan-audit-knowledge-vector-search.md`；**实施含 compose env 变更（deployment 相邻），实施前需用户批准**

## 1. Goal

为 `summary_segment` 每条技巧生成 embedding（DashScope OpenAI 兼容端点 `qwen3.7-text-embedding`，1024 维）存入 pgvector，并提供 `GET /api/knowledge/search` 纯向量 top-k 检索（结果含 screenshotUrl/videoTitle/videoUrl 反查）。发布管道幂等补算；无前端界面。

## 2. 已核实事实与约束

- **schema 所有权已切换**（P3/P4）：列/表变更走 contract → emit → `migration plan` → `db migrate`；raw SQL 现仅保留哨兵 + 2 守卫 claim。pgvector 的 `vector` 类型**大概率不在 Prisma 8 contract PSL 原生类型内**（PoC 决策，见 §4 Phase A）。
- **Prisma 8 `db verify` 对 schema 分歧的拒绝行为已实证**（drill 步骤 4：缺列即 exit 4）；额外对象（unclaimed）的行为未实证——若 contract 无法表达 vector 列且 verify 拒绝"库有 contract 无"的列，则**向量列不能挂在 `summary_segment` 上**，改用 contract 外的独立表 `summary_segment_embedding`（raw SQL 管理，方案 B）。
- `pg` Pool 保留（连接层）：pgvector 检索用 raw SQL（`embedding <=> $1::vector`，pg 驱动以文本传参/返回，解析为 number[]）。
- 本地测试容器 `postgres:17` **不含 pgvector**：测试/演练容器需换 `pgvector/pgvector:pg17` 镜像（globalSetup/演练同步调整）。
- LLM Key 来源（Open Question #2 定论）：`app_settings` 的 `llm.apiKey`（与总结同源，符合需求"不新增用户界面"）；端点 `EMBEDDING_BASE_URL`（默认 `https://dashscope.aliyuncs.com/compatible-mode/v1`）+ `EMBEDDING_MODEL`（默认 `qwen3.7-text-embedding`）+ `EMBEDDING_DIMENSIONS`（默认/固定 1024）env 配置。
- 发布管道现状：`KnowledgePublisherService.publish` → `upsertSummaryKnowledge`（事务内删旧插新 segments）→ `knowledge_status=synced`；**publish 无 synced 守卫**，幂等由调用方重查（backfill 先例）。
- `upsertSummaryKnowledge` 事务内**不得调用 embedding API**（网络 IO 入事务）：先批量生成 → 再事务内携带向量写入。

## 3. Scope

### 3.1 Phase A — pgvector × Prisma PoC（实施第一步，决策树）

1. 本地换 `pgvector/pgvector:pg17` 容器（用户重建 bdl-test-pg：`docker rm -f bdl-test-pg` + 同端口新镜像），`CREATE EXTENSION vector`。
2. 尝试 contract 表达 vector 列，按序探测三个出口：
   - **A4 contract extension**：Prisma 8 migration 走 "app + extensions" 多 space，`prisma contract` 支持 extension authoring——若能用 extension 表达 `vector(1024)`，兼得类型安全与迁移闭环（优先探测）。
   - **A1 原生/Unsupported 列**：PSL 直接表达或 `Unsupported("vector(1024)")`。
   - **A2 contract 外手写迁移**：`migration new` 手写 SQL 加列（不进 contract），实测 `db verify` 对 unclaimed 对象是警告还是失败。
3. **写入机制探测（审计 Major-1）**：Prisma 8 事务内 **无 raw SQL 出口**（已核实 dist 无 queryRaw/executeRaw），且 Unsupported/unclaimed 列对 ORM create 不可见——"事务内携带向量写入"需在两个方案中定一个：
   - **W1 raw 事务**：`upsertSummaryKnowledge` 的该段事务改用 pg Pool client 原生 BEGIN/COMMIT（偏离"数据访问全量 Prisma"基线，需在 project-context/system-baseline 留痕）；
   - **W2 两段写**：Prisma 事务（segments 不含向量）→ 事务后逐行写向量（`embedding` 为空行不参与检索 + 重试幂等路径可恢复，偏离需求"向量随行重建（事务内）"——须作为显式决策留痕）。
4. **决策树汇总**：A4 > A1 > A2 > A3（A3 独立表 `summary_segment_embedding(summary_id, seq, embedding vector(1024), embedding_model, PK(summary_id,seq), FK CASCADE)`，contract 外 raw SQL 管理；哨兵名单增此表；`db init` 不建它 → globalSetup/引导补幂等建表 SQL；`truncateAll` 补表名单）。PoC 结果（分支 + 写机制 W1/W2 + verify unclaimed 行为）写入 §8，决定后续全部实现细节。
5. RDS 扩展启用（OQ#1 定论）：部署前经 RDS 控制台/SQL 窗口启用一次（推荐，避免启动期权限问题）；migration 内保留幂等 `CREATE EXTENSION IF NOT EXISTS vector` 作安全网（经 `migration new` 手写）。**扩展不可用时启动行为 = 阻塞 fail-loud**（与哨兵一致，不做无向量降级）。

### 3.2 写入流（发布管道集成）

- 新增 `EmbeddingClient`（`packages/adapters/src/embedding/`）：OpenAI 兼容 `/embeddings`，Bearer `llm.apiKey`，批量 ≤20，输入文本 = `title + content` 归一化（去空白/换行规整）；失败/超时抛错。
- `KnowledgePublisherService.publish` 在 upsert 前插入选段与向量准备：
  1. 读现有 segments（按 bvid,cid）建立复用索引：**归一化(title+content) 相同**（seq 仅作 tiebreaker，避免中段增删导致全量重算）且 `embedding` 非空且 `embedding_model == 当前配置` → 复用（**Decision**：复用条件在需求规则 3 基础上加文本一致性比对，防止内容已变仍用旧向量）；
  2. 其余 segment 按批 ≤20 调 EmbeddingClient；
  3. 向量写入按 Phase A 探明的 W1/W2 机制执行（见 §3.1.3，决策记录 §8）；
  4. `embedding` 列与 `embedding_model` 列由本流写入；复用行写回原 embedding + 当前模型名。
- 缺 embedding 配置（无 `llm.apiKey` 或模型未配置）：**仅在 segments 非空时判失败**（空 segments → 无向量可写 → synced，优先级高于缺配置）；`knowledge_status=failed`，错误含"缺少 embedding 配置"提示（语义同 Phase 1 缺 COS）。
- 幂等：调用方（backfill/重试入口）重查 synced 跳过（既有语义不变）；本流内复用逻辑见上。
- 空 segments：无向量可写，直接 synced（保持现状）。

### 3.3 检索 API

- `GET /api/knowledge/search?q=&k=`（`knowledge-search.controller.ts` 新）：
  - 400：`q` 空/全空白；`k` 非法（**必须为 1–50 的整数**，缺省 10，越界/非整数一律 400——不做静默 clamp）。
  - 503 语义错误：缺 embedding 配置 / embedding 调用失败。**不降级为关键词搜索**（需求 Edge Cases 既定）。
  - 流程：归一化 q → EmbeddingClient 单条 → raw SQL（pg Pool）：`WHERE s.embedding_model = $2 AND se.embedding IS NOT NULL ORDER BY se.embedding <=> $1::vector LIMIT k`（join summary + summary_segment，A1/A2 列方案）或独立表 join（A3）→ 返回 `[{ segmentId, title, content, score, screenshotUrl, frameDescription, videoTitle, videoUrl, timestampSeconds }]`；无数据返回 `[]`。
  - score = 1 - 余弦距离（`<=>`），如实返回不设阈值。
- 检索仅对 `embedding_model` 与当前配置一致的 segment（需求 Business Rules）。

### 3.4 配置与文档

- env：`EMBEDDING_BASE_URL`、`EMBEDDING_MODEL`、`EMBEDDING_DIMENSIONS`（默认 1024；启动校验与列维度不一致时 fail-loud——维度变更需迁移+重算，属 Phase 4）。
- **compose env 为显式 allowlist**（docker-compose.yml server.environment）：三个新变量需按 `${VAR:-default}` 模式显式加条目，否则容器内静默缺失；`.env.example` 同步。
- 文档：`.env.example`、compose、app-overview（新端点）、codebase-map（Server 行新文件）、project-context 验证表（测试镜像 tag）、`docs/testing/` TD 更新；测试基座镜像换 `pgvector/pgvector:pg17`（含 4 处镜像 tag 字符串与用户重建容器指引）。

### 3.5 测试

- 自动化（vitest + 真实库，容器换 pgvector 镜像后）：① 写入流——发布（mock EmbeddingClient）后 embedding 非空/模型正确；复用逻辑（同文本同 seq 不重算、文本变化重算）；空 segments 置 synced（缺配置时不判失败）；缺配置置 failed。② 检索——余弦 top-k 顺序、模型不一致不命中、空库返回 []、400/503 错误分支。③ 迁移后哨兵/`db verify` 通过；A3 分支下 truncateAll/bootstrap 补表。
- 手工：真实 DashScope 调用 + 语义检索效果（AC"小个子怎么穿显高"）→ 部署后用户确认（user-confirmed）。需求 AC3 的响应形状为本地可测（测试 ② 断言），仅"screenshotUrl 公网可访问"需部署确认。

## 4. Out Of Scope

- 检索前端界面、BM25/RRF 混合检索、query 重写（需求 Out of Scope）。
- 模型/维度变更重算工具（Phase 4）、RAG 问答（Phase 3）。
- 回填数据的历史 embedding 补算脚本（部署后由发布幂等路径自然补算——Business Rules 既定）。

## 5. 风险

| 风险 | 对策 |
| --- | --- |
| contract 无法表达 vector 列 + verify 拒绝额外列 | §3.1 决策树四分支（含 A4 contract extension），PoC 先行；A3 独立表为保底 |
| Prisma 事务内无 raw SQL 出口，向量写入机制未定 | §3.1.3 探测 W1（raw 事务，偏离全 Prisma 基线并留痕）/ W2（两段写，偏离需求"事务内"并留痕），决策记录 §8 |
| fresh 安装顺序：`db init` 先于扩展启用/迁移 | 部署前 RDS 控制台启用扩展（推荐）+ migration 内幂等 CREATE EXTENSION 安全网；扩展缺失启动阻塞 fail-loud |
| 本地/测试容器镜像更换（pgvector/pgvector:pg17） | 用户重建 bdl-test-pg；4 处镜像 tag 字符串 + 文档同步；A3 分支下 truncateAll/bootstrap 补表 |
| embedding API 在事务外的失败窗口（embed 成功但 tx 失败 → 浪费调用） | 接受（成本仅 API 费用，无数据不一致）；失败置 failed 可重试 |
| `EMBEDDING_DIMENSIONS` 可配置与列维度固定的冲突 | 启动校验不一致即 fail-loud；维度变更=迁移+重算（Phase 4） |
| DashScope 配额/限流 | 批量 ≤20 + 复用逻辑最小化调用量；失败置 failed 可重试 |
| raw SQL 注入 | 参数化查询（`$1::vector` 文本参数），q 经 embedding 后为数值数组无注入面 |
| compose env 显式 allowlist 静默丢变量 | 三个新变量按 `${VAR:-default}` 显式加条目 + `.env.example` 同步 |

## 6. 验证与闭合判据

1. Phase A PoC 决策落定并记录 §8。
2. 自动化测试全绿（现有 49+ 用例不回归 + §3.5 新增）；typecheck、build、`docker:build` 通过。
3. 需求 Acceptance Criteria：1/2/5/6/7 本地可验证；3/4（语义检索效果）部署后 user-confirmed。
4. 文档同步（testing TD 更新、logs、project-context、codebase-map、app-overview、.env.example）。
5. 闭合审计：独立 subagent（涉及 schema 演进 + 新外部集成，高风险）。

## 7. Checklist

- [ ] Phase A PoC + 决策（A1/A2/A3）记录
- [ ] EmbeddingClient + 发布管道集成（复用/批量/缺配置语义）
- [ ] 检索 API（raw SQL top-k + 错误分支）
- [ ] 配置/env/文档 + 测试容器镜像切换
- [ ] 自动化测试（写入流/检索流）
- [ ] 全量回归 + 文档同步 + subagent 闭合审计

## 8. 记录区

（实施时填写：PoC 决策、最终表结构、TD 状态、遗留事项。）
