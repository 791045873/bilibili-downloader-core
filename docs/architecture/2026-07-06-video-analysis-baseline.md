# 视频分析总结 — 系统基线

## Purpose

记录视频内容分析总结功能的架构基线。该功能作为 server 侧的新增能力，不修改现有下载链路。

## 新架构概览

```
packages/adapters/src/
├── llm/              ← 新增
│   ├── index.ts
│   └── qwen-client.ts   ← 千问 API 调用封装
├── cos/              ← 新增
│   ├── index.ts
│   └── tencent-cos-temp-image-store.ts ← COS 临时图片上传与清理
├── ffmpeg/
│   ├── index.ts
│   ├── ffmpeg-merger.ts ← 已有
│   └── ffmpeg-screenshot.ts ← 新增

packages/server/src/
├── analysis/         ← 新增
│   ├── analysis-engine.ts      ← 核心编排：字幕分析 → 截图 → 多模态筛选 → 文档生成
│   ├── subtitle-srt-parser.ts  ← SRT 文件解析
│   ├── document-generator.ts   ← Markdown 文档组装
│   └── index.ts
```

## 架构原则

1. **分析 vs 下载分离**：分析引擎不依赖下载链路，下载完成后通过 server 层触发
2. **Adapter 关注通用性**：`llm/qwen-client` 封装为通用 OpenAI 兼容格式，不包含分析业务逻辑
3. **Orchestration 在 server 层**：分析编排（先分析字幕 → 再截图 → 再选图 → 生成文档）在 `analysis-engine.ts` 中，不在 adapter 层

## 模块边界

### LLM 适配器 (`packages/adapters/src/llm/`)

通用 LLM API 调用封装，不包含分析业务逻辑。

```typescript
// 纯文本请求
interface ChatCompletionRequest {
  model: string;
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  response_format?: { type: "json_object" };  // 强制 JSON 输出
}

// 多模态请求（文本 + 图片）
interface MultimodalRequest {
  model: string;
  messages: Array<{
    role: "system" | "user";
    content: Array<
      | { type: "text"; text: string }
      | { type: "image_url"; image_url: { url: string } }  // COS 临时签名 URL
    >;
  }>;
}

// 配置
interface LlmConfig {
  apiKey: string;          // 从环境变量读取
  baseUrl: string;         // 千问 API 端点
  modelName: string;       // 如 "qwen-3.6-flash"
}
```

依赖方向：`server → llm/adapter`（无反向依赖）

### ffmpeg 截图 (`packages/adapters/src/ffmpeg/`)

在已有 `FfmpegMerger` 旁边新增截图能力。

```typescript
interface ScreenshotParams {
  videoPath: string;          // 视频文件路径
  timePoints: number[];       // 截图时间点列表（秒）
  outputDir: string;          // 截图输出目录
  filenamePrefix?: string;    // 文件名前缀
}

interface ScreenshotResult {
  outputFiles: string[];      // 生成的文件路径列表
}
```

### 分析引擎 (`packages/server/src/analysis/`)

核心编排逻辑，不暴露给 adapter 层外部。

```typescript
interface AnalysisInput {
  videoPath: string;          // 视频文件路径
  subtitlePath: string;       // SRT 字幕文件路径
  summaryDir: string;         // summary/{title}/ 输出目录
}

interface AnalysisOutput {
  summaryPath: string;        // 生成的 Markdown 文件路径
  screenshotFiles: string[];  // 所有截图文件路径
  segmentCount: number;       // 分析的段落数
  emptySummary: boolean;      // 是否为空内容文档
}
```

### 字幕解析器 (`packages/server/src/analysis/`)

SRT 文件解析为结构化数据，供 LLM 分析。

```typescript
interface SrtEntry {
  index: number;              // 字幕序号
  startTime: number;          // 开始时间（秒）
  endTime: number;            // 结束时间（秒）
  text: string;               // 字幕文本
}

function parseSrt(filePath: string): SrtEntry[];
```

### 文档生成器 (`packages/server/src/analysis/`)

将分析结果组装为 Markdown。

```typescript
interface DocumentInput {
  summary: string;                    // 整体总结文本
  segments: Array<{
    topic: string;
    subtitleText: string;
    selectedImages: Array<{
      relativePath: string;           // 相对于 summary 目录的路径
      reason: string;                 // 选中理由 → 图片说明
    }>;
  }>;
  emptySummary: boolean;              // 是否为无内容文档
}

function generateMarkdown(input: DocumentInput): string;
```

## 依赖方向

```
server/src/analysis/ ‐‐‐→ adapters/src/llm/    (LLM 调用)
server/src/analysis/ ‐‐‐→ adapters/src/ffmpeg/ (截图)
server/src/analysis/ ‐‐‐→ core (SubtitleInfo 等类型，如需要)

adapters/src/llm/     ‐‐‐→ 外部 HTTP API (千问)
adapters/src/ffmpeg/  ‐‐‐→ 系统 ffmpeg 二进制
```

## 环境变量

新增：

```
# .env
QWEN_API_KEY=sk-your-key-here
QWEN_API_BASE=https://dashscope.aliyuncs.com/compatible-mode/v1
QWEN_MODEL=qwen-3.6-flash

TENCENT_COS_SECRET_ID=AKID...
TENCENT_COS_SECRET_KEY=...
TENCENT_COS_BUCKET=examplebucket-1250000000
TENCENT_COS_REGION=ap-guangzhou
TENCENT_COS_TEMP_PREFIX=bilibili-downloader-temp/analysis
TENCENT_COS_SIGNED_URL_EXPIRES_SECONDS=3600
```

- 读取位置：`packages/server/src/` 的配置模块（NestJS ConfigModule 或 process.env）
- `QWEN_*` 透传到 `LlmConfig`
- `TENCENT_COS_*` 用于构造 COS 临时图片存储；截图上传后以签名 URL 提供给多模态模型，模型调用结束后删除临时对象

## 已有能力复用

| 已有组件 | 复用方式 |
|----------|----------|
| `packages/server/src/download/download.service.ts` 的 `outputDir` | 分析引擎从 `outputDir` 推导视频和字幕路径 |
| `FfmpegMerger` 中的 ffmpeg path 检测 | 截图模块复用 `isAvailable()` 检测逻辑 |
| 字幕文件命名约定 `{title}.{langKey}.srt` | 分析引擎按约定定位字幕文件 |
| HTTP 客户端 | 千问 API 调用可直接使用 `fetch`（无需额外依赖） |

## 不修改的部分

- `packages/core/` — 不新增端口或用例
- `packages/frontend/` — 暂不涉及 UI
- `packages/cli/` — 暂不涉及 CLI 参数
- 现有 `download.service.ts` 的下载逻辑 — 不动
- 现有 `database.service.ts` — 不动