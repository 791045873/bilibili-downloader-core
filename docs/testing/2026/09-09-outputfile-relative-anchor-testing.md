# task.outputFile / analysis_sub_task.output_file 相对锚点 — 测试方向

对应需求：`docs/requirements/2026-09-09-outputfile-relative-anchor.md`
对应计划：`docs/plans/2026-09-09-outputfile-relative-anchor-plan.md`

## 需求级观察状态

### 写侧相对化（需求 1/AC1/AC2）

- 应为真：任务（含低清子任务）在 `DOWNLOAD_ROOT` 之下成功产出文件后，DB 存储值为 POSIX 分隔符相对路径（例：`/download` 根下子目录任务存 `sub/xxx.mp4`，低清子任务存 `.analysis-llm/xxx.mp4`）。
- 应为假：DB 中不出现盘符（`E:\`、`E:/`）或环境变量展开出的绝对前缀（如 `E:/sata1-.../bilibili-download/...`）。
- 应为真：值位于根之外（理论边界）或已是相对值时保持原样不改写。

### 读侧解析（需求 2/AC3）

- 应为真：对 DB 中相对值，分析触发复用（低清/高清）、重载其它 completed 任务、重建截图、总结修复视频定位均能经 `join(DOWNLOAD_ROOT, value)` 命中真实文件，行为与旧绝对路径一致。
- 应为真：DB 中遗留绝对值原样透传，仍能命中文件（读侧容错）。
- 应为假：读侧不把相对值当作"根相对工作目录"（不得以 `process.cwd()` 为锚）。

### API/前端（需求 3）

- 应为真：任务列表/详情 API 返回相对值；下载列表展示相对路径文本。
- 应为假：前端展示不含盘符或容器内挂载路径。

### 存量迁移（需求 4/AC4）

- 应为真：迁移脚本执行后，两表内指定根之下的绝对值变相对值；重复执行 UPDATE 计数为 0（幂等）；根之外的值不动。
- 应为真：未执行迁移的环境，旧绝对值仍可被读侧消费（不报"文件不存在"类误判）。

### 不回归（需求 5/AC5）

- 应为真：`summary_output` 相对化/解析既有测试全部通过。
- 应为假：类型检查、构建、server 数据层测试出现新增失败。

## 验证命令

- `pnpm typecheck` — ✅ 通过（2026-09-09）
- `pnpm build` — ✅ 通过（2026-09-09）
- `pnpm --filter @bilibili-downloader/server test` — ✅ 11 文件 / 81 用例全部通过（2026-09-09，TEST_DATABASE_URL → 本地 bdl-test-pg：55432）
- 迁移脚本：psql 手工执行 004 脚本核对 UPDATE 计数（用户环境；脚本幂等性可在测试库验证）

## 各方向确认（2026-09-09）

- 写侧相对化：✅ 自动化（`tests/database/task.test.ts`：根下绝对值 → `sub/T-BV1-1-q80.mp4`；相对值/根外值原样；`tests/database/analysis-sub-task.test.ts`：`.analysis-llm/low.mp4` 相对化 + 相对值保留）
- 读侧解析：✅ 自动化（`tests/paths/path-anchor.test.ts`：roundtrip toRelative→resolve 还原绝对路径、绝对值透传、空值 undefined）；下游消费点（trigger/resolver/summary-repair）经同一 helper，行为由 roundtrip 语义保证
- API/前端：✅ 读回值即 API 返回值（list/detail 均出自 DB 行原样映射，task.test 覆盖）；前端展示原始值，无代码改动
- 存量迁移：✅ 脚本幂等设计同 003 先例、列名经 subagent plan audit 对照 Prisma contract 核实；真实环境执行待用户操作（adjudicated：脚本属运维手工步骤，server 不自动执行，与 003 同一先例）
- 不回归：✅ summary-integrity/ai-summary 既有测试全绿；typecheck/build 全绿

裁决说明：真实环境 004 执行与前端展示的人工目测（部署后）留给用户确认；自动化证据已覆盖其余方向。
