# Feature Inventory

## Purpose

Track the stable feature map for the application.

## Feature List

| Feature | Status | Owner Doc | Requirement Source | Notes |
|---------|--------|-----------|-------------------|-------|
| 单视频下载（Core） | done | `docs/architecture/system-baseline.md` | `docs/requirements/mvp.md` | MVP 核心能力，支持 BV/AV/URL 输入 |
| 资源解析（B站 API） | done | `docs/architecture/system-baseline.md` | `docs/requirements/mvp.md` | 视频详情、播放流信息获取 |
| FFmpeg 音视频合并 | done | `docs/architecture/system-baseline.md` | `docs/requirements/mvp.md` | 分离下载后合并为 MP4 |
| Web 前端 | done | `docs/design/app-overview.md` | `docs/requirements/mvp.md` | Vue 3 SPA，视频输入 + 下载列表 + 设置 |
| Server 后端 API | done | `docs/design/app-overview.md` | `docs/requirements/mvp.md` | NestJS + PostgreSQL（Prisma 8），任务管理 |
| Docker 容器化部署 | done | `docs/architecture/system-baseline.md` | `docs/requirements/mvp.md` | compose 双容器（server + vision-proxy），NAS 挂载共享 volume |
| HTTP 内置下载器 | done | `docs/architecture/system-baseline.md` | `docs/requirements/mvp.md` | 支持重试和基础进度 |
| 下载目录配置 | done | `docs/design/app-overview.md` | `docs/requirements/mvp.md` | 可配置输出目录 |
| 临时文件清理 | done | `docs/architecture/system-baseline.md` | `docs/requirements/mvp.md` | 成功后清理，失败可配置保留 |
| 视频解析页面优化 | done | `docs/design/app-overview.md` | `docs/requirements/2026-06-02-video-detail-page-improvement.md` | P0，已完成实施，含 section 选择器、一键解析、入队不跳转、目录弹框 |
| UI 界面优化 | deprecated | `docs/design/app-overview.md` | `docs/requirements/2026-06-02-ui-improvement.md` | 需求已废弃：范围涉及交互调整和后端接口修改，需重新拆分需求 |
| AI 总结知识发布（COS + 云端知识库） | done | `docs/design/app-overview.md` | `docs/requirements/2026-08-24-cos-summary-knowledge-publish.md` | 分析完成后截图上传 COS、summary/summary_segment 入库（影子双写） |
| 知识向量化与向量检索 API | done | `docs/design/app-overview.md` | `docs/requirements/2026-09-01-knowledge-vector-search.md` | pgvector top-k（`GET /api/knowledge/search`），chunk=summary_segment |
| RAG 穿搭问答（服务 + 前端） | done | `docs/design/app-overview.md` | `docs/requirements/2026-09-09-rag-chat-service.md` | 双场景、多轮、三段式引用、照片压缩存 COS 专属目录、严格兜底 |

## Rule

This file is not a backlog dump. Keep it to supported or actively owned features.