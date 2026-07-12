# 视频截图源分离与降级策略 — 需求文档（已拆分）

> 本文档已拆分为两个独立子需求：
> - `2026-07-07-screenshot-source-fallback-3a.md`：FfmpegScreenshot 远端截图支持
> - `2026-07-07-screenshot-source-fallback-3b.md`：截图源降级策略
>
> 请使用拆分后的文档。本文档保留作为历史记录。

## Goal

将视频截图功能从"依赖已下载的本地视频文件"升级为"优先使用高分辨率远端流 URL 截图，失败时自动降级到本地视频"。通过 BVID 关联数据库已有下载任务或同步触发新下载，实现分析阶段不需要预先下载高分辨率视频即可获得高清截图。

## Background

当前视频分析流程中，`AnalysisEngine` 使用同一个 `videoPath`（本地视频文件路径）既给 LLM 分析又给 ffmpeg 截图。存在以下问题：

- 上传给 LLM 的视频需要低分辨率以节省 Token，但截图需要高分辨率以保证清晰度，二者冲突
- 截图依赖完整下载的高分辨率视频文件，但按时间戳截图并不需要完整下载
- 无法利用 B 站 DASH 流的多清晰度特性独立获取高分辨率流 URL

B 站 API 返回的 DASH 流中，每个清晰度对应独立的 `baseUrl`（`packages/adapters/src/bilibili/types.ts:99`）。`BilibiliStreamProvider.getPlayStreams()` 一次调用返回所有清晰度的流 URL，`ResolutionService.selectBestStream()` 支持按 quality 选流。因此可以独立获取高分辨率流 URL 供 ffmpeg 远端截图。

ffmpeg 支持直接用 HTTP URL 作为输入（`-i https://...`），并支持自定义 HTTP headers（`-headers`），可用于远端流截图。

## In Scope

### 1. FfmpegScreenshot 扩展

支持本地文件路径和 HTTP URL 两种输入：

```ts
export interface ScreenshotParams {
  /** 视频源，可以是本地文件路径或 HTTP URL */
  videoPath: string;
  /** 截图时间点列表（秒） */
  timePoints: number[];
  /** 截图输出目录 */
  outputDir: string;
  /** 文件名前缀 */
  filenamePrefix?: string;
  /** 自定义 HTTP headers，用于远端流请求（如 Referer） */
  headers?: Record<string, string>;
}
```

行为规则：

- `videoPath` 为本地路径时，`headers` 被忽略，行为与当前一致
- `videoPath` 为 HTTP URL 时，若配置了 `headers`，ffmpeg 命令加上 `-headers` 参数
- 远端截图失败判断标准：ffmpeg exit code 非 0、输出文件不存在或大小为 0
- 远端截图失败时由上层（ScreenshotSourceResolver）决定是否降级

### 2. 截图源解析器（ScreenshotSourceResolver）

新增抽象层，负责解析截图视频源：

```ts
// packages/server/src/analysis/screenshot-source-resolver.ts

interface ScreenshotSourceResolver {
  resolve(params: {
    metadata: { type: "bilibili" | "local"; videoUrl?: string; bvid?: string; cid?: number };
    localVideoPath?: string;
  }): Promise<{
    source: string;                              // 远端 URL 或本地路径
    sourceType: "remote" | "local";
    headers?: Record<string, string>;            // 远端时可能需要的 HTTP headers
  }>;
}
```

`AnalysisEngine` 只依赖 `ScreenshotSourceResolver` 接口，不直接依赖 `DatabaseService` 或 `DownloadService`。

`AnalysisInput` 的权威定义在 `2026-07-07-analysis-formal-api.md` 中。`metadata.bvid` 和 `metadata.cid` 用于 `ScreenshotSourceResolver` 查数据库和触发下载。

截图源选择优先级（与 `2026-07-07-ai-summary-interaction.md` 协调）：

- `AnalysisInput.screenshotVideoPath` 有值 → 直接使用该路径截图，**跳过 ScreenshotSourceResolver**
- `AnalysisInput.screenshotVideoPath` 无值 → 走 ScreenshotSourceResolver 降级逻辑（本文档下述流程）

### 3. 降级策略

#### metadata.type = local

直接返回本地视频路径，`sourceType: "local"`，不尝试远端截图。

#### metadata.type = bilibili

降级流程：

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

### 4. 最高清晰度判断规则

- `quality >= 80`（1080P）视为"够用"，直接使用已有下载任务的本地文件
- `quality < 80` 时，重新调用 B 站 API 获取该视频的可用清晰度列表，选择最高清晰度重新下载

### 5. 重新下载

#### 下载目录

- 高分辨率重新下载的视频直接放入 `downloads` 目录，与正常下载的视频同等对待
- 不为截图用视频专门创建独立目录
- 下载的视频文件保留，不删除

#### 同步执行

- 重新下载为同步执行，分析接口阻塞等待下载完成后继续截图
- 不走 `DownloadScheduler` 调度队列，直接调用 `DownloadService.executeTask()`，避免被其他排队任务阻塞
- 整体超时时间 10 分钟，超时后返回错误"下载超时，请稍后手动重试"

#### 下载任务记录

- 重新下载的任务仍写入数据库 `task` 表，`outputPath` 为 `downloads` 目录下的路径
- `status` 正常走 `created → downloading → success/failed` 流程

### 6. 远端流 URL 获取

通过 `ResolutionService.resolveStreams()` 获取所有清晰度的流 URL，使用 `selectBestStream()` 选择最高清晰度的视频流。

远端流 URL 请求时需要携带 `Referer: https://www.bilibili.com`，由 `ScreenshotSourceResolver` 传给 `FfmpegScreenshot` 的 `headers` 参数。

### 7. AnalysisEngine 调整

`AnalysisInput` 的权威定义在 `2026-07-07-analysis-formal-api.md` 中。

截图源选择逻辑：

- `AnalysisInput.screenshotVideoPath` 有值 → 直接使用该路径截图，跳过 ScreenshotSourceResolver
- `AnalysisInput.screenshotVideoPath` 无值 → 通过 `ScreenshotSourceResolver.resolve()` 获取截图源，resolver 使用 `metadata.bvid` 和 `metadata.cid` 查数据库和触发下载
- 截图失败（远端 + 本地均失败）时，该 segment 跳过截图，不中断整体分析流程

### 8. 远端截图失败后整体降级

一旦远端截图失败，剩余所有时间点都直接走本地截图，不再逐个尝试远端。因为远端失败通常由流 URL 不可用或网络问题导致，不太会只影响单个时间点。

## Out of Scope

- 不改变 LLM 分析流程（仍然是视频 + 字幕 → 一次 LLM 调用 → 返回时间戳）
- 不改变 Python 薄代理
- 不改变文档生成逻辑
- 不实现异步分析任务状态机（异步分析任务状态机由 `2026-07-07-ai-summary-interaction.md` 覆盖）
- 不实现前端轮询或进度展示
- 不涉及 `metadata.type` 的平台扩展
- 不处理远端流 URL 过期的主动刷新（依赖调用时即时获取）

## Affected Files

| 文件 | 改动 |
|---|---|
| `packages/adapters/src/ffmpeg/ffmpeg-screenshot.ts` | `ScreenshotParams` 新增 `headers`；`videoPath` 支持 HTTP URL |
| `packages/server/src/analysis/screenshot-source-resolver.ts` | 新增抽象接口及实现类 |
| `packages/server/src/analysis/analysis-engine.ts` | 通过 resolver 获取截图源；`AnalysisInput.metadata` 含 `bvid?` / `cid?` |
| `packages/server/src/analysis/analysis.controller.ts` | 正式接口入参通过 `metadata` 传递 `bvid` / `cid` |
| `packages/server/src/analysis/index.ts` | 导出 resolver 相关类型 |

## Acceptance Criteria

1. `FfmpegScreenshot` 支持本地文件路径和 HTTP URL 两种输入
2. `FfmpegScreenshot` 支持自定义 HTTP headers，用于远端流请求
3. `metadata.type=local` 时，直接使用本地视频路径截图，不尝试远端
4. `metadata.type=bilibili` 时，优先尝试远端高分辨率流 URL 截图
5. 远端截图失败时，按 metadata.bvid + metadata.cid 查数据库已有下载任务
6. 已有下载任务 `quality >= 80` 时，使用其本地文件截图
7. 已有下载任务 `quality < 80` 或不存在时，重新解析最高清晰度并同步下载
8. 重新下载的视频保留在 `downloads` 目录
9. 重新下载同步执行，超时 10 分钟
10. 远端截图失败后，剩余时间点全部走本地截图
11. `AnalysisEngine` 依赖 `ScreenshotSourceResolver` 接口，不直接依赖 `DatabaseService` 或 `DownloadService`
12. `pnpm typecheck` 和 `pnpm build` 通过
