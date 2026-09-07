# Plan: 路径常量收敛为全局 PathsService

- Date: 2026-09-04
- Status: closed（2026-09-04 实施完成）
- Autonomy: plan-first（用户直接请求，方案 A 已确认）
- Audit: passed-with-notes（独立 subagent 审计，m1-m5 已落实；实施中发现并修复 PathsModule 遗漏 @Global 装饰器的启动 DI 错误）

## 1. 背景与问题

`src/paths.ts` 的 `downloadPaths()` 惰性函数依赖**隐式契约**："首次访问必须发生在 ConfigModule 装载 .env 之后"。该契约已被打破一次（v1 模块加载期常量在静态 import 链中求值早于 ConfigModule，导致 .env 中的 `OUTPUT_DIR` 失效，bug 已由惰性函数临时修复）。用户决策：引入全局 Service 把生命周期显式化，彻底解决。

## 2. 方案设计

### 2.1 PathsService（getter 语义，无缓存）

新文件 `src/paths/paths.service.ts` + `src/paths/paths.module.ts`（`@Global()` 导出 PathsService），删除 `src/paths.ts`。

```ts
@Injectable()
export class PathsService {
  get DOWNLOAD_ROOT(): string { return resolve(process.env.OUTPUT_DIR ?? join(process.cwd(), "downloads")); }
  get COOKIE_FILE_PATH(): string { /* COOKIE_FILE env 可覆盖分支必须保留 */ ... }
  get BILI_API_CACHE_DIR(): string { ... }
  get ANALYSIS_LLM_VIDEO_DIR(): string { ... }   // 固定 join(DOWNLOAD_ROOT, ".analysis-llm")
  get SUMMARY_BASE_DIR(): string { ... }          // 固定 join(DOWNLOAD_ROOT, "summary")
}
```

**取 getter 而非构造器急切求值的理由**：每次访问时求值，对"ConfigModule 何时装载 env"完全零假设——任何初始化顺序下都正确；env 进程内不可变，重复求值无语义代价。DI 带来的可 mock/可校验能力保留。

### 2.2 消费方改造（7 处）

| 消费方 | 改造 |
| --- | --- |
| `download.service.ts` | 构造器注入 `paths: PathsService`；ctor/onModuleInit/llmDir/confirmLogin 5 个使用点改 getter |
| `parse.service.ts` | 构造器注入；3 个使用点 |
| `analysis-trigger.service.ts` | 构造器注入；llmVideoDir（ctor）、resolveSummaryDir、rebuild 3 处 |
| `analysis-task.controller.ts` | 构造器注入；markdown 端点、publish 2 处 |
| `knowledge-backfill.service.ts` | 构造器注入；1 处 |
| `database.service.ts` | `constructor(prisma?: PrismaService, paths?: PathsService)`，内部 `this.paths = paths ?? new PathsService()`（沿用既有可选参数模式；Nest 注入全局 PathsService，测试/seed 直连实例化走默认值） |
| `main.ts` | `const paths = app.get(PathsService)`（bootstrap 阶段静态挂载/日志） |

### 2.3 纯函数层解耦

`summary-dir.ts` 的 `rewriteMarkdownImageUrls(content, mdFileAbsPath)` 签名追加第三参 `summaryBaseDir: string`（唯一调用方 `analysis-task.controller.ts:174` 传入注入值），函数不再感知 env/Service，恢复纯函数定位。

### 2.4 AppModule

`PathsModule` 插在 `ConfigModule.forRoot(...)` 之后（imports 第二位），`@Global()` 保证全模块可注入。

## 3. 非目标

- 其余 env 直读（LOG_DIR、MAX_CONCURRENT_*、SMTP、embedding、DATABASE_URL 等）不在本次范围——它们都在构造器/运行期读取，无时序问题；迁移到 ConfigService 留待配置需求增长后单独立项
- 不改 ConfigModule 的 envFilePath 装载语义；不改 Docker compose 环境注入
- 不改 003 SQL 与 summary_output 相对路径语义

## 4. 测试与验证

- `tests/helpers/db.ts` 不变（`new DatabaseService()` 走默认 PathsService）
- `ai-summary-task.test.ts`：`downloadPaths().DOWNLOAD_ROOT` → `new PathsService().DOWNLOAD_ROOT`（修复当前因函数删除而挂掉的用例）
- 新增 PathsService 纯值测试（可并入该文件或独立）：getter 值与 env 推导一致
- `pnpm typecheck`、`pnpm --filter @bilibili-downloader/server test`、`pnpm build`
- 运行级：dev server watch 重载后 `GET /api/download/config` 返回 .env 中的 OUTPUT_DIR（本次 bug 的原始复现路径）

## 5. 验收标准

- AC1 全仓 src 下无 `downloadPaths`、无 `process.env.OUTPUT_DIR` 直读（仅 PathsService 一处）
- AC2 本地 .env 的 OUTPUT_DIR 生效（运行级 config 端点验证）
- AC3 测试/seed 直连 `new DatabaseService()` 不需要 DI 容器
- AC4 `rewriteMarkdownImageUrls` 为纯函数（不读 env、不依赖 Nest）
- AC5 typecheck + server 测试 + build 通过

## 7. 收尾文档

- docs/context/codebase-map.md Server 行的 src/paths.ts 表述更新为 src/paths/（PathsService）。

## 6. 行为差异

- 无。运行时解析出的路径值与当前实现完全一致（唯一变化是求值时机与来源）。

## 7. 实施与闭合记录（2026-09-04 冷回放）

- 实际 diff 与 §2 逐条一致：src/paths/paths.service.ts（getter 无缓存）+ paths.module.ts（@Global）、7 个消费方注入、ewriteMarkdownImageUrls 追加 summaryBaseDir 参数、AppModule 插入 PathsModule、main.ts 用 app.get。
- 实施中问题与修复：① PathsModule 初版遗漏 @Global() 导致 DatabaseService DI 解析失败（启动报 UnknownDependenciesException），补装饰器后解决——正体现"生命周期显式化"的价值：错误在启动时立即暴露而非静默错路径；② 上一轮批量替换曾丢失 main.ts 的 mkdirSync（静态挂载前建目录），本次恢复。
- 验证：pnpm typecheck、pnpm build 通过；server 测试 61/61（含新增 PathsService 组合关系用例）；运行级 start:prod 启动后 GET /api/download/config 返回 E:\sata1-18502986266\bilibili-download（.env OUTPUT_DIR 生效，本次 bug 原始复现路径确认修复）。
- AC1-AC5 全部满足（AC1 经 grep 核实：src 下 env 直读仅 paths.service.ts）。
- 文档：codebase-map Server 行已更新；实现日志 docs/logs/2026-09-04-paths-service.md。