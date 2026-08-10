# 2026-08-10 下载输出文件命名：唯一性与模板

## Status

- 结论已形成，P0/P2 拆分为两个计划，见 `docs/plans/`。
- 剩余一个待确认问题记录在「Open Questions」。

## Source

- 用户问题：服务端下载任务直接用视频标题作为文件名，无法处理同目录同名文件。
- Live Baseline：2026-08-10 代码探索。

## Problem

`packages/server/src/download/download.service.ts:490` 用标题直接拼接文件名：

```ts
const fileName = `${sanitizeFileName(task.title!)}.mp4`;
```

`sanitizeFileName` 只替换 `[<>:"/\\|?*]` 这 9 个非法字符。

同名冲突时的真实行为是**静默跳过**：`packages/core/src/usecases/DownloadExecutionUseCase.ts:63-88` 检测到目标文件已存在就直接返回成功（`文件已存在, 跳过下载`）。后果：

- 同标题的第二个视频不会真正下载，却返回成功，落盘的是第一个视频 —— 假成功 + 错误内容，用户无法察觉。
- `DownloadRequest.skipExisting` 字段已定义但全库未使用，无法配置该行为。

## Root Cause / 相关现状

- `DownloadRequest.fileNameTemplate`（core 定义）从未被 server 使用。
- `DownloadPlan.outputFileName`（core 定义）从未被 server 使用，server 自行拼接。
- `executeLowResDownload`（download.service.ts:311）已使用 `{title}-{bvid}-{cid}-q{quality}.mp4`，天然无冲突，可作为主流程参考。
- `task.quality` 可能为空（默认取最佳流），真实清晰度需用解析后选中的 `videoStream.quality`。
- 字幕文件命名（DownloadExecutionUseCase.ts:153）基于主文件 `outputFile` 派生，命名变化会自动跟随。
- 下游分析（screenshot-source-resolver / analysis-trigger）读取 DB 中存储的 `outputFile`，不依赖文件名格式，自动适配新命名。

## Decisions（已确认）

1. **P0 采用策略 A2**：主流程文件名改为 `{title}-{bvid}-{cid}-q{quality}.mp4`，与 `executeLowResDownload` 命名模式完全一致。
   - 不同视频（bvid+cid 不同）即使标题相同也必然不冲突；
   - 同一视频重复入队 → 文件名一致 → 现有"已存在即跳过"逻辑继续成立，行为可预期；
   - 同一视频不同画质各下载一份 → 因 quality 不同各存一份。
2. **P1 标题清洗不单列**：当前数据源传入的标题均为产品中已正常使用的合法字符串，不做保留设备名、结尾点/空格、控制字符等防御性清洗，也不做长度截断守卫。
3. **P2 落地 `fileNameTemplate` + 命名逻辑收敛单一模块**：
   - `{title}` 的默认来源保持**前端提交的展示标题**（多P/合集场景前端标题含"剧集名 - Px 分P标题"，信息最全；服务端从 B 站回源无法还原该组合，见下方分析）；
   - `outputPath` 作为独立目录字段的语义保持不变；
   - 模板为空时回退到 P0 的默认命名，唯一性保证不丢失。
4. **UI 层去重控制移除，以服务端为准**：
   - 前端**保留**基于 DB 记录的"已下载"标记（展示性角标），但**不再拦截**用户加入下载队列 —— 复选框不再禁用，用户可随时选择任意视频。
   - 服务端是唯一裁决：任务执行时以 `DownloadExecutionUseCase` 的**磁盘文件存在性检查**为准 —— 文件在则跳过（`文件已存在, 跳过下载`），文件被删除/挪走则重新下载。
   - `POST /api/tasks/check` 接口**保留**：前端"已下载"标记仍依赖它查询 DB 记录。
   - 已确认行为：跳检基于 `NodeFileStore.exists`（`fs.access` 真实磁盘检查），DB 记录不参与跳检决策；DB 有记录但文件缺失时，任务被执行即重新下载。

## Confirmed Behavior Note

- 跳检只看磁盘上是否存在目标文件，不看 DB 记录（`DownloadExecutionUseCase.ts:64` → `NodeFileStore.exists`，node-file-store.ts:35-48）。

## Analysis Note（P2 标题来源）

前端两个入队入口的 title 都是基于 B 站元数据合成的展示标题，不是任意用户输入：

- 单视频（VideoDetail.vue `buildMockVideoNode`）：`视频标题 - P{page} {分P标题}`
- 合集/剧集（VideoDetail.vue `buildEpisodeTree`）：`剧集标题 - P{page} {分P标题}`
- `outputPath` 默认值同样由前端按 `合集名/剧集名` 合成（`currentSectionDefaultPath`）。

服务端 `ResolutionService.resolve` 只能合成 `videoInfo.title + " P{page}"`，无法还原"剧集层标题 + 分P标题"的组合。因此 P2 **不做**"改用 B 站回源标题"。

## Open Questions

- P2 的 `fileNameTemplate` 配置入口 —— **已决策**：仅设置页全局默认（选项 A）。
  - 前端 settings store 新增全局默认模板字段（localStorage），设置页提供输入；`createDownload` 随请求透传。
  - 由于文件名在执行时构建，模板需在任务创建时捕获并持久化到 `task` 表，执行时读取（空则回退 P0 默认命名）。
  - 不做入队弹框单任务覆盖。

## Related Plans

- `docs/plans/2026-08-10-download-file-name-uniqueness-plan.md`（P0，微计划）
- `docs/plans/2026-08-10-download-file-name-template-plan.md`（P2，全计划，Phase 1 决策已定）
- `docs/plans/2026-08-10-download-enqueue-dedup-ux-plan.md`（UI 去重控制移除，微计划）
