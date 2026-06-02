# Project Vision

## Purpose

Describe the long-term product and engineering attractor for `bilibili-downloader-core`.

## Product Goal

构建一个易扩展、支持多种运行形态的 Bilibili 视频下载引擎。用户可通过 CLI、Web 界面、Docker 容器任一方式稳定下载 B站视频。

## Primary Users

- **NAS 用户**：通过 Docker 部署在 NAS 上，挂载下载目录，远程管理下载任务
- **命令行用户**：在终端直接使用 CLI 下载单个视频，适合脚本和自动化场景
- **普通 Web 用户**：通过浏览器访问 Web 界面，输入链接即可下载

## Constraints That Must Stay True

- Core 包不依赖任何 UI 框架（Vue、NestJS）、CLI 框架或运行时环境
- 引擎必须可嵌入 CLI / Server / Docker 三种运行形态
- 依赖方向：Runtimes → Adapters → Core（不可反向）
- 所有 Ports（接口）定义在 Core 中，具体实现在 Adapters 中

## Explicit Non-Goals

- 不做在线视频播放
- 不做视频编辑/转码（仅做音视频合并）
- 不做内容推荐或内容发现
- 不做多平台支持（当前仅 Bilibili，但预留扩展点）
- 不做商业化 SaaS 服务

## Success Criteria For The First Production Milestone

- CLI 可完成单视频端到端下载（已完成）
- Web 前端 + 后端可完成下载任务管理（已完成）
- Docker 可在 NAS 上部署运行（已完成）
- 后续里程碑：批量下载、浏览器插件、登录态支持

## Required Human Decision Points

AI 不应自行决定以下事项：

- 登录态策略：是否支持 B站 登录、Cookie 如何管理
- 多平台扩展优先级：先支持哪个新平台（YouTube? 其他国内平台?）
- 商业化方向：是否作为开源项目、是否提供付费功能
- 浏览器插件的发布策略