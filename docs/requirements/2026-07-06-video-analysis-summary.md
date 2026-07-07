# 视频内容分析总结功能 — 需求文档

## Goal

对已下载的 Bilibili 视频，基于 SRT 字幕和视频画面，自动生成图文并茂的 Markdown 总结文档。

## Background

项目已有能力：
- 视频下载（CLI / Web / Docker）
- SRT 字幕下载（按语言选择的完整链路已打通）
- ffmpeg 已作为项目依赖存在（目前用于音视频合并）
- HTTP 客户端可用于调用 LLM API

需要新增的能力：
- LLM API 集成（千问 3.6 Flash，多模态）
- 字幕分析 → 关键段落提取
- 视频截图（ffmpeg）
- 截图 + 文本的多模态最佳帧选择
- Markdown 文档组装

## In Scope

### 工作流

```
下载完成（视频.mp4 + 字幕.srt 已存在）
  ↓
Step 1: 读取 SRT 字幕原文
  ↓
Step 2: LLM 调用 #1（纯文本）
        输入: 完整字幕原文
        输出: {
          整体总结,
          关键段落列表: [
            { 段落主题, 字幕原文片段, 开始时间, 结束时间 },
            ...
          ]
        }
  ↓
Step 3: ffmpeg 截图
        对每个关键段落:
          时间窗 = [开始时间 - 3s, 结束时间 + 3s]
          从窗口起始第 0 秒开始，每秒截图 1 张（JPEG）
          截图数量 = 窗口总秒数 + 1
  ↓
Step 4: LLM 调用 #2（多模态: 文本+图片）
        输入: 该段落所有截图 + { 段落主题, 字幕原文片段 }
        输出: 选出的匹配截图列表（LLM 自定数量）
        循环执行，直到所有段落处理完毕
  ↓
Step 5: 生成 Markdown 文档
        图文混排，图片引用路径
        保存到 summary 目录
```

### 数据模型

#### LLM #1 输出（字幕分析）

```typescript
interface SubtitleAnalysis {
  summary: string;                            // 整体总结
  segments: Array<{
    topic: string;                            // 段落主题
    subtitleText: string;                     // 对应的字幕原文片段
    startTime: number;                        // 起始时间（秒）
    endTime: number;                          // 结束时间（秒）
  }>;
}
```

- `segments` 数量不限，由 LLM 根据视频内容自行决定
- 如果 LLM 认为视频无重点内容，`segments` 为空数组

#### LLM #2 输出（截图筛选，多模态）

```typescript
interface ScreenshotSelection {
  selectedImages: Array<{
    imageIndex: number;                       // 选中的截图编号（从 0 开始）
    reason: string;                           // 选中理由
  }>;
}
```

- `selectedImages` 数量不限，由 LLM 自行决定
- 每张截图携带选中理由，用于文档中的图片说明（Alt Text）

### 目录结构

```
{outputDir}/
├── downloads/          ← 已有，存放下载的视频和字幕
│   └── {视频标题}/
│       ├── {视频标题}.mp4
│       └── {视频标题}.zh-CN.srt
└── summary/            ← 新增，与分析结果同级
    └── {视频标题}/
        ├── screenshots/
        │   ├── segment-0-frame-0.jpg
        │   ├── segment-0-frame-1.jpg
        │   ├── segment-1-frame-0.jpg
        │   └── ...
        └── {视频标题}-summary.md
```

### LLM 配置

- 模型：千问 3.6 Flash（多模态）
- API 接入：公共 HTTP API（OpenAI 兼容格式）
- API Key 来源：环境变量（`.env` 文件）
- API 端点配置：环境变量（`.env` 文件，如 `QWEN_API_BASE` 和 `QWEN_API_KEY`）
- 多模态图片输入使用腾讯云 COS 临时签名 URL，禁止使用 Base64 图片传输

### 截图配置

- 格式：JPEG
- 工具：ffmpeg（`-ss {时间点} -i {视频} -vframes 1 -q:v 3 {输出路径}`）
- 窗口：`[开始时间 - 3, 结束时间 + 3]`，从 0 开始每秒 1 张

### 文档生成

- 格式：Markdown（`.md`）
- 图片引用：本地文件路径（相对 `summary/{视频标题}/screenshots/`）
- 禁止使用 Base64 内嵌图片，也禁止使用 Base64 作为 LLM 图片传输方式
- 如果 LLM 返回空段落列表（`segments` 为空），生成一个标注"该视频无重点内容可总结"的空文档
- 每张配图使用该截图的选中理由作为图片说明

## Out Of Scope

- 用户交互方式（触发按钮、参数设置等）— 暂不涉及
- API Key 的前端管理界面 — 仅环境变量配置
- LLM 调用失败的重试/降级策略 — 暂不涉及
- 文档的后续处理（分享、下载、删除等）
- 多 P 视频分析 — 每个视频独立分析
- 弹幕分析
- 视频 OCR 或画面元素识别（仅依赖字幕 + 多模态 LLM 判断画面）

## Non-Goals

- 不引入 OpenCV 或其他图像处理库
- 不涉及视频转码或编辑
- 不做视频内容的实时流式分析
- 不生成 PDF 或其他格式（仅 Markdown）

## 实现范围预估

涉及变动：
- 新增 `packages/adapters/src/llm/` — LLM API 适配器（千问 3.6 Flash 调用封装）
- 新增或扩展 `packages/adapters/src/ffmpeg/` — ffmpeg 截图能力
- 新增 `packages/server/src/analysis/` — 分析引擎 service（字幕分析 orchestrator）
- 新增环境变量配置（`QWEN_API_KEY`, `QWEN_API_BASE`）
- 新增 `summary` 目录管理逻辑

不修改：
- `packages/core/` — 下载核心逻辑不动
- `packages/frontend/` — 暂不涉及前端 UI
- 现有的下载链路

## Acceptance Criteria

- [ ] 给定一个包含 `.mp4` 和 `.srt` 的已下载视频，可触发分析流程
- [ ] LLM #1 调用正确解析字幕并返回结构化的关键段落列表
- [ ] 对每个关键段落，ffmpeg 在指定时间窗内截取 JPEG 图片
- [ ] LLM #2（多模态）正确接收图片 + 文本，返回选中的截图
- [ ] 生成 Markdown 文档，包含总结文本和配图
- [ ] 文档中的图片使用本地文件路径引用
- [ ] 空内容视频生成标注性的空文档
- [ ] 截图文件和文档保存在 `summary/{视频标题}/` 目录下
- [ ] `pnpm typecheck` 通过
- [ ] `pnpm build` 通过