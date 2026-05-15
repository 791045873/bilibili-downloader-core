# @bilibili-downloader/adapters

基础设施适配层。实现 `@bilibili-downloader/core` 定义的端口接口。

## 模块

| 目录 | 说明 | 对应 Port |
|---|---|---|
| `bilibili/` | B站 API 适配器 + 字幕 | `ResourceParserPort`, `StreamProviderPort`, `FavoritesProviderPort`, `SubtitleProviderPort` |
| `bilibili-auth/` | 二维码登录 + Cookie 管理 | `AuthProviderPort` |
| `downloader/` | HTTP + aria2 下载器 | `MediaDownloaderPort` |
| `ffmpeg/` | 音视频合并 | `MediaMergerPort` |
| `fs/` | 文件系统操作 | `FileStorePort` |
| 根目录 | 日志 (`logger.ts`) + 任务持久化 (`task-store.ts`) | - |

## 关键导出

```ts
// B站 API
import {
  createBilibiliApiAdapter,
  BilibiliStreamProvider,
  BilibiliResourceParser,
  BilibiliFavoritesProvider,
  BilibiliSubtitleProvider,
  createBilibiliWebClient,
} from "@bilibili-downloader/adapters/bilibili";

// 登录
import {
  BilibiliAuthProvider,
  CookieStore,
} from "@bilibili-downloader/adapters/bilibili-auth";

// 下载器 (HTTP 或 aria2)
import { HttpDownloader } from "@bilibili-downloader/adapters/downloader";
import { Aria2Downloader } from "@bilibili-downloader/adapters/downloader";

// ffmpeg
import { FfmpegMerger } from "@bilibili-downloader/adapters/ffmpeg";

// 文件系统
import { NodeFileStore } from "@bilibili-downloader/adapters/fs";

// 日志
import { Logger, LogLevel } from "@bilibili-downloader/adapters/logger";

// 任务持久化
import { TaskStore } from "@bilibili-downloader/adapters/task-store";
```

### Aria2 下载器

需要先启动 aria2c 守护进程：

```bash
aria2c --enable-rpc --rpc-listen-port=6800
```

```ts
import { Aria2Downloader } from "@bilibili-downloader/adapters/downloader";

const downloader = new Aria2Downloader({
  rpcUrl: "http://127.0.0.1:6800/jsonrpc",
  secret: "my-token",  // 可选
});
```

### 字幕提供器

```ts
import { BilibiliSubtitleProvider } from "@bilibili-downloader/adapters/bilibili";

const subtitleProvider = new BilibiliSubtitleProvider(webClient);
const subtitles = await subtitleProvider.fetchSubtitles("BVxxxxx", cid);
subtitles.forEach(sub => {
  writeFileSync(`${sub.langKey}.srt`, sub.srtContent);
});
```

### 任务持久化

```ts
import { TaskStore } from "@bilibili-downloader/adapters/task-store";

const store = new TaskStore("~/.bilibili-downloader/tasks.json");

// 保存任务
await store.save({
  id: "uuid",
  request: { input: "BVxxx", outputDir: "./dl" },
  status: "completed",
  outputFile: "./dl/video.mp4",
  createdAt: new Date().toISOString(),
  durationMs: 5000,
});

// 查询历史
const recent = await store.findRecent(20);

// 清空
await store.clear();
```

## 参考

基于 `yaobiao131/downkyicore` 的 `DownKyi.Core/` 模块重新设计，去除了所有 UI 依赖。