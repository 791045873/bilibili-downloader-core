# Log — 2026-09-02 Prisma P4（部署接线与收尾，总 plan 闭合）

- P4 plan（经 subagent 审计 + 用户批准，deployment ask-first）实施完成：
  - 依赖：prisma/cli-engine 转 prod（运行时 CLI）；移除 better-sqlite3 系 + sqlite 迁移脚本归档；`pg` 保留（master plan §5 原表述修正）。
  - Dockerfile.server：runtime COPY prisma.config.ts + src/prisma/；CMD = `prisma db init`（幂等引导）→ `exec node`；start-period 30s。
  - **PoC 关键结论**：`db init` 对未签名存量库（schema 匹配）零操作直接采纳 + 签名——老用户拉新镜像即自动迁移到 Prisma 管理，无需兜底链。
  - 容器冒烟：fresh（20 ops + HTTP 200）与 legacy 未签名（0 ops + HTTP 200）双路径通过。
  - 死代码 findNextCreatedTask 删除；文档收尾（system-baseline 全面更新至 Prisma/PG 现状等）。
- 闭合：subagent 闭合审计发现 5 项文档簿记遗漏（P4 checklist/§8、testing 证据、log、project-context 终态、requirement AC2 偏差注记）——全部修复；advisory（migrations/ gitignore、source-of-truth 陈述、baseline README 部署接线节、feature-inventory SQLite 残留等）一并处理。
- **总 plan 闭合**：P0–P4 全部完成，需求 AC 除 AC2 按偏差注记外全部满足。
- 后续：knowledge-backfill（backlog 下一活跃项，串行约束解除）；Phase 2 向量化 schema 演进走 `contract → emit → migration plan → db migrate`。
