# Log — 2026-09-03 Phase 2 向量化与向量检索 API

- Phase 2 plan（经 subagent 审计 + 用户批准）实施完成：
  - Phase A PoC：A4/A1 被拒 → **A2**（vector 列 contract 外，verify 容忍额外列）+ **W2 两段写**（Prisma 事务后 raw 回写）；`embedding_model` 进 contract（db init 自动加列）。
  - `EmbeddingClient`（adapters/embedding，DashScope OpenAI 兼容 /embeddings，批 ≤20）+ `EmbeddingService`（server，配置解析 + llm.apiKey 来源 + 维度校验）。
  - 发布管道集成：事务前读旧向量索引 → upsert → 事务后复用/补算/raw 回写；缺配置置 failed（空 segments 优先 synced）。
  - 检索 API：`GET /api/knowledge/search?q&k`（raw SQL `<=>` top-k、模型一致过滤、400/503 分支、不降级关键词）。
  - 测试基座换 `pgvector/pgvector:pg17`；ensure-pgvector.mjs 接入 globalSetup 与容器 CMD 链。
- 验证：57/57、typecheck、build、docker:build、compose config、容器冒烟（fresh + 503 语义）全部通过。
- 语义检索真实效果待用户部署后确认；HNSW 索引与维度重算工具留 Phase 4。
