# 视频分析总结文档结构优化 — 需求文档

## Goal

调整视频分析生成的 Markdown 文档结构，使其从"总结报告"形态转为"带元数据的结构化文档"形态：文档头部包含 front matter，正文只平铺 segment 内容，每个 segment 展示标题、正文、截图和截图说明。

## Background

当前 `document-generator.ts` 生成的文档结构为：

```md
# {videoTitle}

## 内容总结
{summary}

## 重点内容

### {topic}
![](path)
> {reason}
**相关原文：**
> {subtitleText}
```

存在的问题：

- 没有 front matter 元数据，后续系统处理或静态站点渲染时缺少 title / video_url / model / created_at
- 强制拆成"内容总结 / 重点内容"两块，对当前一次调用直接返回 segment 的流程没有价值
- segment 字段名（topic / subtitleText / selectedImages.reason）与 LLM 返回结构（title / content / frameDescription）不一致，存在字段歧义
- 空内容文档会输出 `[该视频无重点内容可总结]`，不符合"正文为空"的预期

## In Scope

### 1. Front Matter

文档头部必须包含 YAML front matter，字段如下：

```yaml
---
title: "视频标题"
video_url: "https://www.bilibili.com/video/BV1z9jq6UEX3"
model: qwen-vl-max-latest
created_at: Wed Jun 24 04:04:00 GMT 2026
---
```

| 字段 | 来源 | 规则 |
|---|---|---|
| `title` | `AnalysisInput.videoTitle` | 必填 |
| `video_url` | `AnalysisInput.videoUrl` | 可选；未传入则为空字符串 |
| `model` | `LlmConfig.visionModelName ?? LlmConfig.modelName` | 由 `AnalysisEngine` 注入 |
| `created_at` | `new Date().toString()` | 本地时间字符串 |

`video_url` 纯粹靠调用方传入，不读环境变量，不设默认值。调试 API 不传 `videoUrl`，front matter 里 `video_url` 为空字符串。

### 2. 正文结构

正文规则：

- 保留 H1，内容为 `videoTitle`
- 不再输出 `## 内容总结` 和 `## 重点内容`
- 直接平铺所有 segment，每个 segment 一个 H2
- 每个 segment 依次展示：H2 标题 → content 正文 → 截图（多张顺序展示）→ 截图说明
- 图片说明紧跟在图片下方，使用 `>` 引用格式

目标文档形态：

```md
---
title: "如何摆脱路人感"
video_url: "https://www.bilibili.com/video/BV1z9jq6UEX3"
model: qwen-vl-max-latest
created_at: Wed Jun 24 04:04:00 GMT 2026
---

# 如何摆脱路人感

## 摆脱路人感的核心是建立风格统一性

想要摆脱路人感，不是单纯堆叠流行单品，而是让颜色、版型和配饰形成统一的风格指向。

![说明文字](screenshots/segment-0-frame-0.jpg)

> 说明文字

## 用配饰强化穿搭记忆点

帽子、包、项链等配饰可以让基础穿搭产生明确记忆点，但需要和整体风格保持一致。

![说明文字](screenshots/segment-1-frame-0.jpg)

> 说明文字
```

### 3. LLM 返回结构扩展

LLM 第一次调用（视频 + 字幕分析）的返回结构新增 `frameDescription` 字段：

```ts
interface SubtitleAnalysis {
  summary: Array<{
    title: string;
    content: string;
    timestamp: string;
    frameDescription: string;  // 新增：该时间戳对应视频帧的文本描述
  }>;
}
```

`buildAnalysisSystemPrompt()` 相应调整，要求模型在给出 `timestamp` 的同时，给出该时间戳对应视频帧的文本描述 `frameDescription`。该描述最终作为图片下方的说明文字写入 Markdown。

### 4. DocumentInput.segments 类型对齐

`DocumentInput.segments` 的类型调整为与 LLM 返回结构一致：

```ts
segments: Array<{
  title: string;
  content: string;
  timestamp: string;
  frameDescription: string;
  images: Array<{ relativePath: string }>;
}>;
```

不再使用 `topic`、`subtitleText`、`selectedImages`、`reason` 等字段名。

### 5. 空内容文档

空内容时：

- front matter 保留，字段正常填充
- H1 保留
- 正文为空，不再输出 `[该视频无重点内容可总结]`

```md
---
title: "如何摆脱路人感"
video_url: ""
model: qwen-vl-max-latest
created_at: Wed Jun 24 04:04:00 GMT 2026
---

# 如何摆脱路人感

```

### 6. AnalysisInput 扩展

`AnalysisInput` 的权威定义在 `2026-07-07-analysis-formal-api.md` 中。本文档不重复定义。

front matter 的 `video_url` 取值来自 `metadata`：

- `metadata.type === "bilibili"` → `metadata.videoUrl`
- `metadata.type === "local"` → `""`

### 7. AnalysisEngine 模型名注入

`AnalysisEngine` 需要访问模型名以写入 front matter。方式：构造函数保留 `llmConfig` 引用，`analyze()` 内使用 `this.llmConfig.visionModelName ?? this.llmConfig.modelName`。

## Out of Scope

- 不改变分析编排主流程（仍然是：字幕解析 → 一次 LLM 调用 → 按时间戳截图 → 生成文档）
- 不改变 Python 薄代理
- 不改变截图逻辑
- 不改变调试 API 的触发方式
- 不涉及前端交互

## Affected Files

| 文件 | 改动 |
|---|---|
| `packages/server/src/analysis/document-generator.ts` | 重写 `DocumentInput` 和 `generateMarkdown()` |
| `packages/server/src/analysis/analysis-engine.ts` | 调整 `SubtitleAnalysis`、`buildAnalysisSystemPrompt()`、`AnalysisInput`、segment 构造逻辑 |
| `packages/server/src/analysis/analysis.controller.ts` | `AnalysisInput` 类型跟随变化；调试 API 不传 `videoUrl` |

## Acceptance Criteria

1. 生成的 Markdown 文档头部包含 `title`、`video_url`、`model`、`created_at` 四个 front matter 字段
2. 正文保留 H1，之后直接平铺 segment，不再有 `## 内容总结` / `## 重点内容`
3. 每个 segment 展示 H2 标题、content 正文、截图、截图说明
4. 截图说明来自 LLM 返回的 `frameDescription`
5. `DocumentInput.segments` 字段名与 LLM 返回结构一致
6. 空内容文档保留 front matter 和 H1，正文为空
7. `video_url` 未传入时为空字符串
8. `pnpm typecheck` 和 `pnpm build` 通过
