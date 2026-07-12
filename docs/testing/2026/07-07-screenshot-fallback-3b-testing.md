# Screenshot Source Fallback (3b) — Testing Directions

> 对应 plan: `docs/plans/2026-07-07-screenshot-fallback-3b-plan.md`
> 对应需求: `docs/requirements/2026-07-07-screenshot-source-fallback-3b.md`
> 类型: 需求级测试方向（非单元测试、非脚本）

## 测试目的

验证 `ScreenshotSourceResolver` 截图源降级策略：local 类型直接返回本地路径；bilibili 类型按远端流 URL -> 数据库已有下载 -> 同步重新下载三级降级；`screenshotVideoPath` 有值时跳过 resolver；远端截图失败后剩余时间点全部走本地；AnalysisEngine 依赖 resolver 接口而非直接依赖 DatabaseService/DownloadService。

## 环境前置

- Server 运行于 `localhost:3000`
- `COOKIE_FILE` 环境变量指向有效 B 站 cookie 文件（bilibili 类型测试需要）
- 数据库中至少有一条 `BV1SoTx6yEYc` 的成功下载任务（quality >= 80），用于 DB fallback 测试
- 测试视频: `BV1SoTx6yEYc`
- Python vision proxy 运行中（如需 LLM 分析）；resolver-only 测试不需要 LLM
- 3a plan 已完成（FfmpegScreenshot 支持 HTTP URL + headers）

## 测试方向

### 1. local 类型直接使用本地路径

**应成立:**
- `metadata.type=local` 请求发出后，截图从本地 `videoPath` 生成，不尝试远端流。
- 响应包含 `summaryPath`，`screenshots/` 目录下有截图文件。

**不应成立:**
- local 类型触发远端流解析或 B 站 API 调用。
- local 类型因 resolver 逻辑导致截图失败。

**验证命令:**
```bash
curl -X POST http://localhost:3000/api/analysis/run \
  -H "Content-Type: application/json" \
  -d '{"videoPath":"<local path>","subtitlePath":"<local srt>","videoTitle":"test-local","summaryDir":"./test-summary","metadata":{"type":"local"}}'
```

### 2. bilibili 类型优先尝试远端高分辨率流 URL

**应成立:**
- `metadata.type=bilibili` 且提供 `bvid`/`cid`/`videoUrl` 时，resolver 尝试获取远端高分辨率流 URL 并用于截图。
- 服务器日志显示 ffmpeg 使用 HTTP URL 输入（非本地文件路径）。
- 截图文件生成成功（远端流可用时）。

**不应成立:**
- bilibili 类型直接使用低分辨率 `videoPath` 截图而不尝试远端。
- 远端流 URL 未携带 `Referer: https://www.bilibili.com` header。

**验证命令:**
```bash
curl -X POST http://localhost:3000/api/analysis/run \
  -H "Content-Type: application/json" \
  -d '{"videoPath":"<local low-res path>","videoTitle":"test-remote","summaryDir":"./test-summary","metadata":{"type":"bilibili","videoUrl":"https://www.bilibili.com/video/BV1SoTx6yEYc","bvid":"BV1SoTx6yEYc","cid":<cid>}}'
```

### 3. 远端失败后查数据库已有下载（quality >= 80）

**应成立:**
- 远端截图失败时，resolver 按 `bvid`+`cid` 查数据库中 `status=success` 的下载任务。
- 找到且 `quality >= 80`（1080P）时，使用该任务的 `outputFile` 作为截图源。
- 服务器日志显示 fallback 到本地已下载文件。

**不应成立:**
- 数据库有 quality >= 80 的成功任务但 resolver 未使用。
- resolver 使用 quality < 80 的任务文件而不触发重新下载。

### 4. 数据库无合适任务时同步重新下载

**应成立:**
- 远端失败且数据库无 `quality >= 80` 的成功任务时，resolver 同步触发重新下载。
- 重新下载的视频文件出现在 `downloads/` 目录。
- 下载完成后使用新下载的文件截图。
- 重新下载的任务写入数据库 `task` 表。

**不应成立:**
- 重新下载通过 DownloadScheduler 调度（应直接调用 executeTask，bypass scheduler）。
- 重新下载超过 10 分钟未返回错误。
- 重新下载的视频文件被删除。

### 5. screenshotVideoPath 有值时跳过 resolver

**应成立:**
- 请求包含 `screenshotVideoPath` 时，截图直接使用该路径，不调用 resolver。
- 截图文件来自 `screenshotVideoPath` 指定的文件（可通过文件时间戳或日志确认）。

**不应成立:**
- `screenshotVideoPath` 有值时仍调用 resolver。
- 截图来自 `videoPath` 而非 `screenshotVideoPath`。

**验证命令:**
```bash
curl -X POST http://localhost:3000/api/analysis/run \
  -H "Content-Type: application/json" \
  -d '{"videoPath":"<path A>","screenshotVideoPath":"<path B>","videoTitle":"test-bypass","summaryDir":"./test-summary","metadata":{"type":"local"}}'
```

### 6. 远端截图失败后剩余时间点全部走本地

**应成立:**
- 远端截图在某一个时间点失败后，剩余所有时间点直接使用本地源截图，不再逐个尝试远端。
- 服务器日志显示 fallback 消息。

**不应成立:**
- 远端失败后仍对后续时间点逐个尝试远端截图。
- 远端失败导致整体分析中断。

### 7. 单个 segment 截图失败不中断分析

**应成立:**
- 某个 segment 的截图失败时，该 segment 跳过截图，分析流程继续。
- 响应仍包含其他 segment 的截图和 summary。

**不应成立:**
- 单个 segment 截图失败导致整个分析抛异常或返回空结果。

### 8. AnalysisEngine 依赖 resolver 接口

**应成立:**
- `AnalysisEngine` 构造函数接受 `ScreenshotSourceResolver` 接口类型，不直接依赖 `DatabaseService` 或 `DownloadService`。
- NestJS DI 装配成功：server 启动无 DI 错误，`POST /api/analysis/run` 返回非 500 状态码。

**不应成立:**
- `AnalysisEngine` 直接 import 或构造 `DatabaseService`/`DownloadService`。
- Server 启动时出现 DI 解析错误（HTTP 500）。

**验证命令:**
```bash
curl -X POST http://localhost:3000/api/analysis/run \
  -H "Content-Type: application/json" \
  -d '{"videoPath":"","videoTitle":"test-di","metadata":{"type":"local"}}'
```
预期：返回 400（校验失败：videoPath 非绝对路径），非 500（DI 装配正常）。

### 9. DatabaseService 新查询方法返回 quality 和 outputFile

**应成立:**
- 新增的 `findCompletedTaskByBvidAndCid(bvid, cid)` 方法返回完整 `TaskRecord`，包含 `quality` 和 `outputFile` 字段。
- 仅返回 `status=success` 的任务。

**不应成立:**
- 方法仅返回 `{bvid, cid, status, createdAt}`（与现有 `findTasksByBvidsAndCids` 相同的不完整字段）。

### 10. DownloadModule 导出 DownloadService

**应成立:**
- `DownloadModule` 的 `exports` 包含 `DownloadService`。
- `AnalysisModule` 导入 `DownloadModule` 后，`DownloadService` 可注入到 `ScreenshotSourceResolver`。

**不应成立:**
- `AnalysisModule` 无法注入 `DownloadService`（NestJS DI 报错）。

## 范围外（由其他 plan 覆盖）

- FfmpegScreenshot HTTP URL + headers 支持 —— 由 `2026-07-07-screenshot-remote-3a` plan 覆盖。
- 异步分析任务状态机 —— 由 `2026-07-07-ai-summary-trigger-5b` plan 覆盖。
- 前端轮询或进度展示 —— 不在本 plan scope。
- `metadata.type` 平台扩展 —— 不在本 plan scope。

## 验证命令

- `pnpm typecheck` —— 零错误
- `pnpm build` —— 零错误
- DI 装配验证：server 启动 + `POST /api/analysis/run` 返回非 500
- local 类型截图验证：curl + 确认 `screenshots/` 目录有文件
- screenshotVideoPath bypass 验证：curl + 确认截图来自指定文件
- bilibili 远端验证：curl + 服务器日志确认 ffmpeg HTTP URL 输入
- DB fallback 验证：curl + 服务器日志确认 fallback 消息
- re-download 验证：curl + `downloads/` 目录确认新文件
