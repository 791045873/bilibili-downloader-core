# Testing — P4 收尾与部署接线

- 日期：2026-09-02
- Plan：`docs/plans/2026-09-02-prisma-p4-cleanup-deployment-plan.md`
- 结果：**PASS**（48/48 tests；typecheck、build、docker:build、compose config、容器双路径冒烟通过）

## 依赖变更

- `prisma@8.0.0-rc.12`、`@prisma/cli-engine@0.3.0`：devDependencies → **dependencies**（运行时镜像需 CLI 做 schema 引导）
- 移除 `better-sqlite3`、`@types/better-sqlite3`；`migrate-sqlite-to-postgres.mjs` 归档至 `scripts/one-off-migrations/`（README 含恢复说明）
- **`pg`/`@types/pg` 保留**（连接池/哨兵/守卫型 claim 依赖——修正 master plan §5 原表述）
- `start:prod` 改 `--env-file-if-exists`（容器对齐；本地无 .env 不报错）
- pnpm-lock.yaml 重生成；`docker:build --frozen-lockfile` 通过

## Dockerfile.server

- runtime 新增 COPY：`prisma.config.ts`、`src/prisma/`（contract.prisma/json/d.ts）→ `/app` 下 config 相对路径成立
- `HEALTHCHECK --start-period` 10s → 30s
- CMD：`sh -c "node node_modules/prisma/dist/prisma.js db init --verbose && exec node --env-file-if-exists=.env /app/dist/main.js"`（pnpm deploy --legacy 不生成 `.bin` shim → 直调 bin 入口；`exec` 保持 tini 信号语义）
- 实测确认 `--ignore-scripts` 不影响 Prisma 8 CLI（纯 TS，无引擎二进制）

## 容器冒烟（关键证据）

| 路径 | 库状态 | `db init` 结果 | 应用 |
| --- | --- | --- | --- |
| fresh | 空库 bdl_p4fresh | 20 个 additive 操作 + 签名 | 哨兵通过 + 播种 + HTTP 200 |
| legacy 未签名 | `db init` 建表后删除 `prisma_contract` schema（模拟 initSchema 时代的未签名存量库） | **introspect 后 0 操作直接采纳 + 签名**（PoC 关键结论：无需 `db sign` 兜底链） | 播种 + HTTP 200 |

- `compose.mjs config` 通过（DATABASE_URL 必填占位——设计如此）
- 清理：冒烟容器/库已删；本机生成的 `packages/server/migrations/`（refs/snapshots）加入 .gitignore

## 其他

- `findNextCreatedTask` 死代码删除（grep src/tests 零残留）
- 文档：system-baseline.md（Backend/Data Access/Deployment Shape 全部更新至 Prisma/PostgreSQL 现状）、master plan §5 P4 行修正、baseline README、one-off README
- 已知残留：`prisma:seed` 依赖先 build；启动期 DB 瞬断由 compose 重启退避兜底
