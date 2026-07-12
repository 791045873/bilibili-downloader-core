# FfmpegScreenshot 远端截图支持 — 需求文档（3a）

> 拆分自 `2026-07-07-screenshot-source-fallback.md`

## Goal

扩展 `FfmpegScreenshot`，使其支持直接使用 HTTP URL 作为视频输入源进行截图，并支持自定义 HTTP headers（如 Referer），为后续远端截图降级策略提供基础能力。

## Background

当前 `FfmpegScreenshot` 的 `-i` 参数只接受本地文件路径。B 站 DASH 流每个清晰度对应独立的 `baseUrl`，ffmpeg 本身支持直接用 HTTP URL 作为输入并支持 `-headers` 参数。本需求仅扩展 adapter 层能力，不涉及降级策略。

## In Scope

### 1. ScreenshotParams 扩展

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

### 2. 行为规则

- `videoPath` 为本地路径时，`headers` 被忽略，行为与当前一致
- `videoPath` 为 HTTP URL 时，若配置了 `headers`，ffmpeg 命令加上 `-headers` 参数
- 远端截图失败判断标准：ffmpeg exit code 非 0、输出文件不存在或大小为 0
- 本地截图行为不受影响

## Out of Scope

- 不实现 ScreenshotSourceResolver（在 `2026-07-07-screenshot-source-fallback-3b.md` 中）
- 不实现降级策略
- 不改变 AnalysisEngine
- 不改变截图时间点计算逻辑

## Affected Files

| 文件 | 改动 |
|---|---|
| `packages/adapters/src/ffmpeg/ffmpeg-screenshot.ts` | `ScreenshotParams` 新增 `headers`；`videoPath` 支持 HTTP URL |

## Acceptance Criteria

1. `FfmpegScreenshot` 支持本地文件路径和 HTTP URL 两种输入
2. `FfmpegScreenshot` 支持自定义 HTTP headers，用于远端流请求
3. 本地路径截图行为与当前一致，无回归
4. 远端截图失败时返回 false，不抛出异常
5. `pnpm typecheck` 和 `pnpm build` 通过
