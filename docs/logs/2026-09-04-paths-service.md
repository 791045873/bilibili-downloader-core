# 2026-09-04 路径读取收敛为全局 PathsService

## 背景

`downloadPaths()` 惰性函数依赖隐式契约"首次访问晚于 ConfigModule 装载 .env"，该契约已被打破过一次（模块加载期常量导致 .env 的 OUTPUT_DIR 失效）。用户决策：引入全局 Service 显式化生命周期（方案 A，与"入口预装载"方案 B 对比后选定）。

## 改动

- 新增 `src/paths/paths.service.ts`（`PathsService`，getter 每次访问求值、无缓存——对初始化顺序零假设）与 `paths.module.ts`（`@Global()`）；删除 `src/paths.ts`。
- 7 个消费方构造器注入：download.service、parse.service、analysis-trigger.service、analysis-task.controller、knowledge-backfill.service、database.service（可选参数 + 默认 `new PathsService()`，保住测试/seed 直连实例化）、main.ts（`app.get`）。
- `rewriteMarkdownImageUrls` 追加第三参 `summaryBaseDir`，恢复纯函数定位（唯一调用方传入）。
- AppModule：PathsModule 插在 ConfigModule 之后。

Plan：`docs/plans/2026-09-04-paths-service-plan.md`（独立 subagent 审计 passed-with-notes，m1-m5 落实）。

## 实施中的问题

- PathsModule 初版遗漏 `@Global()` → DatabaseService DI 解析失败，**启动时立即报错**（UnknownDependenciesException）而非静默错路径——这正是 Service 方案的价值：错误显式化。
- 恢复了此前批量替换丢失的 main.ts `mkdirSync`（静态挂载前建摘要目录）。
- 测试文件 `DOWNLOAD_ROOT` 引用改为 `new PathsService().DOWNLOAD_ROOT`，并新增组合关系用例。

## 验证

- `pnpm typecheck`、`pnpm build` 通过；server 测试 61/61。
- 运行级：`start:prod` 启动后 `GET /api/download/config` 返回 `E:\sata1-18502986266\bilibili-download`（.env 生效，原始 bug 复现路径确认修复）。
- src 下 `OUTPUT_DIR`/`COOKIE_FILE`/`ANALYSIS_LLM_VIDEO_DIR` 直读仅存 PathsService（grep 核实）。
