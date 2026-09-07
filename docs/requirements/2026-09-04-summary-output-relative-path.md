# Requirement: summary_output 存相对路径

- Date: 2026-09-04
- Source: 用户直接请求（对话确认）
- Status: ready

## 背景与问题

`ai_summary_task.summary_output` 当前存储**生成时**的绝对路径（由 `SUMMARY_BASE_DIR` 拼出，随 `OUTPUT_DIR` 环境不同而不同）。云端 PostgreSQL（`DATABASE_URL` 指向阿里云 RDS）可能同时被本地与云端环境访问：换环境部署后，历史记录的绝对路径在新机器上失效，markdown 查看、知识发布、回填全部 404。

## 目标

1. **写侧**：新写入的 `summary_output` 存相对 `DOWNLOAD_ROOT` 的相对路径（POSIX 分隔符，如 `summary/<标题>-<bvid>-<cid>/<文件>-summary.md`），与运行环境解耦。
2. **读侧**：所有消费方（markdown 查看、发布知识库、历史回填）统一按 `join(DOWNLOAD_ROOT, summary_output)` 拼接当前环境基础路径；对仍是绝对路径的旧值保持容错（原样使用）。
3. **存量迁移**（v2 修订，2026-09-04 用户决策）：不做启动自动迁移；改为**一次性 SQL 脚本手动执行**（`packages/server/scripts/one-off-migrations/003-summary-output-relative.sql`，幂等），把**指定下载根目录之下**的绝对路径改写为相对路径；不在根之下的历史遗留值（如旧 `cwd/summaryDir`）保持原样（沿用 2026-09-03"忽略旧数据"决策，绝对值由读侧容错继续可用）。

## 非目标

- 不改表结构（列仍为 text，Prisma contract 不动）；不改 `task.summary_output` 死镜像列（读取侧 JOIN 覆盖，不外显）。
- 不迁移旧 `summaryDir` 位置的历史文件。
- 不改 `task.outputFile`（视频文件路径）语义。

## 验收标准

- AC1 新生成的总结在 DB 中为相对路径（POSIX 分隔符）。
- AC2 markdown 查看、发布知识库、回填在新旧值下均可读到文件（相对值按 DOWNLOAD_ROOT 拼接，绝对值原样）。
- AC3 启动迁移幂等：重复重启不改写已相对的值；仅改写 DOWNLOAD_ROOT 之下的绝对值；Windows 大小写不敏感盘符处理正确。
- AC4 数据层测试覆盖：迁移函数（绝对→相对、遗留绝对保留、幂等）+ 读侧 resolve 助手（相对拼接、绝对透传）。
- AC5 `pnpm typecheck`、`pnpm build`、server 数据层测试通过。
