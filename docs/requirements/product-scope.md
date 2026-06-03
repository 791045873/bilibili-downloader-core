# Product Scope

## Product Summary

Bilibili Downloader Core 是一个易扩展、支持多种运行形态的 Bilibili 视频下载引擎。

## Users

- NAS 用户（Docker 部署，远程管理下载）
- 命令行用户（终端直接下载）
- 普通 Web 用户（浏览器操作）

## MVP Scope

参见 `docs/requirements/mvp.md`。MVP 已完成。

## Deferred Scope

| 功能 | 优先级 | 状态 |
|------|--------|------|
| UI 界面优化 | P0 | 已废弃，需重写需求（涉及交互调整和后端接口修改） |
| 批量添加待下载视频（延迟解析） | P1 | 待编写需求 |
| 下载目录指定与查看 | P1 | 待编写需求 |
| 浏览器插件（Agent 功能） | P2 | 待编写需求 |
| 任务队列优化（不跳转、参数校验） | P2 | 待编写需求 |
| 登录态与 Cookie 管理 | 远期 | 未规划 |
| 字幕/弹幕/封面等附属资源 | 远期 | 未规划 |
| 番剧/合集批量下载 | 远期 | 未规划 |
| aria2 下载器支持 | 远期 | 未规划 |

## Success Metrics

- 用户可通过 CLI / Web / Docker 任一方式稳定下载 B站视频
- 引擎 Core 可独立复用于不同运行形态
- Docker 镜像可在 NAS 上正常运行

## Constraints

- Core 不依赖任何 UI 框架或运行时
- TypeScript 严格模式
- monorepo 依赖方向：Runtimes → Adapters → Core