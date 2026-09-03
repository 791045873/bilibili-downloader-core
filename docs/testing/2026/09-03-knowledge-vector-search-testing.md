# Testing — Phase 2 向量化与向量检索 API

- 日期：2026-09-03
- Plan：`docs/plans/2026-09-02-knowledge-vector-search-plan.md`
- 结果：**PASS**（57/57 tests；typecheck、build、docker:build、compose config、容器冒烟通过）

## Phase A PoC 结论（决策树落定）

- A4（contract extension）与 A1（PSL 原生/Unsupported）均被拒（`PSL_UNSUPPORTED_FIELD_TYPE`）。
- **A2 落地**：vector 列在 contract 外，`db init`/`db verify` 容忍额外列（实测 unclaimed 不报错）；`embedding_model` 进 contract 由 `db init` 自动加列。
- **W2 两段写**：Prisma 事务（segments 契约列）→ raw SQL 回写 embedding + embedding_model（事务内无 raw SQL 出口，已核实 dist）。
- 引导：`scripts/ensure-pgvector.mjs`（幂等 CREATE EXTENSION + ADD COLUMN），接入容器 CMD 链与 vitest globalSetup；测试容器换 `pgvector/pgvector:pg17`（0.8.6）。

## 自动化测试（新增 8 用例，文件 `tests/knowledge/vector-search.test.ts`）

| 覆盖 | 断言 |
| --- | --- |
| 发布→向量化 | 2 segments 全部 embedding 非空、embedding_model 正确、knowledge_status=synced |
| 幂等复用 | 同内容重复发布 embedTexts 仅调 1 次（归一化文本匹配 + 模型一致） |
| 内容变化重算 | 改 1 段文本后仅重算，向量 z 分量按新值落库 |
| 空 segments | 无 embedding 调用、直接 synced |
| 缺配置 | publish rejects、knowledge_status=failed、错误含"缺少 embedding 配置" |
| 检索 top-k | 余弦排序（score 降序）、字段形状（segmentId/score/videoTitle/videoUrl/screenshotUrl null 容忍） |
| 模型过滤 | embedding_model 不一致不参与检索 |
| 空集 | 返回 [] |

全量：9 文件 **57/57** 通过（既有 49 用例不回归）。

## 基础设施与部署验证

- `docker:build` 成功；容器 fresh 冒烟：db init（20 ops，新 hash `5f0ca193…` 含 embedding_model 列）→ `pgvector ensure OK` → boot + 播种；`embedding`/`embedding_model` 两列就绪。
- `GET /api/knowledge/search?q=test`（未配置 llm.apiKey）→ **503**（缺配置语义正确）。
- compose config 通过（EMBEDDING_* 三个新 env 条目 `${VAR:-default}`）；`.env.example` 已注明。
- 哨兵未动（embedding_model 由 db init 保障、vector 列由 ensure 保障）。

## 部署验收（user-confirmed 待办）

- RDS 控制台启用 pgvector 扩展（PG 17.0 支持）；部署新镜像后 `db init` 自动加 `embedding_model` 列 + ensure 建 vector 列。
- 触发回填/单条发布 → embedding 真实生成；语义检索效果（"小个子怎么穿显高" 命中"高腰线显腿长"）人工确认。

## 差异记录

- 检索/向量写入走 raw SQL（pg Pool）——与守卫型 claim 同类的 contract 外例外，已更新 project-context/codebase-map 表述。
- embedding 复用条件在需求规则 3 基础上加归一化文本一致性比对（防内容变更仍用旧向量）。
