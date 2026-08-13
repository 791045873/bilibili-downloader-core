# 视频分析总结 — 系统基线

## Purpose

记录视频内容分析总结功能的架构基线。该功能作为 server 侧的新增能力，不修改现有下载链路。

## 新架构概览

```
packages/adapters/src/
├── llm/              ← 新增
│   ├── index.ts
│   └── qwen-client.ts   ← 千问 API 调用封装；多模态可透传到 Python 薄代理
├── cos/              ← 新增
│   ├── index.ts
│   └── tencent-cos-temp-image-store.ts ← COS 临时图片上传与清理（云端 URL 备用路径）
├── ffmpeg/
│   ├── index.ts
│   ├── ffmpeg-merger.ts ← 已有
│   └── ffmpeg-screenshot.ts ← 新增

packages/server/src/
├── analysis/         ← 新增
│   ├── analysis-engine.ts      ← 核心编排：字幕分析 → 截图 → 多模态筛选 → 文档生成
│   ├── analysis.controller.ts  ← 临时调试 API
│   ├── analysis.module.ts      ← NestJS 模块装配
│   ├── analysis-trigger.service.ts ← 下载完成后自动触发分析（原子认领 + 低清等待 + runAnalysis）
│   ├── analysis-video-resolver.ts ← 资产决策层：LLM 分析视频 / 截图源统一裁决（磁盘优先）
│   ├── document-generator.ts   ← Markdown 文档组装
│   └── index.ts

packages/server/python/
├── qwen_vision_proxy.py        ← Python 薄代理：本地文件路径 → DashScope SDK
└── pyproject.toml              ← Python 依赖（锁定版本，安装进 .venv）
```

## 架构原则

1. **分析 vs 下载分离**：分析引擎不依赖下载链路，下载完成后通过 server 层触发
2. **Adapter 关注通用性**：`llm/qwen-client` 封装为通用 OpenAI 兼容格式，不包含分析业务逻辑
3. **Orchestration 在 server 层**：分析编排（先分析字幕 → 再截图 → 再选图 → 生成文档）在 `analysis-engine.ts` 中，不在 adapter 层
4. **Python 层保持极薄**：Python 只作为 DashScope SDK 本地文件路径能力的代理，不理解字幕、段落、选图或文档生成等业务语义
5. **禁止 Base64 图片路径**：多模态输入不得使用 Base64；本地调试优先使用 Python 薄代理读取本地截图，云端部署可回退 COS/公网 URL

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
      | { type: "image_url"; image_url: { url: string } }  // 本地文件路径或云端 URL，禁止 Base64
    >;
  }>;
}

// 配置
interface LlmConfig {
  apiKey: string;          // 从环境变量读取
  baseUrl: string;         // 千问 API 端点
  modelName: string;       // 如 "qwen-3.6-flash"
  visionProxyUrl?: string; // Python 薄代理地址；存在时多模态调用透传给 Python
  visionModelName?: string;// 多模态模型名，可与文本模型拆分
}
```

`chatCompletion()` 继续由 Node.js 直接调用 OpenAI 兼容接口。`multimodalChat()` 在配置 `visionProxyUrl` 时不再要求公网图片 URL，而是将完整 OpenAI-style 多模态请求透传给 Python 薄代理；未配置代理时保留原有公网 URL/COS 路径。

依赖方向：`server → llm/adapter`（无反向依赖）

### Python 视觉薄代理 (`packages/server/python/`)

Python 层是系统架构中的本地文件传输适配层，目的仅是复用 DashScope Python SDK 对本地文件路径的支持，避免在本地调试和个人使用场景中为截图上传 COS/OSS。

边界规则：

- Python 不做字幕解析、截图时间窗口计算、prompt 生成、业务字段解释或 Markdown 生成。
- Node.js 编排层仍然决定 `model`、`messages`、system prompt、user content、JSON 输出约束和响应解析。
- Python 代理接收 OpenAI-style `MultimodalRequest`，将其中 `image_url.url` 的本地路径转换为 DashScope SDK 支持的 `file://...` 输入，调用 `MultiModalConversation.call()` 后返回 OpenAI-style `choices[0].message.content`。
- Python 代理只允许非 Base64 图片输入；发现 `data:` 或 `;base64,` 应拒绝。
- 该代理要求与 Node server 运行在同一台机器或共享同一文件系统，否则 Python 无法读取 Node 生成的本地截图。
- 健壮性不变量（2026-08-12 起）：`/v1/chat/completions` 的 POST 行为与返回体保持稳定；请求 body 有大小上限（413）、socket 有读写超时、并发有上限（503）、单次异常只影响当次请求不拖垮服务；`GET /healthz` 提供探活；宿主 `start-vision-proxy` 自动重启自愈。Docker 单容器通过入口脚本启动同容器代理并在退出时清理子进程；容器重启策略由部署平台负责。Node 侧代理路径对瞬时网络错误与代理 5xx 自动重试 1 次（固定 2s 间隔；超时与 4xx 不重试，2026-08-13 起）。

运行形态：

```text
Node AnalysisEngine
  ├─ 构造字幕分析请求 → QwenClient.chatCompletion() → OpenAI-compatible HTTP
  ├─ ffmpeg 生成本地截图
  ├─ 构造多模态选图请求 → QwenClient.multimodalChat()
  │    ├─ 有 QWEN_VISION_PROXY_URL: POST 给 Python 薄代理，本地路径由 DashScope SDK 上传/读取
  │    └─ 无 QWEN_VISION_PROXY_URL: 使用 COS/公网 URL 路径
  └─ 解析选图结果并生成 Markdown
```

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
server/src/analysis/ ‐‐‐→ adapters/src/parser/ (SRT 解析)
server/src/analysis/ ‐‐‐→ server/python/        (可选：多模态本地文件代理)
server/src/analysis/ ‐‐‐→ core (SubtitleInfo 等类型，如需要)
server/src/analysis/analysis-video-resolver.ts
  ‐‐‐→ download.service (fileExists / resolveBestVideoStream / createTask / executeTask)
  ‐‐‐→ download-scheduler (低清下载调度)
  ‐‐‐→ database.service (子任务资源级查询)

adapters/src/llm/     ‐‐‐→ 外部 HTTP API (千问文本 / 备用多模态)
adapters/src/llm/     ‐‐‐→ Python 薄代理 HTTP API (可选多模态)
adapters/src/ffmpeg/  ‐‐‐→ 系统 ffmpeg / ffprobe 二进制
server/python/        ‐‐‐→ DashScope Python SDK
```

## 2026-08-11 基线更新

- `analysis-trigger.service.ts` 引入**原子认领**（`ai_summary_task` 条件 upsert）防并发双跑；全部前置决策与 analyze 在 `runAnalysis()` 的 try/catch 内，异常统一落 `failed` 并通知。
- 新增 `analysis-video-resolver.ts` 资产决策层：`resolveAnalysisVideo`（LLM 分析视频：低清子任务文件 → 高清任务文件，磁盘优先，均缺失时重置子任务并调度低清重下）与 `resolve`（截图源：远端流 → 已完成本地下载 → 同步重下，全程磁盘校验）。原 `screenshot-source-resolver.ts` 并入该模块。
- AI 总结状态以 `ai_summary_task` 为**单一权威来源**（`task.summary_status/summary_output` 不再双写，读取由 `taskSelectSql` 直接 JOIN `ai_summary_task`）；`analysis_sub_task` 改为资源级键 `(bvid, cid, quality)`（部分唯一索引，`task_id` 仅溯源）；summary 输出目录按 `{标题}-{bvid}-{cid}/` 命名（标题完整不截断、非法字符清洗；同资源已存在目录则复用，标题变化不产生孤儿目录，bvid-cid 为稳定锚点）。
- 启动时执行状态对账：遗留 `created` 子任务与 `pending/analyzing` 总结标 `failed`，避免重启后永久等待。

## 环境变量

新增：

```
# .env
QWEN_API_KEY=sk-your-key-here
QWEN_API_BASE=https://dashscope.aliyuncs.com/compatible-mode/v1
QWEN_MODEL=qwen-3.6-flash

# 可选：本地多模态 Python 薄代理。配置后，多模态选图使用本地截图路径，不上传 COS/OSS。
QWEN_VISION_PROXY_URL=http://127.0.0.1:8765/v1/chat/completions
QWEN_VISION_MODEL=qwen3.7-plus
DASHSCOPE_API_KEY=sk-your-key-here
DASHSCOPE_BASE_HTTP_API_URL=
QWEN_VISION_PROXY_HOST=127.0.0.1
QWEN_VISION_PROXY_PORT=8765

# 可选：Python 薄代理健壮性参数（均有默认值，可不配置）。
# QWEN_VISION_PROXY_MAX_BODY_BYTES：代理 HTTP body 上限（默认 16777216=16MB），超出返回 413；视频文件由 SDK 本机读取，不经过 body。
# QWEN_VISION_PROXY_MAX_CONCURRENCY：并发请求上限（默认 8），超出返回 503。
# QWEN_VISION_PROXY_SOCKET_TIMEOUT：连接 socket 读/写超时秒数（默认 120）。
# QWEN_VISION_PROXY_TIMEOUT_MS：Node 侧多模态代理调用超时毫秒数（默认 600000=10 分钟），客户端内部兜底。
# VISION_PROXY_NO_RESTART：置 1 时禁用 start-vision-proxy 自动重启（运维/脚本逃生门）。
# 探活：GET http://127.0.0.1:8765/healthz 返回 200 {"status":"ok"}。

# 可选：生产环境文件日志。设置 LOG_DIR 后，Node 服务与 Python 薄代理除终端外同时写文件日志。
# LOG_DIR：日志目录（Node 写 server-YYYY-MM-DD.log；Python 写 vision-proxy.log，按天轮转出 vision-proxy.log.YYYY-MM-DD）。
# LOG_MAX_FILES：保留最近 N 天（默认 7）。未设置 LOG_DIR 时行为不变（仅终端）。

# 可选：未启用 Python 薄代理时的云端 URL 备用路径。
TENCENT_COS_SECRET_ID=AKID...
TENCENT_COS_SECRET_KEY=...
TENCENT_COS_BUCKET=examplebucket-1250000000
TENCENT_COS_REGION=ap-guangzhou
TENCENT_COS_TEMP_PREFIX=bilibili-downloader-temp/analysis
TENCENT_COS_SIGNED_URL_EXPIRES_SECONDS=3600
```

- 读取位置：`packages/server/src/` 的配置模块（NestJS ConfigModule 或 process.env）
- `QWEN_API_KEY`, `QWEN_API_BASE`, `QWEN_MODEL` 用于文本分析调用
- `QWEN_VISION_PROXY_URL`, `QWEN_VISION_MODEL` 透传到 `LlmConfig`，控制多模态调用是否走 Python 薄代理
- `QWEN_VISION_PROXY_TIMEOUT_MS` 透传到 `LlmConfig.visionProxyTimeoutMs`（默认值由客户端内部兜底，覆盖 AI 总结与手动分析两个调用面）
- `DASHSCOPE_*`, `QWEN_VISION_PROXY_HOST`, `QWEN_VISION_PROXY_PORT`, `QWEN_VISION_PROXY_MAX_BODY_BYTES`, `QWEN_VISION_PROXY_MAX_CONCURRENCY`, `QWEN_VISION_PROXY_SOCKET_TIMEOUT` 由 Python 薄代理读取
- `TENCENT_COS_*` 是未启用 Python 薄代理时的备用路径；截图上传后以签名 URL 提供给多模态模型，模型调用结束后删除临时对象

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
