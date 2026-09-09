# 2026-09-09 下载入队创建层去重

- 需求/计划/测试文档：`docs/requirements/2026-09-09-download-create-dedup.md`、`docs/plans/2026-09-09-download-create-dedup-plan.md`（Plan Audit 两轮：首轮 FAIL 1 Major 已修订，复审 PASS-with-notes，见 `docs/audits/2026-09-09-plan-audit-download-create-dedup.md`）、`docs/testing/2026/09-09-download-create-dedup-testing.md`
- 决策推翻记录：2026-08-10"创建层不去重、执行时磁盘存在性唯一裁决"被本需求有意推翻（用户直接请求 + 口径确认：bvid+cid 匹配；active 与 success+文件在盘两类都拦）
- 改动：
  - 新建 `packages/server/src/download/create-dedup.ts`：纯函数 `decideCreateDedupVerdict`（active 拦 / success+文件存在拦 / 其余放行）
  - `database.service.ts` 新增 `findActiveTaskByBvidAndCid`（status ∈ created/downloading，最新一条）
  - `download.service.ts` `createTask` 重载：默认去重门（active → completed+磁盘校验 `resolveFromDownloadRoot`+`fileExists`），`{skipDedup:true}` 返回 `{created:true,id:number}`；返回类型判别联合
  - `download-scheduler.createDownload` 返回形状同步；`download.controller` created=false → `ConflictException(result.message)`
  - `analysis-video-resolver` 截图回退传 `{skipDedup:true}`（行为不变）；一键 AI 总结（analysis.controller）created=false → ConflictException；总结修复延迟重下（summary-repair）被拒条目入 deferred 并附服务端消息、不填 queuedTaskId
  - 前端：`request()` 错误提取改 `err.message || err.error || HTTP ${status}`（修正既有 4xx 中文消息被 "Bad Request"/"Conflict" 掩盖）；`VideoDetail.doAddToQueue` 逐任务 catch 保留消息并汇总展示；`ParseResultList` 已有汇总展示无需改
- 测试：新增 `tests/download/create-dedup.test.ts`（5 用例）与 `tests/database/task.test.ts` `findActiveTaskByBvidAndCid` 用例（1 条含状态流转）
- 验证：`pnpm typecheck`、`pnpm build` 通过；`pnpm --filter @bilibili-downloader/server test` 12 文件 / 87 用例全绿（TEST_DATABASE_URL → 本地 bdl-test-pg）
- 待用户操作：部署后手动验证两个入队页的 409 提示呈现（代码级已核对提示路径）
