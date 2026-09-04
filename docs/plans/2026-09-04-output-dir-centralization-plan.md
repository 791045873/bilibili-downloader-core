# Plan: OUTPUT_DIR 路径推导收敛

- Date: 2026-09-04
- Status: closed（2026-09-04 实施完成，冷回放闭合见第 6 节）
- Autonomy: plan-first（用户直接请求的重构；非保护区、非高风险）
- Audit: passed-with-notes（2026-09-04 独立 subagent 审计，M1/M2/m1/m2/m3 已全部修订入文；修订仅为文本澄清，审计员裁定无需二次审计）

## 1. 问题

`OUTPUT_DIR` 及其派生路径的处理散落在 5 个文件中，存在重复推导与默认值漂移：

| 位置 | 现状 | 问题 |
| --- | --- | --- |
| `download.service.ts:88` | `OUTPUT_DIR ?? join(cwd, "downloads")` | 推导 #1；相对 env 值未 resolve |
| `download.service.ts:96` | `process.env.OUTPUT_DIR ? "env" : "default"` | env 存在性判断重复 |
| `download.service.ts:90` / `parse.service.ts:48` | `COOKIE_FILE || join(outputDir, ".cookies.json")` | cookies 路径重复推导 ×2 |
| `download.service.ts:105` / `parse.service.ts:56` | `join(outputDir, "bili-api-cache")` | SDK 缓存目录重复推导 ×2 |
| `download.service.ts:310-312` / `analysis-trigger.service.ts:69-74` | `ANALYSIS_LLM_VIDEO_DIR ?? join(outputDir, ".analysis-llm")` | 低清视频目录重复推导 ×2，写法略异 |
| `download.service.ts:728` | `join(this.outputDir, ".cookies.json")`（confirmLogin 写入路径） | 独立重推导且忽略 `COOKIE_FILE` env，与 :90 读取路径存在既有潜在不一致 |
| `parse.service.ts:46` | `OUTPUT_DIR ?? join(cwd, "downloads")` | 推导 #2 |
| `analysis-trigger.service.ts:72` | `resolve(OUTPUT_DIR ?? join(cwd, "downloads"))` | 推导 #3（带 resolve） |
| `summary-dir.ts:11` | `resolve(OUTPUT_DIR ?? join(cwd, "downloads"))` + `join(..., "summary")` | 推导 #4（昨日新增，加剧分散） |
| `main.ts:35` | `OUTPUT_DIR ?? "./downloads"` | 仅日志展示，默认值写法与其他处不一致 |

风险：默认值或 resolve 语义单处漂移时，各消费方根目录悄然分叉（下载、解析、AI 总结、低清视频落不同树）。

## 2. 目标 / 非目标

目标：

- 新建单一来源模块 `packages/server/src/paths.ts`，集中全部下载根目录派生常量：
  - `DOWNLOAD_ROOT` = `resolve(OUTPUT_DIR ?? join(cwd, "downloads"))`（统一 resolve 语义）
  - `DOWNLOAD_ROOT_SOURCE` = `"env" | "default"`（**沿用既有 truthiness 判断**，即 `OUTPUT_DIR=""` 视为 `"default"`，与现状 :96 一致）
  - `COOKIE_FILE_PATH` = `COOKIE_FILE || join(DOWNLOAD_ROOT, ".cookies.json")`（常量名带 `_PATH` 后缀与 env 变量名区分）
  - `BILI_API_CACHE_DIR` = `join(DOWNLOAD_ROOT, "bili-api-cache")`
  - `ANALYSIS_LLM_VIDEO_DIR` = env 覆盖或 `join(DOWNLOAD_ROOT, ".analysis-llm")`
  - `SUMMARY_BASE_DIR` = `join(DOWNLOAD_ROOT, "summary")`
- 上述 5 文件全部改为消费常量，删除本地推导。
- 纯重构：运行时解析出的绝对路径不变，`/api/download/config` 契约不变。

非目标：

- 不改 env 变量名、默认值语义（`OUTPUT_DIR` 未设置仍为 cwd 下 `downloads`）。
- 不引入配置服务/DI（与 `summary-dir.ts` 既有模块级常量风格保持一致；无运行时 cwd 变更场景）。
- 不动 Docker/compose（`OUTPUT_DIR=/download` 语义不变）。
- 豁免：`packages/server/scripts/one-off-migrations/*.mjs` 为一次性归档脚本，无法 import TS 模块，其中的 `OUTPUT_DIR` 引用不在收敛范围。

## 3. 改动清单

1. NEW `packages/server/src/paths.ts`：上述 6 个导出常量 + 来源注释。
2. `packages/server/src/analysis/summary-dir.ts`：移除 `SUMMARY_BASE_DIR` 定义（改从 `paths.ts` 导入供内部 `rewriteMarkdownImageUrls` 使用），保留 `SUMMARY_STATIC_PREFIX` 与 markdown 工具函数。
3. `packages/server/src/download/download.service.ts`：outputDir/cookieFile（含 :728 confirmLogin 写入路径改用 `COOKIE_FILE_PATH` 常量）/bili-api-cache/llmDir/getDownloadConfig 改用常量。
4. `packages/server/src/parse/parse.service.ts`：同上（无 llmDir）。
5. `packages/server/src/analysis/analysis-trigger.service.ts`：llmVideoDir 与 `SUMMARY_BASE_DIR` import 改自 `paths.ts`。
6. `packages/server/src/main.ts`：`SUMMARY_BASE_DIR` import 改自 `paths.ts`；启动日志 outputPath 用 `DOWNLOAD_ROOT`（顺带修正 `"./downloads"` 相对写法漂移）。

共 6 文件（1 新增 5 修改），预计 < 120 行变更。

## 4. 行为差异说明（均非语义变化）

- 相对 `OUTPUT_DIR` 值：此前 `download/parse` 侧保持相对（文件操作等效于对 cwd 解析），现统一构造期 resolve 为绝对路径；`getDownloadConfig` 返回值不变（原本就 resolve）。空串 `OUTPUT_DIR` 边缘：统一后为 cwd 绝对路径，与原相对空串的实际落盘位置等效。
- **confirmLogin cookie 写入路径（有意的行为修复）**：`COOKIE_FILE` env 已设置时，二维码登录确认的 cookie 此前写死 `outputDir/.cookies.json`（与读取路径不一致，属既有潜在缺陷），现改为写入 `COOKIE_FILE_PATH`（与读取同源），读写在 env 场景下对齐。
- `main.ts` 启动日志 outputPath 由裸 `"./downloads"` 变为解析后的绝对路径——仅日志。

## 5. 验收标准

- [x] AC1 `pnpm typecheck` 全 workspace 通过（2026-09-04 实测通过）。
- [x] AC2 `pnpm build` 通过（2026-09-04 实测通过，含 server nest build）。
- [x] AC3 `rg "process\.env\.OUTPUT_DIR" packages/server/src` 仅命中 `paths.ts`（grep 实测：src 下 env 直读与路径派生仅存于 paths.ts，含注释命中）。
- [x] AC4 `GET /api/download/config` 行为不变（逻辑级核实：`DOWNLOAD_ROOT` 构造期 resolve 等价原 `resolve(this.outputDir)`，`DOWNLOAD_ROOT_SOURCE` 沿用 truthiness；运行级留用户部署后确认）。
- [x] AC5 新 `summary/` 目录位置与昨日改动一致（`DOWNLOAD_ROOT/summary`，paths.ts 常量）。

## 6. 执行与闭合（冷回放记录）

- 2026-09-04 冷回放：对照本 plan 复查实际 diff——6 个文件（paths.ts 新增；summary-dir/download.service/parse.service/analysis-trigger/main 修改）与第 3 节清单一致；第 4 节三项行为差异均已落地并仅在声明范围内（confirmLogin 改用 `COOKIE_FILE_PATH` 对齐读写；构造期 resolve；日志绝对路径）；无超出范围的改动。
- 文档：`docs/context/codebase-map.md` Server 行已补 `src/paths.ts`；实现日志 `docs/logs/2026-09-04-output-dir-centralization.md`。
- 遗留：运行级验证（下载落盘、summary 目录、COOKIE_FILE 场景登录写入）由用户部署后确认。
