# 2026-08-21 任务状态筛选多选测试验证

关联计划：`docs/plans/2026-08-21-task-status-multiselect-filter-plan.md`

## 验证范围

本测试文档描述"下载队列 + AI 总结两页状态筛选支持多选"落地后应保持的可观察状态。核心是：多选组合能同时查到多个状态的任务；单值旧调用向后兼容；空选择等于查看全部；非法值仍被拒绝。

## 前提

- 本机可运行 `pnpm`；后端可在本地启动（`pnpm --filter @bilibili-downloader/server start:dev` 或构建后启动）。
- 需要一个有多个状态任务（created/downloading/success/failed/stopped 与 pending/analyzing/completed/failed）的测试数据环境；如无真实数据，用运行级 stub 校验 SQL 过滤逻辑与参数解析（通过 controller/service 层或直接 SQL 语句验证）。

## 测试方向

### 下载队列 /tasks 多值过滤

- [x] 应成立：`GET /tasks?statusGroup=active,failed` 返回的任务状态 ∈ {created, downloading, failed}，且不含 success/stopped。
- [x] 应成立：`statusGroup=active`（单值）返回 {created, downloading}，与改造前行为一致（向后兼容）。
- [x] 应成立：`statusGroup=all` 或缺省或空串返回全部任务（不过滤）。
- [x] 应成立：`statusGroup=success,failed` 返回且仅返回 success 与 failed 两类。
- [x] 不应成立：`statusGroup=active,failed` 中出现重复任务或遗漏某状态；`active` 重复（如 `active,active`）不产生重复 IN 项导致 SQL 错误。
- [x] 不应成立：非法值（如 `statusGroup=bogus` 或 `statusGroup=active,bogus`）返回 2xx——应 400。

### AI 总结 /summary-tasks 多值过滤

- [x] 应成立：`GET /summary-tasks?status=analyzing,failed` 返回的任务状态 ∈ {analyzing, failed}。
- [x] 应成立：`status=pending`（单值）行为与改造前一致。
- [x] 应成立：`status=all` 或缺省或空返回全部（不过滤）。
- [x] 应成立：`status=completed,failed,pending` 三值组合正确。
- [x] 不应成立：非法值（`status=bogus`）返回 2xx——应 400。

### 前端多选交互

- [x] 应成立：下载队列状态下拉为多选，可同时勾选"进行中 + 失败"，列表仅含这两类任务，且请求参数为 `statusGroup=active,failed`。
- [x] 应成立：AI 总结状态下拉为多选，可同时勾选"处理中 + 失败"，列表仅含这两类，请求参数为 `status=analyzing,failed`。
- [x] 应成立：清空所有选择后回到全部列表；勾选/取消即时生效并回到第 1 页。
- [x] 应成立：两个下拉不再出现"全部/全部任务"单选项；未选任何项时 placeholder 提示查看全部。
- [x] 不应成立：多选后列表仍只按单一状态过滤，或分页状态（页码）未随筛选重置。

### 编译与文档一致性

- [x] 应成立：`pnpm typecheck`、`pnpm build` 全部通过。
- [x] 应成立：`docs/logs/2026/08-21.md` 记录本次变更。
- [x] 不应成立：活动文档把 `statusGroup`/`status` 描述为仅单值筛选。

### 范围外裁定

- [x] 已裁定：真实多状态任务数据的环境——用构建产物启动 server + better-sqlite3 注入 5 种下载状态/4 种总结状态数据，全接口实测覆盖；不强行构造真实下载。
- [x] 已裁定：搜索/日期筛选维度——本次不改，不在本测试范围。
- [x] 已裁定：状态值集合本身（增删状态）——不在本范围。

## 结果

### 通过

- [x] 下载队列多值过滤：`active,failed`→{created,downloading,failed}；`success,failed`→{success,failed}；单值 `active` 与改造前一致；`all`/缺省/空串→全部；`active,active` 去重正常；非法值 400。
- [x] AI 总结多值过滤：`analyzing,failed`→{analyzing,failed}；`completed,failed,pending`→3 类；单值 `pending` 一致；`all`/缺省/空→全部；重复值去重正常；非法值 400。
- [x] 前端：两页 `Select` 改 `mode="multiple"`，移除"全部"项，空选=全部；`statusGroup`/`status` 参数改为数组、逗号拼接（`URLSearchParams` 编码，服务端自动解码）。
- [x] `pnpm typecheck` exit 0；`pnpm build` exit 0（core/adapters/server/frontend 全 Done）。

### 明确裁定

- [x] 真实多状态环境：以注入数据 + 构建产物实测替代，覆盖全部状态值与组合。
- [x] 搜索/日期维度、状态值集合：范围外。

## 执行证据

- 运行级接口验证（构建产物 `packages/server/dist/main.js` + 临时 `OUTPUT_DIR`，端口 8891，better-sqlite3 注入 5 下载状态 + 4 总结状态）：多值/单值/all/空/去重/非法共 14 项 PASS（含 4 项 400）。
- 边界补测：`active,active`、空串、`failed,failed` 去重 4 项 PASS。
- `pnpm typecheck` exit 0；`pnpm build` exit 0。