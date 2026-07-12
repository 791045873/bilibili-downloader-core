# 视频分析正式 API 接口 — 需求文档

## Goal

将当前用于调试的 `POST /api/analysis/debug` 接口升级为正式调用接口 `POST /api/analysis/run`，入参由调用方指定视频路径、字幕路径和视频元数据，通过 `metadata.type` 区分视频来源（平台或本地），并控制文档 front matter 中 `video_url` 字段的填写规则。

## Background

当前调试接口 `POST /api/analysis/debug` 不接收任何入参，视频路径、字幕路径、视频标题全部写死为 `test_assets/video1.mp4`、`test_assets/video1.srt` 和 ffprobe 读取的 title。这种方式只能用于本地调试，无法被下载流程或外部系统正式调用。

需要将其升级为正式接口，由调用方传入完整的分析请求。

## In Scope

### 1. 接口定义

- 路径：`POST /api/analysis/run`
- 原 `POST /api/analysis/debug` 替换为正式接口，不再保留

### 2. 入参结构

本文档是 `AnalysisInput` 和 `AnalysisRequest` 的权威定义来源，其他需求文档引用本定义。

```ts
interface AnalysisRequest {
  /** LLM 分析用视频文件绝对路径（低分辨率或唯一可用分辨率） */
  videoPath: string;
  /** 字幕文件绝对路径，可选（无字幕时不传） */
  subtitlePath?: string;
  /** 视频标题 */
  videoTitle: string;
  /** 视频元数据 */
  metadata: {
    /** 视频来源类型 */
    type: "bilibili" | "local";
    /** 视频在平台上的完整 URL；type=bilibili 时必填且有值；type=local 时不关心 */
    videoUrl?: string;
    /** B 站视频 ID；type=bilibili 时必填 */
    bvid?: string;
    /** B 站分 P ID；type=bilibili 时必填 */
    cid?: number;
  };
  /** 截图用视频路径（高分辨率）。不传时走 ScreenshotSourceResolver 降级逻辑 */
  screenshotVideoPath?: string;
}
```

### 3. 校验规则

| 条件 | 规则 |
|---|---|
| `videoPath` | 必填，必须为绝对路径 |
| `subtitlePath` | 可选；如传入必须为绝对路径 |
| `videoTitle` | 必填，非空字符串 |
| `metadata` | 必填 |
| `metadata.type` | 必填，值为 `"bilibili"` 或 `"local"` |
| `metadata.type=bilibili` | `metadata.videoUrl`、`metadata.bvid`、`metadata.cid` 必填且非空 |
| `metadata.type=local` | `metadata.videoUrl`、`metadata.bvid`、`metadata.cid` 不关心，可不传 |
| `screenshotVideoPath` | 可选；如传入必须为绝对路径 |

### 4. metadata.type 对文档生成的影响

| `metadata.type` | front matter `video_url` |
|---|---|
| `bilibili` | 必须有值，值来自 `metadata.videoUrl` |
| `local` | 空字符串 |

### 5. metadata.type 扩展性

当前只支持 `"bilibili"` 和 `"local"` 两种类型。后续可能扩展为其他平台（如 `"youtube"`），但本次不实现扩展，只保留类型定义为字符串联合类型，校验只允许这两个值。

### 6. AnalysisInput 定义（权威）

`AnalysisEngine` 的 `AnalysisInput` 与 `AnalysisRequest` 结构一致，新增 `summaryDir`：

```ts
export interface AnalysisInput {
  /** LLM 分析用视频路径（低分辨率或唯一可用分辨率） */
  videoPath: string;
  /** 字幕文件路径，可选（无字幕时不传） */
  subtitlePath?: string;
  /** summary 输出目录 */
  summaryDir: string;
  /** 视频标题 */
  videoTitle: string;
  /** 视频元数据 */
  metadata: {
    type: "bilibili" | "local";
    videoUrl?: string;
    bvid?: string;
    cid?: number;
  };
  /** 截图用视频路径（高分辨率）。不传时走 ScreenshotSourceResolver 降级逻辑 */
  screenshotVideoPath?: string;
}
```

`AnalysisEngine` 生成文档时，front matter 的 `video_url` 按以下逻辑取值：

- `metadata.type === "bilibili"` → `metadata.videoUrl`
- `metadata.type === "local"` → `""`

截图源选择逻辑：

- `screenshotVideoPath` 有值 → 直接使用该路径截图，跳过 ScreenshotSourceResolver
- `screenshotVideoPath` 无值 → 走 ScreenshotSourceResolver 降级逻辑（见 `2026-07-07-screenshot-source-fallback.md`）

无字幕分析逻辑：

- `subtitlePath` 无值或文件不存在 → 跳过字幕解析，仅传入视频给 LLM

## Out of Scope

- 不改变分析编排主流程（字幕解析 → LLM 调用 → 截图 → 生成文档）
- 不改变 Python 薄代理
- 不改变截图逻辑
- 不实现 `metadata.type` 的平台扩展
- 不涉及前端交互
- 不涉及下载完成后自动触发的集成（后续单独需求）

## Affected Files

| 文件 | 改动 |
|---|---|
| `packages/server/src/analysis/analysis.controller.ts` | 替换调试接口为正式接口，入参改为 `AnalysisRequest`，移除写死的 test_assets 逻辑 |
| `packages/server/src/analysis/analysis-engine.ts` | `AnalysisInput` 调整为包含 `metadata`，front matter `video_url` 取值逻辑跟随 `metadata.type` |

## Acceptance Criteria

1. `POST /api/analysis/run` 接收 `AnalysisRequest` 入参，包含 `videoPath`、`subtitlePath?`、`videoTitle`、`metadata`、`screenshotVideoPath?`
2. `POST /api/analysis/debug` 不再存在
3. `metadata.type=bilibili` 时 `metadata.videoUrl`、`metadata.bvid`、`metadata.cid` 必填且非空，否则返回 400
4. `metadata.type=local` 时 `metadata.videoUrl`、`metadata.bvid`、`metadata.cid` 可不传
5. `metadata.type=bilibili` 时，生成的文档 front matter `video_url` 有值
6. `metadata.type=local` 时，生成的文档 front matter `video_url` 为空字符串
7. `videoPath` 必须为绝对路径，否则返回 400
8. `subtitlePath` 可选；如传入必须为绝对路径
9. `screenshotVideoPath` 可选；如传入必须为绝对路径
10. `subtitlePath` 未传入时，分析跳过字幕解析，仅传入视频给 LLM
11. `pnpm typecheck` 和 `pnpm build` 通过
