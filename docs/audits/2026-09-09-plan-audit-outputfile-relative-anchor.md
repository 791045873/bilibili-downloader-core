# Plan Audit: task.outputFile / analysis_sub_task.output_file 相对锚点

日期: 2026-09-09
类型: plan audit（independent subagent）
对象: `docs/plans/2026-09-09-outputfile-relative-anchor-plan.md`
需求: `docs/requirements/2026-09-09-outputfile-relative-anchor.md`
结论: **pass-with-notes**（1 项 F 级必须修正后方可执行 Phase 4，其余为并入计划的小修/风险注记）

## 审计核验（对照 live code，全部一致）

- owner doc：`docs/design/app-overview.md:46` 确有"DB 相对路径锚点约定（无例外）"并点名 `task.outputFile`（未点名 `analysis_sub_task`，需求"范围说明"已记录该假设）
- 先例：`summary-dir.ts:21-40`（toRelative，含盘符判定/POSIX 归一/根外 null）、`:50-58`（resolve）；`database.service.ts:1131-1134` summary_output 写侧转换；003 脚本幂等模式（lower 比较保 case 子串）与 README 登记
- 写链：`download.service.ts:500-510` 计算 `join(this.outputDir, …)`（`this.outputDir = paths.DOWNLOAD_ROOT`，:92）→ `:571-579` 调 `updateTaskStatus`；`database.service.ts:343` 确无转换
- 跳过下载分支：`DownloadExecutionUseCase.ts:64-88` 返回 `request.outputFile`（写入时恒为当前 env 计算的绝对路径）→ 经 DB 层转换，计划"无需单独处理"成立
- 子任务写链：`analysis-trigger.service.ts:108-116`（onLowResFinished）、`database.service.ts:719-743`（insert，outputFile :726）、`:745-798`（update，:771）
- 读侧磁盘消费点逐行核对（与计划清单一致）：trigger :384（highResPath）、:394（lowRes outputFile）、:585-588（重载校验）、:799-807（重建）；resolver :70-75、:77-82、:209-241、:290-316；summary-repair :177-184；`download.service.ts:665-667` fileExists 透传
- 其余疑似消费点排除：`summary-integrity.service.ts` 只消费 summary_output（:102-105），不碰 outputFile；`download-scheduler.ts` 不对 outputFile 做磁盘访问（:53-65 重启对账不传 outputFile）；taskCache.outputFile（`download.service.ts:156`）仅 API 展示；`analysis.controller.ts:423` insertAnalysisSubTask 不传 outputFile；无 downloads 静态挂载（仅 `/summary-files`）
- 前端：`Downloading.tsx:304-309`、`types/index.ts:161` 原样展示，与需求 3 一致（API 直传 DB 值）
- 基线测试：`tests/database/task.test.ts:55` 已用相对值 `out.mp4`、`analysis-sub-task.test.ts:31` 用 `s.jpg`；`summary-integrity.test.ts` 存在
- 测试文档 `docs/testing/2026/09-09-outputfile-relative-anchor-testing.md` 已存在且方向与验收标准对齐；验证命令与 `docs/context/project-context.md` 一致
- seed.mjs 无 outputFile 写入

## 审计发现

| # | 严重度 | 问题 | 证据 | 处置建议 |
| --- | --- | --- | --- | --- |
| 1 | F | Phase 4 对 task 表列名写错：实际列为 `"outputFile"`（Prisma 无 @map，带引号 camelCase），非 `output_file`；004 脚本必须 `UPDATE task SET "outputFile" = …`，且 LIKE/substring 比较需引用 `"outputFile"` | `packages/server/prisma/baseline/contract.prisma:65`（无 @map）vs `:88`（subtask 有 `@map("output_file")`）；`migrate-sqlite-to-postgres.mjs:33,40` 用 `'"outputFile"'` 引用佐证 | 并入计划：修正 Phase 4 描述与 004 脚本草稿列名（两表列名不对称是本迁移最容易踩的坑） |
| 2 | m | 计划称 updateTaskStatus 为 task.outputFile 唯一写点，但 `insertTask`（database.service.ts:268）也可写该列 | 生产调用 `download.service.ts:370-383` 不传 outputFile，仅测试传入且值本身相对 | 并入计划 Phase 2：显式声明 insertTask 不在改造范围及理由（无生产写入方），避免"写点清单不完整"质疑 |
| 3 | m | `migrate-sqlite-to-postgres.mjs:33-55` 逐字搬迁两列，产出的存量值仍是绝对路径 | 同上 | 并入计划 Phase 4/验证节注记：该历史工具重跑后需再跑 004（或依赖 Phase 3 读侧容错） |
| 4 | m | trigger 的 `screenshotVideoPath` 复用点（:415-418 `fileExists(highResPath)`）未列入 Phase 3 消费点清单；resolver "三处"口径模糊 | `analysis-trigger.service.ts:384→416`；resolver 实际为 :72/:79、:211、:226（返回 source）、:290/:316（返回 source） | 并入计划：:384 解析后 :416 随之覆盖，应点名；resolver 返回值站点必须 resolve（不只是 fileExists 判定） |
| 5 | m | 临时低清清理 `llmVideoPath.startsWith(this.llmVideoDir)`（:537）依赖 resolver 返回绝对路径；resolver 对 preferredLowResPath 是原样返回（:74） | `analysis-trigger.service.ts:536-563`；`analysis-video-resolver.ts:70-75` | 并入计划 Phase 3：明确"trigger 侧先 resolve 再传参"（:394 resolve），否则相对值会逃过 startsWith 清理、遗留孤儿文件 |
| 6 | P | 大小写/跨环境边界：003 用 lower() 比较并保留原 case；写侧 helper 在 Windows 上 resolve/relative 对大小写漂移路径的归属判定可能与 SQL 幂等结果不完全一致；写环境（本地）与读环境（Docker，DOWNLOAD_ROOT 不同）间未迁移的绝对值读侧透传后在异环境必然 miss（走低清重下兜底，与现状等价） | `summary-dir.ts:19-40`；`003-summary-output-relative.sql:19,30`；`paths.service.ts:24-28` | 风险注记即可：Phase 4 脚本沿用 003 的 lower 比较 + 保 case 子串语义，正文注明"仅迁移当前环境根下值" |
| 7 | P | `?? fields.outputFile` 回退语义：空串会被透传不改写（与 summary_output `""` 语义一致）；resolveTaskForAnalysis :572 以 outputFile 非空为启发式，相对化后语义不变 | `database.service.ts:572`、计划 Phase 2 | 无需改计划；实现时保持与 summary_output 相同的空值行为即可 |

## 结论

Verdict: PASS-with-notes

计划方案（DB 层统一转换 + 泛化 helper 委托 + 读侧解析 + 幂等 004）与需求、owner doc L46 约定、003 先例一致，读写链与消费点清单经逐行核对基本准确、无遗漏的磁盘消费方；测试文档与验证命令与 project-context 一致。

**必须修正（执行 Phase 4 前为硬门槛）：**

1. 【发现 1】Phase 4 及 004 脚本中 task 表列名改为 `"outputFile"`（quoted camelCase）；`analysis_sub_task` 保持 `output_file`。两列名不对称须在计划正文与脚本头部注释中显式写明，防止后续照抄 003 模式时复制错列名。

**建议并入计划的修正（m 级）：**

2. 【发现 2】Phase 2 补一句：`insertTask`（database.service.ts:268）可写 outputFile，但生产链路不传值，不在本次改造范围。
3. 【发现 3】Phase 4 注记 `migrate-sqlite-to-postgres.mjs` 重跑后会再产生绝对值，需重跑 004 或依赖读侧容错。
4. 【发现 4】Phase 3 消费点清单补 trigger :415-418（highResPath 二次消费）并把 resolver 各返回站点（:226/:316）明确为 resolve 点。
5. 【发现 5】Phase 3 明确"trigger 先 resolve 再传 resolver"的顺序约束，保证 :537 startsWith 临时清理语义不回归。
