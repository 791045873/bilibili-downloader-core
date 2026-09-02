# Plan Audit — P4 收尾与部署子 plan（ask-first）

- 计划：`docs/plans/2026-09-02-prisma-p4-cleanup-deployment-plan.md`
- 总 plan：`docs/plans/2026-09-01-prisma-introduction-master-plan.md`
- 审计日期：2026-09-02
- 审计方式：独立 subagent（只读审计）。deployment 为 ask-first 保护区：**本 plan 获用户批准后方可实施**；闭合采用独立 subagent 审计（高风险，不适用 cold-replay）。

## 结论

VERDICT: needs-changes → 修正后 approved。核心断言全部 live 核实：pg 保留正确（Pool/connectWithRetry/哨兵/双 claim 依赖，master plan §5 P4 行"移除 pg"确已过时）；`pnpm deploy --prod` 会带入转正后的 prisma/cli-engine 且 `.bin/prisma` 存在；contract.json 经 tsc 进 dist、config 相对路径在 cwd=/app 下成立；`--ignore-scripts` 与 Prisma 8（无引擎二进制）一致，并以容器内可执行性实测兜底；`exec node` 保持 tini 信号语义；compose env 优先于 env-file 且镜像内无 .env；findNextCreatedTask/legacy-sqlite 脚本零风险；治理合规（ask-first 批准门 + subagent 闭合审计 + scope sweep 全覆盖）。

## 发现与吸收

1. **启动期 DB 瞬断 → crash-loop（Moderate）**：旧启动 connectWithRetry 退避被 `db init`（无重试）取代。决策：接受 compose `restart: unless-stopped` 退避作为重试机制（`--verbose` 保证日志可见），最终决策 §8 留痕。已并入 §5。
2. **master plan §5 P4 行修正未路由（Minor）**：闭合时显式标注"pg 保留"修正，已列入 §3.3/§7。
3. **HEALTHCHECK start-period（Minor）**：10s → 30s，已并入 §3.2。
4. **`|| true` 兜底链推理留痕（Nit）**：若 PoC 采用，§8 记录"自守卫拒绝分歧"依据，防日后误读为 fail-silent。
5. **文档文件名指明确化（Nit）**：baseline README 指 `packages/server/prisma/baseline/README.md`，另含 system-baseline.md。
6. **lockfile（Nit）**：deps 移动/移除后重生成 lockfile 列入 checklist（`--frozen-lockfile` 隐式把关）。
