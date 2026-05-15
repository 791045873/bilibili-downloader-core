# @bilibili-downloader/core

Bilibili 下载引擎核心域层。定义领域模型、端口接口、用例编排，不依赖任何具体实现。

## 模块

| 目录 | 说明 |
|---|---|
| `domain/` | 领域模型: `DownloadRequest`, `DownloadPlan`, `DownloadResult`, `TaskStatus` |
| `ports/` | 可替换接口: `ResourceParserPort`, `StreamProviderPort`, `MediaDownloaderPort`, `MediaMergerPort`, `FileStorePort`, `AuthProviderPort`, `FavoritesProviderPort` |
| `events/` | 领域事件: 8 种下载事件类型 (TaskStarted → TaskCompleted/Failed) |
| `usecases/` | 用例编排: `DownloadSingleVideoUseCase`, `DownloadFavoritesUseCase` |

## 设计原则

- 引擎核心独立于运行形态 (CLI / Skill / Docker)
- 下载链路可替换、可测试、可观测
- 通过 `EventEmitter` 对外广播进度事件

## 导入

```ts
import { DownloadSingleVideoUseCase } from "@bilibili-downloader/core/usecases";
import type { ResourceParserPort } from "@bilibili-downloader/core/ports";
import { TaskStatus, DownloadErrorCode } from "@bilibili-downloader/core/domain";
```

## 使用示例

### 单视频下载

```ts
import { DownloadSingleVideoUseCase } from "@bilibili-downloader/core/usecases";
import { DownloadEventType } from "@bilibili-downloader/core/events";
import { TaskStatus } from "@bilibili-downloader/core/domain";

// 注入适配器实现 (需要 @bilibili-downloader/adapters)
const useCase = new DownloadSingleVideoUseCase({
  resourceParser,   // ResourceParserPort  实现
  streamProvider,   // StreamProviderPort  实现
  mediaDownloader,  // MediaDownloaderPort 实现
  mediaMerger,      // MediaMergerPort     实现
  fileStore,        // FileStorePort       实现
  authProvider,     // AuthProviderPort    实现 (可选)
});

// 订阅事件
useCase.on(DownloadEventType.TaskStarted, (e) => {
  console.log("开始下载:", e.request.input);
});
useCase.on(DownloadEventType.DownloadProgress, (e) => {
  console.log(`进度: ${e.percentage}%`);
});
useCase.on(DownloadEventType.TaskCompleted, (e) => {
  console.log("完成:", e.result.outputFile);
});
useCase.on(DownloadEventType.TaskFailed, (e) => {
  console.error("失败:", e.result.errorMessage);
});

// 执行下载
const result = await useCase.execute({
  input: "BV11z536jELv",
  outputDir: "./downloads",
  quality: 80,           // 1080P
  videoCodec: "avc",     // 可选
  cookieFile: "./cookies.json", // 可选
});

if (result.status === TaskStatus.Completed) {
  console.log(`文件: ${result.outputFile}`);
  console.log(`耗时: ${result.timing?.totalMs}ms`);
}
```

### 合集/收藏夹下载

```ts
import { DownloadFavoritesUseCase } from "@bilibili-downloader/core/usecases";

const batchUseCase = new DownloadFavoritesUseCase({
  ...commonDeps,
  favoritesProvider,  // FavoritesProviderPort 实现
});

// 内部自动分页获取全部视频，依次下载
await batchUseCase.execute(
  1329019876,           // 收藏夹 media_id
  { outputDir: "./downloads", quality: 80 },
  cookieString,         // 可选 Cookie (用于私密收藏夹)
);
```

### 事件类型

`DownloadEventType` 提供 8 种事件，按执行阶段触发：

```
TaskStarted → TaskResolved → StreamSelected → DownloadProgress → MergeProgress → TaskCompleted
                                                                                    ↘ TaskFailed
                                                                                    ↘ TaskCancelled
```

### 任务状态机

```
Created → Resolving → Downloading → Merging → Completed / Failed / Cancelled
```

### 扩展新适配器

只需实现对应的 Port 接口即可接入：

```ts
import type { MediaDownloaderPort, DownloadParams } from "@bilibili-downloader/core/ports";

class Aria2Downloader implements MediaDownloaderPort {
  async download(params: DownloadParams): Promise<string> {
    // 接入 aria2 JSON-RPC...
  }
  abort(): void {
    // 取消下载...
  }
}
```