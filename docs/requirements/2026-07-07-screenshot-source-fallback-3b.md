# 截图源降级策略 — 需求文档（3b）

> 拆分自 `2026-07-07-screenshot-source-fallback.md`
> 依赖 `2026-07-07-screenshot-source-fallback-3a.md`（FfmpegScreenshot 远端支持）

## Goal

新增 `ScreenshotSourceResolver` 抽象层，实现截图源自动降级：优先使用高分辨率远端流 URL，失败时查数据库已有下载任务，再失败时同步触发重新下载。通过 BVID 关联数据库，实现分析阶段不需要预先下载高分辨率视频即可获得高清截图。

## Background

`FfmpegScreenshot` 已支持 HTTP URL 输入（3a 完成）。B 站 API 返回的 DASH 流中，每个清晰度对应独立的 `baseUrl`。`BilibiliStreamProvider.getPlayStreams()` 一次调用返回所有清晰度的流 URL，`ResolutionService.selectBestStream()` 支持按 quality 选流。

## In Scope

### 1. 截图源解析器（ScreenshotSourceResolver）

```ts
// packages/server/src/analysis/screenshot-source-resolver.ts

interface ScreenshotSourceResolver {
  resolve(params: {
    metadata: { type: "bilibili" | "local"; videoUrl?: string; bvid?: string; cid?: number };
    localVideoPath?: string;
  }): Promise<{
    source: string;
    sourceType: "remote" | "local";
    headers?: Record<string, string>;
  }>;
}
```

`AnalysisEngine` 只依赖 `ScreenshotSourceResolver` 接口，不直接依赖 `DatabaseService` 或 `DownloadService`。

`AnalysisInput` 的权威定义在 `2026-07-07-analysis-formal-api.md` 中。`metadata.bvid` 和 `metadata.cid` 用于 resolver 查数据库和触发下载。

截图源选择优先级（与 `2026-07-07-ai-summary-interaction.md` 协调）：

- `AnalysisInput.screenshotVideoPath` 有值 → 直接使用该路径截图，**跳过 ScreenshotSourceResolver**
- `AnalysisInput.screenshotVideoPath` 无值 → 走 ScreenshotSourceResolver 降级逻辑（本文档下述流程）

### 2. 降级策略

#### metadata.type = local

直接返回本地视频路径，`sourceType: "local"`，不尝试远端截图。

#### metadata.type = bilibili

```text
Step 1: 尝试获取高分辨率远端流 URL
  ↓ 获取成功 → 返回 { source: 远端URL, sourceType: "remote", headers: { Referer } }
  ↓ 获取失败
Step 2: 查数据库，按 metadata.bvid + metadata.cid 找已有的成功下载任务
  ↓ 找到且 quality >= 80 (1080P) → 返回 { source: 本地文件路径, sourceType: "local" }
  ↓ 找到但 quality < 80 或未找到
Step 3: 重新解析视频清晰度列表，选择最高清晰度，同步触发下载
  ↓ 下载完成 → 返回 { source: 本地文件路径, sourceType: "local" }
  ↓ 下载失败 → 抛出错误
```

### 3. 最高清晰度判断规则

- `quality >= 80`（1080P）视为"够用"，直接使用已有下载任务的本地文件
- `quality < 80` 时，重新调用 B 站 API 获取该视频的可用清晰度列表，选择最高清晰度重新下载

### 4. 重新下载

- 高分辨率重新下载的视频直接放入 `downloads` 目录，与正常下载的视频同等对待
- 不为截图用视频专门创建独立目录
- 下载的视频文件保留，不删除
- 重新下载为同步执行，分析接口阻塞等待下载完成
- 不走 `DownloadScheduler` 调度队列，直接调用 `DownloadService.executeTask()`
- 整体超时时间 10 分钟，超时后返回错误"下载超时，请稍后手动重试"
- 重新下载的任务仍写入数据库 `task` 表，`outputPath` 为 `downloads` 目录下的路径

### 5. 远端流 URL 获取

通过 `ResolutionService.resolveStreams()` 获取所有清晰度的流 URL，使用 `selectBestStream()` 选择最高清晰度的视频流。

远端流 URL 请求时需要携带 `Referer: https://www.bilibili.com`，由 `ScreenshotSourceResolver` 传给 `FfmpegScreenshot` 的 `headers` 参数。

### 6. AnalysisEngine 调整

截图源选择逻辑：

- `AnalysisInput.screenshotVideoPath` 有值 → 直接使用该路径截图，跳过 ScreenshotSourceResolver
- `AnalysisInput.screenshotVideoPath` 无值 → 通过 `ScreenshotSourceResolver.resolve()` 获取截图源
- 截图失败（远端 + 本地均失败）时，该 segment 跳过截图，不中断整体分析流程

### 7. 远端截图失败后整体降级

一旦远端截图失败，剩余所有时间点都直接走本地截图，不再逐个尝试远端。

## Out of Scope

- 不改变 LLM 分析流程
- 不改变 Python 薄代理
- 不改变文档生成逻辑
- 不实现异步分析任务状态机（由 `2026-07-07-ai-summary-interaction.md` 覆盖）
- 不实现前端轮询或进度展示
- 不涉及 `metadata.type` 的平台扩展

## Affected Files

| 文件 | 改动 |
|---|---|
| `packages/server/src/analysis/screenshot-source-resolver.ts` | 新增抽象接口及实现类 |
| `packages/server/src/analysis/analysis-engine.ts` | 通过 resolver 获取截图源；`AnalysisInput.metadata` 含 `bvid?` / `cid?` |
| `packages/server/src/analysis/analysis.controller.ts` | 正式接口入参通过 `metadata` 传递 `bvid` / `cid` |
| `packages/server/src/analysis/index.ts` | 导出 resolver 相关类型 |

## Acceptance Criteria

1. `metadata.type=local` 时，直接使用本地视频路径截图，不尝试远端
2. `metadata.type=bilibili` 时，优先尝试远端高分辨率流 URL 截图
3. 远端截图失败时，按 metadata.bvid + metadata.cid 查数据库已有下载任务
4. 已有下载任务 `quality >= 80` 时，使用其本地文件截图
5. 已有下载任务 `quality < 80` 或不存在时，重新解析最高清晰度并同步下载
6. 重新下载的视频保留在 `downloads` 目录
7. 重新下载同步执行，超时 10 分钟
8. 远端截图失败后，剩余时间点全部走本地截图
9. `AnalysisEngine` 依赖 `ScreenshotSourceResolver` 接口，不直接依赖 `DatabaseService` 或 `DownloadService`
10. `screenshotVideoPath` 有值时跳过 resolver
11. `pnpm typecheck` 和 `pnpm build` 通过
