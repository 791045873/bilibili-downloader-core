# 2026-09-04 解析历史卡片（首页快捷进入）

## Source

- Owner Doc: `docs/design/app-overview.md`
- Raw Input: 用户口头需求（2026-09-04）："用户粘贴链接解析后，将解析结果缓存为卡片展示在首页输入框下方，用户下次可直接点击最近的解析卡片进入内容，不需要再次粘贴链接。"
- Discussion: `docs/discussions/2026-09-04-parse-history-cache-granularity.md`（缓存粒度与各类型再次进入路径分析）
- Live Baseline（2026-09-04 核对）:
  - `packages/frontend/src/pages/Home.tsx`：首页输入框，`handleSubmit` 仅跳转 `/parse-result?input=...`
  - `packages/frontend/src/pages/ParseResult.tsx`：解析分发页，成功后按类型 redirect 到 `/parse-result/list?type=...&bvid|seasonId|mediaId|currentBvid=...`；`user-space` 停留本页展示分组卡片
  - `packages/frontend/src/pages/ParseResultList.tsx`：内容列表页，按 `type` + ID 参数重新拉取数据（`type=video` 时内部重新调用 `parseLink`）
  - `packages/frontend/src/stores/settings.ts` / `stores/downloadQueue.ts`：现有 Zustand `persist` + 自定义 `merge` 模式
  - `packages/frontend/src/api/index.ts`：`POST /api/parse-link`；封面代理 `GET /api/video/cover?url=...`

## Problem

解析是每次会话的孤立动作：用户想再次进入之前解析过的视频/合集/收藏夹/用户空间时，必须重新粘贴原始链接并等待解析，没有快捷入口。

## Goal

在首页输入框下方展示"最近解析"卡片。用户点击卡片即可直接进入对应内容列表页（复用现有 `/parse-result/list` 流程），无需重新粘贴链接。

## 已确认的产品决策（用户确认，2026-09-04）

1. **缓存位置：浏览器 localStorage**（纯前端改动，不改后端 API、不改数据库；遵循现有 Zustand persist store 模式）。
2. **缓存粒度：只存"入口信息"**（key / type / 标题 / 封面 / 跳转参数 / 时间），不缓存完整解析结果。事实依据：4 种解析结果中 3 种（video∈合集 / ugc-season / favorites / user-space 列表）再次进入本就只凭 ID 调分页接口、无重复解析；唯一重复 parseLink 的是 `video`（非合集）路径，但列表页仍需 `checkTasks` 拉实时任务状态，省 1 次 parseLink 收益有限，且避免给 `ParseResultList` 增加预置数据分支与 pages 过期风险（用户确认 2026-09-04）。
3. **点击行为：跳转列表页并重新拉取**（卡片仅作为快捷入口，导航到 `/parse-result/list?type=...`，页面按现有逻辑拉取最新数据，含下载/总结状态；不直接用缓存数据渲染内容页）。
4. **user-space 卡片直达投稿视频列表**（`type=user-videos&mid=`），不经过分组视图（用户确认 2026-09-04；分组视图依赖完整 UserSpaceResult 且合集列表易过期）。

## In Scope

- 新增前端 Zustand persist store `parseHistory`（localStorage key 如 `bilibili-downloader-parse-history`），记录最近解析成功的目标。
- 解析成功时写入/更新缓存：在 `ParseResult.tsx` 解析成功分支（redirect 前 / user-space 展示前）记录。
- 首页 `Home.tsx` 输入框下方新增"最近解析"卡片区（在有缓存时渲染；无缓存不渲染该区块）。
- 卡片点击导航到对应的 `/parse-result/list?type=...` 目标（与 `ParseResult.tsx` 现有 redirect 目标一致）。
- 支持删除单张卡片。

## Out Of Scope

- 不改后端任何 API / 数据库 / Prisma schema。
- 不缓存完整解析结果（见已确认决策 2；`video` 类型点击卡片接受 1 次 parseLink）。
- 不做解析结果数据的离线渲染（点击后始终重新请求）。
- 不做跨设备同步（localStorage 仅本浏览器）。
- 不做"清除全部"独立入口（仅逐卡删除；超出上限自动淘汰最旧）。
- 不改动 `/video`（VideoDetail，现存孤儿路由）。

## Main User Flows

### Flow 1: 解析后生成卡片

1. 用户在首页粘贴链接并提交，进入 `/parse-result`。
2. 解析成功：
   - `video` / `ugc-season` / `favorites`：redirect 前，按 redirect 目标记录一条卡片（video 且属于合集时，记录合集目标 `ugc-season&seasonId=...&currentBvid=...`）。
   - `user-space`：展示分组卡片时，记录一条"用户空间"卡片（`user-videos&mid=...`）。
3. 返回首页后，输入框下方出现该卡片（封面缩略图 + 标题 + 类型标识 + 解析时间）。

### Flow 2: 点击卡片直接进入

1. 用户打开首页，看到"最近解析"卡片（最近的在前）。
2. 点击卡片 → 导航到 `/parse-result/list?type=...&参数`，页面按现有逻辑重新拉取最新数据（`video` 非合集路径会执行 1 次 parseLink + checkTasks；其余类型仅调对应分页接口 + checkTasks）。
3. 卡片上的封面经 `/api/video/cover?url=` 代理加载。

### Flow 3: 删除卡片

1. 卡片右上角提供删除按钮，点击后该卡片从缓存移除，UI 即时更新。

## Business Rules

- 缓存条目结构：`{ key, type, title, coverUrl?, params, parsedAt }`；`key` 由 `type` + 目标 ID 组成（如 `video-BVxxxx`、`ugc-season-123`、`favorites-456`、`user-videos-789`）。
- 去重：同一 `key` 再次解析成功时移到最前并更新 `title`/`coverUrl`/`parsedAt`，不产生重复卡片。
- 上限：保留最近 12 条，超出淘汰最旧。
- 排序：按 `parsedAt` 倒序（最近在前）。
- 仅记录解析**成功**的结果；解析失败不写缓存。
- 卡片可展示的类型与目标映射（与 `ParseResult.tsx` redirect 一致）：
  - `video` → `type=video&bvid=`（标题=视频标题，封面=视频封面）
  - `video`（属于合集）→ `type=ugc-season&seasonId=&currentBvid=`（标题=合集标题或视频标题）
  - `ugc-season` → `type=ugc-season&seasonId=`（标题=合集标题）
  - `favorites` → `type=favorites&mediaId=`（标题=收藏夹标题）
  - `user-space` → `type=user-videos&mid=`（标题=UP 主名，封面=头像）

## Roles / Permissions

- 不涉及（单用户本地工具，无权限模型）。

## Data / Model / API Impact

- 数据模型、API 契约均不变。纯前端 localStorage。

## Edge Cases

- localStorage 不可用（隐私模式/被禁用）：读写静默失败降级，首页不渲染卡片区，解析流程不受影响。
- localStorage 数据损坏 / 格式不识别：`merge` 容错回退为空列表，不崩溃。
- 卡片对应内容已失效（视频被删等）：点击后由 `/parse-result/list` 现有错误处理展示，不在卡片层预判。
- 封面 URL 过期（B站封面 CDN 链接一般长期有效，但代理依赖服务端转发）：加载失败显示占位样式，不崩溃。
- `parsedAt` 用本地时间戳（毫秒），仅用于排序与展示相对时间。

## Open Questions

- 无（缓存位置与点击行为已由用户确认；其余为不影响用户可见行为的实现细节，按 Business Rules 假设执行，可在 review 时调整上限数值 12 与展示样式）。

## Acceptance Criteria

- [ ] 任一类型解析成功后返回首页，输入框下方出现对应卡片（封面/标题/类型标识/时间）。
- [ ] 点击卡片导航到正确 `/parse-result/list` 目标，页面正常加载（与手动重新粘贴链接进入的效果一致）。
- [ ] 同一内容重复解析不产生重复卡片，且移到最前并刷新标题/时间。
- [ ] 超过 12 条时最旧的自动淘汰。
- [ ] 单卡可删除，删除后首页即时更新，刷新页面后不再出现。
- [ ] localStorage 清空/损坏时应用不崩溃，首页无卡片区，解析流程正常。
- [ ] `pnpm typecheck`、`pnpm build` 通过。
