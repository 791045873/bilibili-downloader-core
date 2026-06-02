# MVP Scope

## Purpose

Define the smallest credible product scope for `bilibili-downloader-core`.

## Must-Have Features (Completed)

- [x] 单视频下载（支持 BV/AV/URL 输入）
- [x] 资源解析（获取视频详情和播放流信息）
- [x] 音视频流选择（清晰度与编码基础选择）
- [x] 音视频分离下载 + FFmpeg 合并
- [x] 基础重试（网络请求与文件下载）
- [x] 基础进度事件（开始、下载中、合并中、完成、失败）
- [x] 可配置输出目录
- [x] 临时文件清理策略
- [x] CLI 命令行入口
- [x] Web 前端 + 后端 API（任务管理）
- [x] Docker 容器化部署

## Deferred Features

以下能力不在 MVP 范围内：

- 分 P / 合集 / 番剧 / 课程等复杂资源批量下载
- 登录态与 Cookie 管理
- 字幕、弹幕、封面、NFO 等附属资源处理
- 多下载器并存（aria2 插件化接入）
- 限速、复杂并发调度、任务持久化队列

## Manual Operations Allowed In MVP

- FFmpeg 需用户自行安装或在 Docker 镜像中预装
- Docker 部署需用户手动配置 volume 挂载

## Mocked Or Simulated Integrations Allowed In MVP

- 无（B站 API 和 FFmpeg 均为真实集成）

## Exit Criteria For MVP Completion

- [x] 给定一个有效 BV 或视频 URL，CLI 可完成端到端下载与合并
- [x] 输出文件可播放，且文件名与目录符合预期
- [x] 失败场景可返回明确错误类别与阶段信息
- [x] 引擎核心不依赖 CLI 层类型，可被其他运行形态复用
- [x] Web 前端可完成下载任务管理
- [x] Docker 镜像可构建并运行