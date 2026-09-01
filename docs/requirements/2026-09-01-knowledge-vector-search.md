# 需求：总结知识向量化与向量检索 API（Phase 2）

> 来源：`docs/discussions/2026-08-21-summary-cloud-knowledge-base.md`（向量化设计 + 检索设计，已收敛）
> 前置：Phase 1 知识发布管道已完成并关闭（`docs/requirements/2026-08-24-cos-summary-knowledge-publish.md`）

## Goal

把每条技巧（`summary_segment`，含 `title + content`）向量化存入云端 PostgreSQL（pgvector），并提供向量检索 API：根据用户提问在向量库中搜索关联技巧，且**搜索结果必须能反查到该技巧对应的图片（`screenshot_url`，COS 公网 URL）**，为 Phase 3 问答服务（三段式引用）提供检索基座。

## 决策（用户确认）

1. **Embedding 模型：DashScope `qwen3.7-text-embedding`**（2026-09-01 确认）：与现有 DashScope/LLM 通道同源；维度取 **1024**（官方通用场景推荐值，256~2560 可选）。
2. **chunk 单元 = `summary_segment` 本身**（一条技巧一条向量，不切分不合并）；embedding 文本 = `title + content`；`frame_description` 不进 embedding（保留作展示元数据）。
3. **检索起步为纯向量 top-k**（k 默认 10）；BM25/RRF 混合检索、query 重写后置。
4. **搜索结果反查图片**：结果项必须携带 `screenshot_url`（COS 公网 URL）及来源视频元数据。

## In Scope

- **pgvector 接入**：云端 PostgreSQL（阿里云 RDS `ai_summary` 库）启用 pgvector 扩展；`database.service.ts` 启动建表流程中确保扩展可用（`CREATE EXTENSION IF NOT EXISTS vector`，方式见 Open Questions）。
- **schema 变更**：`summary_segment` 新增 `embedding vector(1024)` 与 `embedding_model TEXT`（记录生成该向量的模型，便于后续模型/维度变更时识别需重算的数据）。
- **向量化写入**：知识发布管道（`knowledge-publisher.service.ts`）在 segments upsert 成功后，为每个 segment 调用 `qwen3.7-text-embedding` 生成向量并写回 `embedding` 列（批量，单批 ≤20 条）；embedding 失败则整体置 `knowledge_status=failed`，复用现有重试入口恢复（与 Phase 1 失败语义一致）。
- **embedding 文本归一化**：`title + content` 去空白/换行规整；query 端使用同款归一化。
- **检索 API**：新增 `GET /api/knowledge/search?q=<用户问题>&k=<可选，默认 10>`：
  1. query 归一化 → 调用同款 embedding 模型生成 query 向量（同维度 1024）；
  2. pgvector 余弦相似度 top-k 检索；
  3. 返回结构（每条）：

  ```json
  {
    "segmentId": 123,
    "title": "技巧标题",
    "content": "技巧内容",
    "score": 0.83,
    "screenshotUrl": "https://<bucket>.cos.<region>.myqcloud.com/summary/<bvid>-<cid>/screenshots/segment-N.jpg",
    "frameDescription": "画面描述（可 null）",
    "videoTitle": "来源视频标题",
    "videoUrl": "B 站视频链接",
    "timestampSeconds": 150
  }
  ```

  - **`screenshotUrl` 为必返字段**（该技巧无截图时为 `null`，调用方降级）；`videoUrl + timestampSeconds` 供 B 站 `?t=` 跳转。
  - 字段名映射：`segmentId` = `summary_segment.id`（表主键，库内列名为 `id`，响应序列化为驼峰）；其余字段同理对应 `summary_segment` / `summary` 列。
  - 返回 `score`，阈值过滤交由调用方（Phase 3）决定，本 API 只做 top-k。
- **配置**：embedding 调用走 DashScope OpenAI 兼容端点；API Key 复用现有 LLM Key 配置来源（不新增用户配置界面；具体来源与优先级由 plan 细化）；`EMBEDDING_MODEL`（默认 `qwen3.7-text-embedding`）与 `EMBEDDING_DIMENSIONS`（默认 1024）可配置。
- **Docker**：`.env.example` / compose 补充新增环境变量说明。

## Out Of Scope

- RAG 问答服务、`conversation` / `message` 表、多轮对话、三段式回答拼装（Phase 3）。
- 用户穿搭照片（问答场景一）。
- BM25 全文 / 混合检索 / query 重写（数据量增长后评估）。
- 历史 89 条已完成总结的回填（已拆出独立需求 `docs/requirements/2026-09-01-knowledge-backfill.md`，用户部署镜像后手动触发一次；本需求在其之后实施）。
- 前端检索界面（本阶段仅后端 API，可经 HTTP 手工验证）。
- embedding 模型/维度变更后的存量重算工具（记 Open Question，Phase 4 处理）。

## Main User Flows

（本阶段无终端用户界面；主流程为服务端数据流）

1. **写入流**：AI 总结完成 → Phase 1 发布管道（截图 COS + segments upsert）→ 批量生成 embedding → 写回 `summary_segment.embedding` → `knowledge_status=synced`。
2. **检索流**：调用方 `GET /api/knowledge/search?q=小个子怎么穿显高` → query 向量化 → pgvector top-k → 返回含 `screenshotUrl` 的技巧列表。

## Business Rules

- 一条技巧 = 一条向量；embedding 文本恒为 `title + content`（归一化后），不混入其他字段。
- 向量与 segments 同生命周期：重总结按 `(bvid,cid)` 删旧插新时，向量随行重建（事务内）；删除总结级联删向量。
- 发布重试幂等：已 synced 的 segment 重发时不重复生成/重算向量（`embedding` 非空且 `embedding_model` 与当前配置一致则跳过，md/截图沿用既有逻辑）。
- embedding 模型或维度配置变更后，旧向量与新 query 向量不可比：检索时仅对 `embedding_model` 与当前配置一致的 segment 检索（不一致的行不参与匹配，避免静默混比）。
- `embedding` 为空的 segment（回填先于向量化产生的存量）不参与检索；其向量在 Phase 2 部署后经发布管道幂等路径补算（`embedding` 非空且模型一致才跳过，为空则补算），无需专门脚本。
- 缺 embedding 配置（模型/Key）：发布置 failed（错误含缺配置提示），语义同 Phase 1 缺 COS 配置；检索 API 返回明确错误（503 语义）。
- 无命中/低相似度不在本阶段做兜底文案（属 Phase 3 生成侧职责），本 API 如实返回空数组或 top-k + score。

## Roles / Permissions

- 单用户工具，无角色/权限系统，检索 API 无鉴权（与现有 `/api/*` 一致；公开运营评估后置）。
- DashScope API Key：沿用现有密钥管理（不入库日志、不进镜像、不进 git）。

## Edge Cases

- 空总结/无 segments：无向量可写，置 synced，检索自然不命中该视频。
- `q` 为空或全空白：400 错误。
- `k` 缺省 10、上限 50（防滥用），非法值 400。
- `screenshotUrl` 为 null 的 segment（历史回填前/截图缺失）：正常返回，字段置 null。
- embedding API 调用失败/超时：写入流 → `knowledge_status=failed` 可重试；检索流 → 返回错误，不降级为关键词搜索（纯关键词不满足"意图-知识点语义鸿沟"约束）。
- pgvector 扩展不可用：server 启动建表给出明确错误（阻塞启动还是降级为无向量模式 → Open Question #1）。
- 检索时库内无任何已向量化数据：返回空数组。

## Open Questions

1. **pgvector 在阿里云 RDS 的启用方式**（非阻塞，plan 前验证）：RDS PostgreSQL 支持 pgvector 扩展；确认是经 server `CREATE EXTENSION IF NOT EXISTS vector`（需账号权限）还是控制台/SQL 窗口手动启用一次。扩展不可用时启动行为（阻塞 vs 降级）由 plan 定。
2. **API Key 来源**（非阻塞）：复用 `app_settings` 现有 LLM Key 还是新增独立配置项——plan 阶段对照现有配置结构定，不新增用户界面。
3. **模型/维度变更的重算工具**（非阻塞，Phase 4）：记录 `embedding_model` 已为本需求铺垫，重算脚本后置。

## Acceptance Criteria

- [ ] RDS 库启用 pgvector；`summary_segment` 具备 `embedding vector(1024)` 与 `embedding_model` 列。
- [ ] 新总结发布后，每个 segment 的 `embedding` 非空且 `embedding_model=qwen3.7-text-embedding`；发布失败（含 embedding 失败）可经重试入口恢复。
- [ ] `GET /api/knowledge/search?q=<穿搭问题>` 返回 top-k 技巧，每条含 `title`、`content`、`score`、`screenshotUrl`、`videoTitle`、`videoUrl`、`timestampSeconds`；`screenshotUrl` 可公网访问（或明确为 null）。
- [ ] 语义不同字面的问题（如"小个子怎么穿显高"）能命中表述不同的技巧（如"高腰线显腿长"），验证向量检索（非关键词）生效。
- [ ] 重总结后向量随 segments 全量替换；重复发布不重算未变更向量（幂等）。
- [ ] `embedding_model` 与当前配置不一致的 segment 不参与检索结果。
- [ ] `pnpm typecheck`、`pnpm build` 通过；新增环境变量在 `.env.example` / compose 有说明。
