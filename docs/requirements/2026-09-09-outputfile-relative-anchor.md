# task.outputFile / analysis_sub_task.output_file 相对锚点改造

## 背景

用户要求：DB 中下载任务的 `outputFile` 不应包含机器盘符或环境变量（如 `OUTPUT_DIR`）配置的路径内容，只应保存"用户可完全感知的路径"——即相对下载根目录 `DOWNLOAD_ROOT` 的相对路径。这样任意机器上只要按 `join(DOWNLOAD_ROOT, value)` 拼接即可定位文件，便于跨机器迁移（换盘符、换部署路径、Docker/本地互换）。

这与 `docs/design/app-overview.md` 已声明的"DB 相对路径锚点约定（无例外）"一致，但现状只有 `ai_summary_task.summary_output` 落实了该约定（2026-09-04 批次），`task.outputFile` 与 `analysis_sub_task.output_file` 仍写入绝对路径，属实现缺口。

## 需求

1. **写侧**：`task.outputFile` 与 `analysis_sub_task.output_file` 持久化时，若值为 `DOWNLOAD_ROOT` 之下的绝对路径，一律改写为 POSIX 分隔符的相对路径；根之外或已是相对的值不改写（沿用 `toRelativeSummaryOutputPath` 语义）。
2. **读侧**：所有为磁盘访问而消费这两个字段的代码点，对相对值执行 `join(DOWNLOAD_ROOT, value)`；绝对值（迁移前遗留）原样透传（沿用 `resolveSummaryOutputPath` 语义）。
3. **API 展示**：任务列表/详情接口返回的 `outputFile` 为相对值；前端下载列表原样展示（用户可感知路径，不含盘符/环境路径）。
4. **存量数据**：提供一次性迁移脚本（模式同 `003-summary-output-relative.sql`），把两表中位于指定下载根之下的绝对路径改写为相对路径；未迁移的存量绝对值由读侧容错兜底，不强制。
5. **不回归**：`summary_output` 现有相对化/解析行为不变（helpers 泛化后委托，既有测试通过）。

## 验收标准

- AC1 新任务成功后 `task.outputFile` 为相对 `DOWNLOAD_ROOT` 的相对路径（如 `a/b/Title-BV1xx-123-q80.mp4` 或 `.analysis-llm/...`）。
- AC2 低清子任务 `analysis_sub_task.output_file` 同规则。
- AC3 分析触发、视频解析回退、总结修复、重建等磁盘消费点在相对值下能定位真实文件（等价于旧绝对路径行为）；绝对值透传不受影响。
- AC4 迁移脚本幂等、可核对 UPDATE 计数；读侧对未迁移绝对值兼容。
- AC5 `pnpm typecheck`、`pnpm build`、server 数据层测试通过；`summary_output` 相关既有测试不回归。

## 范围说明（假设记录）

- `analysis_sub_task.output_file` 一并纳入（owner doc 约定为"无例外"，仅改 task 表会留下半迁移状态）。
- 前端不改代码：显示值由绝对变相对，正是用户要的"用户可感知路径"。
- 不迁移 `summary_output`（已完成）、不改 DB schema、不做读侧自动改写 DB。
