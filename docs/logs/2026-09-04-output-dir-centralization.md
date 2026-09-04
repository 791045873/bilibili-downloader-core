# 2026-09-04 OUTPUT_DIR 路径推导收敛

## 背景

`OUTPUT_DIR` 及派生路径（cookies、SDK 缓存、低清视频目录、summary 目录）的推导散落在 5 个文件 9 处，存在默认值写法漂移（`main.ts` 日志用裸 `"./downloads"`）与重复推导。Plan：`docs/plans/2026-09-04-output-dir-centralization-plan.md`（独立 subagent 审计 passed-with-notes，M1/M2/m1-m4 已修订）。

## 改动

- 新增 `packages/server/src/paths.ts`：`DOWNLOAD_ROOT`、`DOWNLOAD_ROOT_SOURCE`、`COOKIE_FILE_PATH`、`BILI_API_CACHE_DIR`、`ANALYSIS_LLM_VIDEO_DIR`、`SUMMARY_BASE_DIR` 六个常量，模块加载期求值一次。
- `summary-dir.ts`：`SUMMARY_BASE_DIR` 定义迁出，改为从 paths.ts 消费；保留 `SUMMARY_STATIC_PREFIX` 与 markdown 工具函数（`analysis-task.controller`、`knowledge-publisher.service` 的工具函数导入不受影响）。
- `download.service.ts`、`parse.service.ts`：outputDir/cookieFile/bili-api-cache/llmDir/getDownloadConfig 全部改用常量。
- `analysis-trigger.service.ts`、`main.ts`：常量导入改自 paths.ts；启动日志 outputPath 用 `DOWNLOAD_ROOT`。

## 行为差异（plan 第 4 节声明范围）

1. **confirmLogin cookie 写入路径修复**：`COOKIE_FILE` env 已设置时，二维码登录此前写死 `outputDir/.cookies.json`（与读取路径不一致的既有缺陷），现写入 `COOKIE_FILE_PATH`，读写对齐。
2. 相对/空串 `OUTPUT_DIR` 值在构造期统一 resolve 为绝对路径（实际落盘位置等效）。
3. `main.ts` 启动日志 outputPath 由 `"./downloads"` 变为绝对路径（仅日志）。

## 验证

- `pnpm typecheck`、`pnpm build` 全 workspace 通过。
- src 下 env 直读与路径派生仅存 paths.ts（AC3 实测）。
- 运行级验证（下载落盘、summary 目录、COOKIE_FILE 登录写入）留用户部署后确认。

## 追加（同日，用户决策）

- 移除 `ANALYSIS_LLM_VIDEO_DIR` env 覆盖能力：paths.ts 中该常量固定为 `join(DOWNLOAD_ROOT, ".analysis-llm")`。低清视频目录恒在下载根目录内，随 `OUTPUT_DIR` 一并迁移。server typecheck 通过。
- 移除 `DOWNLOAD_ROOT_SOURCE` 与 `GET /api/download/config` 的 `source` 字段（用户决策：不再需要来源展示）：paths.ts 常量、getDownloadConfig 返回值、前端 `DownloadConfig` 类型与 Settings 页"环境变量/默认目录"徽标同步删除，接口仅返回 `outputDir`。`pnpm typecheck` 全 workspace 通过。
