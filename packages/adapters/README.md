# @bilibili-downloader/adapters

基础设施适配层。实现 `@bilibili-downloader/core` 定义的端口接口。

## 模块

| 目录 | 说明 | 对应 Port |
|---|---|---|
| `bilibili/` | B站 API 适配器 | `ResourceParserPort`, `StreamProviderPort`, `FavoritesProviderPort` |
| `bilibili-auth/` | 二维码登录 + Cookie 管理 | `AuthProviderPort` |
| `downloader/` | HTTP 文件下载器 | `MediaDownloaderPort` |
| `ffmpeg/` | 音视频合并 | `MediaMergerPort` |
| `fs/` | 文件系统操作 | `FileStorePort` |

## 关键导出

```ts
// B站 API
import {
  createBilibiliApiAdapter,
  BilibiliStreamProvider,
  BilibiliResourceParser,
  BilibiliFavoritesProvider,
  createBilibiliWebClient,
} from "@bilibili-downloader/adapters/bilibili";

// 登录
import {
  BilibiliAuthProvider,
  CookieStore,
} from "@bilibili-downloader/adapters/bilibili-auth";

// 下载器
import { HttpDownloader } from "@bilibili-downloader/adapters/downloader";

// ffmpeg
import { FfmpegMerger } from "@bilibili-downloader/adapters/ffmpeg";

// 文件系统
import { NodeFileStore } from "@bilibili-downloader/adapters/fs";
```

## 参考

基于 `yaobiao131/downkyicore` 的 `DownKyi.Core/` 模块重新设计，去除了所有 UI 依赖。