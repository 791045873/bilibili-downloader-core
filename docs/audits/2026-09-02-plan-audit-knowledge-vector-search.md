# Plan Audit — Phase 2 向量化与向量检索（pgvector）

- 计划：`docs/plans/2026-09-02-knowledge-vector-search-plan.md`
- 需求：`docs/requirements/2026-09-01-knowledge-vector-search.md`
- 审计日期：2026-09-02
- 审计方式：独立 subagent（只读审计 + live 核对，含 Prisma 8 dist 源码核实）。涉及 schema 演进与外部集成 → 闭合采用独立 subagent 审计（高风险）。

## 结论

VERDICT: PASS WITH REVISIONS → 修订后 approved。需求覆盖核对完整（全部规则/边界/AC 有落点）；"事务内携带向量写入"原表述不可行（已核实 Prisma 8 无 raw SQL 事务出口 + Unsupported/unclaimed 列 ORM 不可见）——已转为 Phase A 显式探测项（W1/W2 二选一留痕）。

## 发现与吸收

1. **Major（写入机制）**：Prisma 8 dist 无 queryRaw/executeRaw，事务内无法 raw SQL；Unsupported/unclaimed 列 ORM create 不可见。Phase A 补写入机制探测：W1 raw 事务（偏离全 Prisma 基线，留痕）/ W2 两段写（偏离需求"事务内"，null 向量不参与检索 + 重试幂等可恢复）。
2. **Major（fresh 安装顺序）**：容器 CMD `db init` 先于迁移——RDS 控制台预启用扩展（推荐）+ `migration new` 幂等 CREATE EXTENSION 安全网；扩展缺失启动阻塞 fail-loud（OQ#1 定论）。
3. **A4 分支补充**：Prisma 8 contract 支持 extensions 多 space——优先探测 extension 表达 vector，可能兼得类型安全与迁移闭环。
4. **测试基座（Medium）**：镜像更换影响 4 处 tag 字符串 + 用户重建容器指引；A3 分支下 truncateAll/bootstrap 补表。
5. **复用键（Non-blocking，采纳）**：归一化文本为主、seq 作 tiebreaker（防中段增删全量重算）。
6. **语义钉死（Minor，采纳）**：缺配置仅在 segments 非空时判失败（空 segments → synced）；k 必须 1–50 整数否则 400（不 clamp）；检索显式"不降级关键词搜索"；AC3 响应形状本地可测、公网可访问留部署确认。
7. **compose env（Minor）**：server.environment 为显式 allowlist——新变量需 `${VAR:-default}` 条目，否则容器静默缺失。
8. **核对无误**：复用条件细化（文本一致）不与需求规则 3 冲突（更严格）；复用读在事务前正确（事务内删旧行）；backfill 存量行经发布幂等路径补算无需脚本；哨兵各分支调整已定义；串行约束/治理合规。
