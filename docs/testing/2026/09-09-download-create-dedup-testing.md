# 下载入队创建层去重 — 测试方向

对应需求：`docs/requirements/2026-09-09-download-create-dedup.md`
对应计划：`docs/plans/2026-09-09-download-create-dedup-plan.md`

## 需求级观察状态

### 服务端拦截（需求 1/AC1-AC4）

- 应为真：同 (bvid,cid) 存在 created/downloading 任务时，POST /api/download 返回 409 且提示"排队中/下载中"，task 表无新行。
- 应为真：同 (bvid,cid) 存在 success 任务且 outputFile 经 `join(DOWNLOAD_ROOT, value)` 后磁盘存在时，返回 409 且提示"已下载"，task 表无新行。
- 应为真：success 但磁盘文件被删 → 不拦截，正常创建。
- 应为真：不同 cid 互不影响（P1 已下载，P2 可正常入队）。
- 应为真：不同 (bvid,cid) 完全互不影响。
- 应为假：去重判定不以 process.cwd() 为锚（必须经 DOWNLOAD_ROOT 解析相对值）。

### 内部豁免（需求 3/AC5）

- 应为真：resolver 截图回退链路 `createTask` 带 skipDedup，行为与改动前一致（同资源有 active/success 记录时仍能创建并同步执行）。

### 前端呈现（需求 2/AC6）

- 应为真：ParseResultList 批量入队时被拒资源在页面展示服务端提示文本。
- 应为真：VideoDetail 入队被拒时展示提示文本（此前错误被逐任务吞掉，需补齐）。
- 应为真：409 消息以服务端中文消息呈现（request() 错误提取优先 err.message）。

### 回归（需求 5/AC7）

- 应为真：typecheck / build / server 测试全绿；既有入队成功路径（200 + id + message）不变。

## 验证命令

- `pnpm typecheck` — ✅ 通过（2026-09-09）
- `pnpm build` — ✅ 通过（2026-09-09）
- `pnpm --filter @bilibili-downloader/server test` — ✅ 12 文件 / 87 用例全部通过（2026-09-09，TEST_DATABASE_URL → 本地测试库 bdl_test @55432，容器名 bdl-test-pg）
- 前端入队 409 提示的真实页面交互：留用户部署后手动确认（代码级 + typecheck 证明）

## 各方向确认（2026-09-09）

- 服务端拦截：✅ 自动化（`tests/download/create-dedup.test.ts` 纯函数 5 用例：active 拦 / success+文件存在拦 / 文件缺失放行 / 无 outputFile 放行 / 无记录放行；`tests/database/task.test.ts` 覆盖 `findActiveTaskByBvidAndCid` created/downloading 命中、success/failed/异 cid 不命中）；DOWNLOAD_ROOT 锚点解析由 path-anchor roundtrip 测试保证（前批次）
- 内部豁免：✅ 代码级核对（resolver `createTask(..., {skipDedup:true})`，重载签名保证返回 `{created:true,id:number}`，typecheck 强制）
- 前端呈现：✅ 代码级（request() 优先 err.message；VideoDetail 逐任务消息汇总 setErrorMsg；ParseResultList 既有汇总路径展示服务端消息）；真实页面交互留用户部署后确认（adjudicated）
- 回归：✅ typecheck/build 全绿、server 测试全绿；入队成功路径返回 `{id,message}` 不变

裁决说明：前端 409 提示的运行级人工目测留用户部署后确认；其余方向自动化证据已覆盖。
