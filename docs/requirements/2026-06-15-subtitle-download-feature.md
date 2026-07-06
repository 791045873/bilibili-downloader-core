status: new
processed: pending

# 字幕下载功能 — 需求描述

## 背景

当前代码中字幕下载的骨架已经存在：
- Core 层已有 `downloadSubtitle?: boolean` 开关
- Adapter 层已有完整的 `BilibiliSubtitleProvider`（WBI 签名 → PlayerV2 API → JSON→SRT）
- 服务端 `executeTask()` 有字幕下载的调用逻辑

但存在几个问题：
1. Adapter 未从 `bilibili-api.ts` 导出，服务端未注入
2. `DownloadDto` 没有字幕语言字段
3. 前端设置页只有布尔值开关（下载/不下载），没有语言选择
4. 前端待下载页不能对已入队的任务调整字幕设置

## 需求

### 设置页（本次不修改）

Settings.vue 中的"下载字幕"保持当前布尔值开关不变。当前不涉及设置页改造。

### 任务级字幕语言选择 — VideoDetail 每个分 P 入队前

VideoDetail.vue 中，TreeTable 的每一行（每个分 P）当前已有画质和编码的下拉选择。在此基础上**增加一列"字幕"**：

| 选项 | 值 | 行为 |
|------|-----|------|
| 不下载字幕 | `"none"` | 跳过字幕 |
| 中文字幕 | `"zh"` | 仅下载语言代码为 `zh-CN` / `zh` 的字幕 |
| 英文字幕 | `"en"` | 仅下载语言代码为 `en-US` / `en` 的字幕 |
| 全部字幕 | `"all"` | 下载 API 返回的所有语言字幕 |

- 每个分 P 独立选择，互不影响
- 默认值为 `"none"`（不下载字幕）
- 此选择在调用 `api.createDownload()` 时提交到后端

### 待下载页（Downloading.vue）不涉及字幕调整

Downloading.vue 仅展示下载进度和状态，不提供字幕修改功能。任务入队后字幕语言不可更改。

### 4. 数据传递

字幕语言设置在 `POST /download` 时提交，存储在 SQLite task 表中：
- 新增 `task.subtitle_lang` 列（字符串）
- `DownloadDto` 增加 `subtitleLang?: "none" | "zh" | "en" | "all"`
- `executeTask()` 读取该值，转换为 `DownloadExecutionRequest.subtitleLanguages`

### 5. 后端字幕筛选逻辑

`BilibiliSubtitleProvider.fetchSubtitles()` 当前返回 API 获取到的全部字幕。筛选逻辑应该在 `DownloadExecutionUseCase` 中：

```ts
if (request.subtitleLanguages === "none")  → 跳过
if (request.subtitleLanguages === "all")   → 全部写入
if (Array.isArray(request.subtitleLanguages)) → 只写入 langKey 匹配的字幕
```

约束：
- 不下载其他语言（日语、韩语、泰语等）只有当用户显式选择"全部字幕"时才下载
- 不需要默认字幕副本（即不需要 `{filePath}.srt` 无后缀版本）
- 字幕下载失败不阻塞视频下载主流程

## 非需求（本次不实现）

- 直接在 CLI 参数中指定字幕语言
- 字幕预览/编辑
- 字幕格式选择（仅 SRT，不考虑 ASS/VTT）

## 数据模型变更

### Core 层

`DownloadExecutionRequest`（`packages/core/src/usecases/DownloadExecutionUseCase.ts`）：
- 将 `downloadSubtitle?: boolean` 改为 `subtitleLanguages?: "none" | "all" | string[]`

`DownloadRequest`（`packages/core/src/domain/DownloadRequest.ts`）：
- 将 `downloadSubtitle?: boolean` 改为 `subtitleLanguages?: "none" | "all" | string[]`

`SubtitleProviderPort.fetchSubtitles()` 返回值不变，筛选在 `DownloadExecutionUseCase` 中进行。

### Server 层

`TaskRecord`（`packages/server/src/database/database.service.ts`）：
- 增加 `subtitleLang?: string` 字段（数据库存储、CRUD 透传）

`DownloadDto`（`packages/server/src/download/download.dto.ts`）：
- 增加 `subtitleLang?: string`

`download.service.ts` 的 `executeTask()`：
- 从 task record 读取 `subtitleLang`，转换为 `DownloadExecutionRequest.subtitleLanguages`
- 将 `BilibiliSubtitleProvider` 注入到 `executionDeps`

### 前端

`api/index.ts` 中 `createDownload()` 请求体增加 `subtitleLang?: string` 参数。

`VideoDetail.vue` 中，TreeTable 在"编码"列之后增加"字幕"列，使用 Select 下拉框。

## 实现范围

需要修改的文件（预估 9 个）：

1. `packages/core/src/usecases/DownloadExecutionUseCase.ts` — 字段改为 `subtitleLanguages` + 筛选逻辑
2. `packages/core/src/domain/DownloadRequest.ts` — 字段改为 `subtitleLanguages`
3. `packages/adapters/src/bilibili/bilibili-api.ts` — 导出 `BilibiliSubtitleProvider`
4. `packages/server/src/download/download.dto.ts` — 增加 `subtitleLang`
5. `packages/server/src/download/download.service.ts` — 注入 SubtitleProvider + 透传
6. `packages/server/src/database/database.service.ts` — `TaskRecord` 增加 `subtitleLang`，schema 增加列
7. `packages/frontend/src/api/index.ts` — 请求体增加参数
9. `packages/frontend/src/views/VideoDetail.vue` — TreeTable 增加字幕语言选择列
10. `packages/frontend/src/types/index.ts` — 类型定义更新

不修改的文件：
- `BilibiliSubtitleProvider` 本身 — 已完整实现，无需改动
- `SubtitleProviderPort` 接口 — 返回值不变

## 验收标准

### 设置页
- [ ] 设置页的"下载字幕"从复选框改为下拉选择器（不下载/中文/英文/全部字幕）
- [ ] 保存后，新建任务的默认字幕语言使用此设置

### 加入队列时
- [ ] VideoDetail 的 TreeTable 在"编码"列之后有"字幕"列，使用 Select 下拉框
- [ ] 四个选项可选（不下载/中文/英文/全部字幕）
- [ ] 默认值为 `"none"`
- [ ] 每个分 P 独立选择字幕语言

### 待下载页
- [ ] Downloading.vue 不涉及字幕修改（入队后不可更改）

### 设置页
- [ ] Settings.vue 不涉及字幕语言选择器改造（保持当前布尔值开关不变）

### 下载执行
- [ ] 选择"不下载" → 不生成任何 .srt 文件
- [ ] 选择"中文" → 仅生成 `{文件名}.zh-CN.srt`
- [ ] 选择"英文" → 仅生成 `{文件名}.en-US.srt`
- [ ] 选择"全部字幕" → 生成 API 返回的所有语言字幕文件
- [ ] 没有无语言后缀的默认副本
- [ ] 字幕下载失败不影响主流程
- [ ] `pnpm typecheck` 通过