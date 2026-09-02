# Plan：P4 — 收尾与部署（ask-first，需用户批准本 plan 后实施）

> 日期：2026-09-02
> 总 plan：`docs/plans/2026-09-01-prisma-introduction-master-plan.md`
> 需求：`docs/requirements/2026-09-01-prisma-orm-introduction.md`
> 前置：P0、P1、P2a–P2d、P3 已闭合
> **前置确认（用户提供）**：云端阿里云 RDS 为 **PostgreSQL 17.0** ✓（满足 Prisma Next ≥15）
> Audit: 已通过独立 subagent 审计并修订，见 `docs/audits/2026-09-02-plan-audit-prisma-p4-cleanup-deployment-plan.md`；**实施前需用户批准本 plan——deployment 保护区（ask-first）**

## 1. Goal

把 Prisma schema 工作流接线进 Docker 部署与启动命令，完成依赖清理与文档收尾，Prisma 改造总 plan 闭合。**部署行为变化点**：容器启动时自动执行 schema 引导（`db init`，幂等）——这是 ask-first 保护区变更，获用户批准本 plan 即为实施授权。

## 2. 已核实事实

- `pg` **必须保留**（运行时依赖）：连接池（connectWithRetry、哨兵）、两个守卫型 claim raw SQL 均走 `pg` Pool；P1 时空想"移除 pg"已被 P2/P3 实际演进推翻（master plan §5 P4 行"移除 pg/@types/pg"过时，本 plan 显式修正：**`pg`/`@types/pg` 保留**）。
- `better-sqlite3`/`@types/better-sqlite3` 仅被 `migrate-sqlite-to-postgres.mjs` 使用（历史工具）→ 归档脚本 + 移除依赖。
- `prisma`/`@prisma/cli-engine` 目前在 devDependencies → **容器运行时不可用**；P3 已把 schema 引导定为容器启动职责，故需移入 dependencies（镜像体积代价换部署正确性）。
- Dockerfile.server：`pnpm deploy --prod` 产 runtime；CMD 为裸 `node /app/dist/main.js`；`--ignore-scripts` 意味 postinstall 不运行（P1 审计已知）。
- `findNextCreatedTask` 死代码（P2d 确认零消费方）。
- `findTasksByBvidsAndCids` 等其余域方法已 Prisma 化（P2 收官）。
- 演练实证：`db init` 对已签名库 0 操作幂等；对**未签名存量库（schema 匹配）的行为未实证**——P4 实施期 PoC 决定 CMD 链形态。

## 3. Scope

### 3.1 依赖调整（packages/server/package.json）

- `prisma`、`@prisma/cli-engine`：devDependencies → **dependencies**（运行时镜像需 CLI 执行 schema 引导与未来迁移）。
- 移除 `better-sqlite3`、`@types/better-sqlite3`；`scripts/migrate-sqlite-to-postgres.mjs` 移入 `scripts/one-off-migrations/`（README 注明：如需再用临时 `pnpm add -D better-sqlite3`）。
- 移除 `scripts/migrate-sqlite-to-pg` package script。
- **保留** `pg`/`@types/pg`（master plan §5 P4 行"移除 pg"按实际架构修正——连接池/哨兵/守卫 claim 仍依赖；偏差记录于 §8）。

### 3.2 Dockerfile.server 适配（部署接线）

- builder/runtime 均需可用 CLI：`prisma` 移入 dependencies 后 `pnpm deploy --prod` 自然带入。
- runtime 层 COPY：`packages/server/prisma.config.ts` 与 `packages/server/src/prisma/contract.prisma`（contract.json 已随 dist；`src/prisma/` 目录一并 COPY 供 CLI 与未来 `migration plan` 使用）→ 布局 `/app/prisma.config.ts` + `/app/src/prisma/*`（config 的相对路径 `./src/prisma/contract.prisma` 在 cwd=/app 下成立）。
- **启动命令**：`CMD ["sh", "-c", "node_modules/.bin/prisma db init --verbose && exec node --env-file-if-exists=.env /app/dist/main.js"]`——`db init` 幂等（fresh 建表 / 已签名 0 操作）；对未签名存量库的行为由 §5 PoC 定（若 init 不采纳 legacy，则改为 `prisma db sign || true; prisma db init` 链或等价脚本，以 PoC 结果为准写入 §8；`|| true` 的安全性依据：drill 步骤 4 证明 sign/init 自守卫拒绝分歧，不会静默采纳——若采用须在 §8 记录该推理）。`exec node` 保持 tini 的 PID 1 信号语义；compose 传入的 `DATABASE_URL` 环境变量优先于 env-file（镜像内无 .env，.dockerignore 已排除）。
- HEALTHCHECK `--start-period` 10s → 30s（为 db init 启动耗时留量；unhealthy 不触发重启，仅观测性优化）。
- tini/端口/卷不变。

### 3.3 死代码与文档

- 删除 `findNextCreatedTask`（P2d 确认零消费方、零测试覆盖）。
- 文档收尾：codebase-map（Server 行守卫描述微调）、`packages/server/prisma/baseline/README.md`（部署接线一节：镜像内路径 + 启动引导命令）、`packages/docker/.env.example`（如无新变量则注明"无新增"）、`docs/architecture/system-baseline.md`（部署形态：启动引导命令）、app-overview 如有 DDL 描述则更新。
- **总 plan §5 P4 行修正**：闭合时把"移除 pg/@types/pg"标注为已按实际架构修正（pg 保留：连接池/哨兵/守卫 claim 依赖），遵守 source-of-truth 优先级。
- project-context：技术基线/Active requirement/Active plan 终态更新；验证表（如 docker 相关命令不变则不动）。

## 4. Out Of Scope

- Phase 2 向量化（pgvector embedding 列——其时走 `migration plan`/`db migrate`）。
- knowledge-backfill 需求（Prisma 闭合后按 backlog 串行实施）。
- Prisma/CLI 版本升级策略、`pg` → driver adapter 重构。

## 5. 风险

| 风险 | 对策 |
| --- | --- |
| `db init` 对未签名存量库不采纳 → 老用户升级启动失败 | 实施期 PoC（initSchema 建的未签名库上跑 `db init`）；失败则 CMD 链加 `db sign` 兜底；哨兵仍是最后防线 |
| 容器内 CLI/config 路径错配（cwd、contract 相对路径、`--ignore-scripts`） | 构建后 `docker run` 实测三条路径（fresh/存量/noop）；`--ignore-scripts` 与 prisma 无 postinstall 依赖，确认 CLI 可执行 |
| 镜像体积增加（prisma CLI 入 runtime） | 接受（NAS 部署非镜像体积敏感）；记录体积变化 |
| 移除 better-sqlite3 破坏历史工具 | 归档 + README 恢复说明 |
| 部署改动引入启动回归 | 容器冒烟：空库启动成功 + 遗留库启动成功 + API 可用 |
| **启动期 DB 瞬断 → crash-loop 回归**：旧启动有 connectWithRetry（10 次 ~55s 退避）；新 CMD 链的 `db init` 无重试，DB 瞬断时容器退出、依赖 compose `restart: unless-stopped` 退避重试 | 接受 compose 重启退避作为重试机制（`--verbose` 保证失败日志可见）；最终决策与理由在 §8 留痕 |
| pnpm-lock.yaml 变更（deps 移动/移除）未同步 | 显式列入 checklist：`pnpm install` 重生成 lockfile，`docker:build` 的 `--frozen-lockfile` 隐式把关 |

## 6. 验证与闭合判据

1. 全量测试（`findNextCreatedTask` 删除后无引用）绿；typecheck、build 通过。
2. `pnpm docker:build` 成功；容器冒烟两路径：a) 空库（init 建表 + boot + 哨兵/播种）；b) 存量模拟库（initSchema 等价建表，验证 init 采纳行为）。
3. `docker compose config`（经 `node compose.mjs config`）通过。
4. 文档更新齐备；master plan checklist 全勾；`project-context.md` Active requirement 归位（Prisma 需求关闭，下一活跃回 knowledge-backfill）。
5. 闭合审计：独立 subagent（deployment 保护区 + 高风险，不适用 cold-replay）。
6. 验证命令表核对（`project-context.md` 无占位符）。

## 7. Checklist

- [x] 依赖调整（prisma/cli-engine 转 prod、better-sqlite3 移除+脚本归档）+ `pnpm install` 重生成 lockfile
- [x] Dockerfile.server 适配（COPY + CMD 链 + start-period 30s）+ 未签名存量库 `db init` 行为 PoC
- [x] 死代码删除 + 文档更新（含总 plan §5 P4 行修正、system-baseline.md、baseline README）
- [x] 全量回归（48/48）+ docker:build + 容器冒烟（fresh/存量双路径 HTTP 200）+ compose config
- [x] 文档同步 + subagent 闭合审计 + 总 plan 闭合（用户知悉）

## 8. Closure 记录

- **CMD 链最终形态**：`node node_modules/prisma/dist/prisma.js db init --verbose && exec node --env-file-if-exists=.env /app/dist/main.js`——与 plan 的 `node_modules/.bin/prisma` 等价（pnpm deploy 的 `--legacy` 布局不生成 `.bin` shim，改直调 bin 入口）。
- **PoC 结果（未签名存量库）**：schema 与 contract 匹配的未签名库上 `db init` → introspect 后 **0 操作直接采纳 + 签名**——无需 `db sign || true` 兜底链；CMD 保持单命令形态。三种状态（fresh 建表 / 存量采纳 / 已签名 noop）全部实证。
- **容器冒烟**：fresh（bdl_p4fresh：20 additive 操作 + boot + 哨兵过 + 播种 + HTTP 200）；legacy 未签名（bdl_p4legacy：0 操作采纳 + boot + 播种 + HTTP 200）。compose `config` 通过（需 DATABASE_URL 占位，设计如此）。
- **start:prod 偏差**：`--env-file` → `--env-file-if-exists`（容器对齐 + 本地无 .env 不报错），plan 范围外的小改动，在此留痕。
- **迁移图状态目录**：`packages/server/migrations/`（refs/snapshots）为本机运行生成，加入 .gitignore；Phase 2 真实迁移 authoring 时再决定提交内容。
- **crash-loop 决策留痕**：接受 compose `restart: unless-stopped` 退避作为启动期 DB 瞬断的重试机制（`--verbose` 保证失败日志可见）。
- 镜像体积：prisma CLI 入 runtime 带来一定增量，NAS 场景可接受（未精确计量，留观）。
