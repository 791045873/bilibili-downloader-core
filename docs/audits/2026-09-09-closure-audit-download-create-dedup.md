# Closure Audit: 下载入队创建层去重

日期: 2026-09-09
类型: closure audit（independent，独立执行，冷复放 + 真实 diff + 验证命令独立复跑）
对象: `docs/plans/2026-09-09-download-create-dedup-plan.md`
需求: `docs/requirements/2026-09-09-download-create-dedup.md`
测试: `docs/testing/2026/09-09-download-create-dedup-testing.md`
结论: **pass-with-conditions**（1 项 Minor 文档回填；不阻塞行为闭环，回填后即可标记 Plan Status: closed）

## 实现声称逐条核验（对照 live code / git diff HEAD，全部落地）

| # | 声称 | 判定 | 证据 |
| --- | --- | --- | --- |
| 1 | 纯函数模块 `create-dedup.ts` | ✅ | `decideCreateDedupVerdict`（create-dedup.ts:22-35）：active 先判 → completed+fileExists 次判 → 其余放行；不依赖 DB/FS，消息与需求 :14-15 口径一致 |
| 2 | `findActiveTaskByBvidAndCid` | ✅ | database.service.ts:695-712：status ∈ {created, downloading}，`createdAt desc` + first，经 mergeSummaryMirror 返回；异 bvid/cid 不命中（BigInt(cid) 过滤） |
| 3 | `createTask` 重载 + 去重门 | ✅ | download.service.ts:376-390 双重载（skipDedup:true → `{created:true;id:number}`；默认 → `CreateTaskResult` :40-43 判别联合）；门 :388-405：缺 bvid/cid 旁路（controller 已校验），block 时返回 `{created:false,message}` 并留日志（:392 "blocked by dedup gate"）；判定 :442-467 active 优先、无 active 才查 completed，outputFile 经 `resolveFromDownloadRoot(value, paths.DOWNLOAD_ROOT)`（:453-458，绝对值透传/空值 false）+ `fileExists`（:726-728 fileStore.exists） |
| 4 | scheduler/controller 适配 | ✅ | download-scheduler.ts:96-117 判别联合返回，`result.created` 为假时跳过日志与 `tryScheduleNext()`（不入队不调度）；download.controller.ts:38-50 blocked → `throw new ConflictException(result.message)`，成功返回 `{id, message}` 形状不变 |
| 5 | resolver skipDedup | ✅ | analysis-video-resolver.ts:270-278 传 `{skipDedup:true}`；重载使 `task.id`（后续 :280/:288-297 使用）保持 `number`，typecheck 强制（本轮独立 typecheck 通过证实） |
| 6 | 一键总结适配 | ✅ | analysis.controller.ts:377-379：`!created.created` → ConflictException，且在 :387 使用 `created.id` 之前；N2 已裁决：异常落 :406-415 catch 被再包装为 `BadGatewayException("创建 AI 总结下载任务失败: <中文消息>")`（502 非 409），消息文本保留可见，符合需求 :16 |
| 7 | summary-repair 适配 | ✅ | summary-repair.service.ts:323-329：`!enqueued.created` → 推入 `report.deferred`，reason 为 `enqueued.message`，不填 queuedTaskId（itemOf :52-54 不含该字段，无泄漏）；成功路径 :330-334 照常填 `queuedTaskId`；下游 analysis-task.controller.ts:126 按 `typeof queuedTaskId === "number"` 过滤，与新形状兼容（active 跳过分支 :305-310 本就无 queuedTaskId，非新形状） |
| 8 | 前端呈现 | ✅ | api/index.ts:25-26 `err.message || err.error || HTTP ${res.status}`（409 中文消息不再被 "Conflict" 掩盖）；VideoDetail.tsx:334-350 逐任务 catch 保留 `e.message`，被拒任务汇总 `setErrorMsg(...join("；"))`（:349），成功任务照常 addTaskIds；ParseResultList.tsx:471 既有收集路径未变 |
| 9 | 测试与验证 | ✅ | tests/download/create-dedup.test.ts 5 用例（active 拦 / success+文件在盘拦 / 文件缺失放行 / 无 outputFile 放行 / 无记录放行）；tests/database/task.test.ts:213-233 findActiveTaskByBvidAndCid 全状态流转用例 |

## 独立复跑验证（本审计环境真实执行）

- `pnpm typecheck` ✅（7 workspace projects 全过）
- `pnpm build` ✅（含 frontend vite build、server nest build）
- `pnpm --filter @bilibili-downloader/server test` ✅ **12 文件 / 87 用例全部通过**（TEST_DATABASE_URL=postgres://postgres:postgres@localhost:55432/bdl_test，bdl-test-pg 容器 @55432）——与 testing 文档/日志声称完全一致

## 逻辑排查（C 项正确性）

- 门序正确：active 拦截时短路（evaluateCreateDedup :447 无 active 才查 completed），且纯函数内 active 判定也在 completed 之前——需求两类拦截次序无歧义，无双查浪费亦无误判路径。
- AC3（文件删除后放行）：completed 有 outputFile 但磁盘缺失 → `fileExists=false` → 纯函数放行，插入新任务；AC4（cid 隔离）：查询均按 (bvid,cid) 精确匹配。逻辑满足。
- 被 block 时不执行 insertTask / taskCache 写入（门在 :388 提前 return）→ AC1/AC2 "DB 无新行"满足。
- 409 仅由 controller 层抛出；scheduler/resolver 内部以 `{created:false}` 返回，无异常路径污染内部链路（与计划 P1 设计一致）。

## 回归扫描（D 项）

- 全仓 grep `createTask|createDownload`：server 侧调用点仅 resolver :270、scheduler 内部 :102、download.controller :45、analysis.controller :367、summary-repair :312——与计划审计"调用方全量 sweep 4 处"一致，无遗漏。
- scripts/（含 packages/server/scripts）无 createTask/createDownload 引用 ✅。
- frontend `api.createDownload` 仅 ParseResultList.tsx:456、VideoDetail.tsx:319 两处调用；Home.tsx 无入队调用；其余 409 处理页面（Downloading/AiSummaryTasks 等）不经此端点，无波及。
- 低清子任务路径（scheduleInitialLowResDownload → insertAnalysisSubTask）不经 createTask，未受门影响 ✅。

## 文档/一致性（E 项）

- 计划 Phase 1-3 状态、勾选项与真实代码/测试一一对应，无虚勾；Closure Gates 除"closure audit was independent"留待本报告外全部成立。
- testing 文档各方向均有确认或显式裁决（前端运行级目测 → 用户部署后确认，理由记录在案）。
- 日志 `docs/logs/2026-09-09-download-create-dedup.md` 与实现一致（含 2026-08-10 决策推翻记录）。
- Plan audit（两轮）记录完整，首轮 Major 已修订，N1（判别联合）实现已采纳。

## 发现

| # | 严重度 | 问题 | 证据 | 处置 |
| --- | --- | --- | --- | --- |
| M1 | Minor | Closure Gate "relevant docs are aligned" 勾选，但 `docs/design/app-overview.md` 的 `POST /api/download` 端点行（:65、:87）只记录 400 语义，未补新 409 去重拒绝行为；计划 gate 括号要求"涉及入队行为描述需同步，否则写明无需更新"——该行确实描述入队行为，且既未同步也未写明无需更新，gate 证据链缺一环 | app-overview.md:65/:87 vs download.controller.ts:47-49 | 回填：在两行端点描述补"同 (bvid,cid) 存在排队中/下载中任务或已下载且文件在盘时返回 409"；属纯文档修正，不涉代码 |
| P1 | Note | 一键总结端点被拒时实际返回 502（外层 catch 再包装）而非 409——已在 plan audit N2 显式裁决接受，消息中文文本保留可见，无新动作 | analysis.controller.ts:377-379/:406-415 | 无需动作 |
| P2 | Note | testing 文档验证命令行写"bdl-test-pg：55432"，bdl-test-pg 是容器名，DB 名实为 bdl_test（project-context.md 口径）；表述易误导复跑者（本审计首轮即踩此坑连库失败一次） | testing doc :35 vs project-context.md:50 | 可顺手把表述改为"bdl-test-pg 容器（DB: bdl_test）"，非阻塞 |
| P3 | Note | 并发双建竞态为 watch-only residual，计划 Deferred 节三要素齐备 | plan :119-125 | 无需动作 |

## 结论

**pass-with-conditions**：9 项实现声称全部在 live code 落实；三项验证命令独立复跑全绿且数字吻合；回归扫描无遗漏调用方；测试方向全部确认或显式裁决。条件：M1 的 app-overview 两行端点描述回填（纯文档），回填后可将计划 Closure Gates 全勾、Status Note 更新为 closed。P2 建议顺手修正表述。

（本审计仅产出本报告文件；计划勾选与 M1 回填由实现侧完成。）
