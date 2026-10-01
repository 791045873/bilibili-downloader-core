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
| Server 后端 API | done | `docs/design/app-overview.md` | `docs/requirements/mvp.md` | NestJS + PostgreSQL（Prisma 8），任务管理；自 Phase 3 拆分为 cloud-server（对外 HTTP）/ nas-worker（作业执行）/ server-common（共享内核） |
| Docker 容器化部署 | done | `docs/architecture/system-baseline.md` | `docs/requirements/mvp.md` | compose 双容器（server + vision-proxy），NAS 挂载共享 volume；**三镜像接线待 Stage D**（见下方云端/NAS 拆分行） |
| HTTP 内置下载器 | done | `docs/architecture/system-baseline.md` | `docs/requirements/mvp.md` | 支持重试和基础进度 |
| 下载目录配置 | done | `docs/design/app-overview.md` | `docs/requirements/mvp.md` | 可配置输出目录 |
| 临时文件清理 | done | `docs/architecture/system-baseline.md` | `docs/requirements/mvp.md` | 成功后清理，失败可配置保留 |
| 视频解析页面优化 | done | `docs/design/app-overview.md` | `docs/requirements/2026-06-02-video-detail-page-improvement.md` | P0，已完成实施，含 section 选择器、一键解析、入队不跳转、目录弹框 |
| UI 界面优化 | deprecated | `docs/design/app-overview.md` | `docs/requirements/2026-06-02-ui-improvement.md` | 需求已废弃：范围涉及交互调整和后端接口修改，需重新拆分需求 |
| AI 总结知识发布（COS + 云端知识库） | done | `docs/design/app-overview.md` | `docs/requirements/2026-08-24-cos-summary-knowledge-publish.md` | Phase 1b 起内联发布：分析完成即写 DB+COS、完成门槛=内容入库；旧影子双写/publish/backfill/repair 已下线 |
| 知识向量化与向量检索 API | done | `docs/design/app-overview.md` | `docs/requirements/2026-09-01-knowledge-vector-search.md` | pgvector top-k（`GET /api/knowledge/search`），chunk=summary_segment |
| RAG 穿搭问答（服务 + 前端） | done | `docs/design/app-overview.md` | `docs/requirements/2026-09-09-rag-chat-service.md` | 双场景、多轮、三段式引用、照片压缩存 COS 专属目录、严格兜底 |
| AI 总结查看（Markdown DB 渲染） | done | `docs/design/app-overview.md` | `docs/requirements/2026-09-17-cloud-read-path-db-render.md` | Phase 1a：两 markdown 端点从云 DB 渲染（summary/segment，回退 raw_response），图片用 COS URL，读侧不触盘 |
| 异步任务队列（worker_job） | done | `docs/architecture/system-baseline.md` | `docs/requirements/2026-09-17-cloud-worker-jobs.md` | Phase 2：DB 队列 + 租约/心跳/reaper + dedup_key 活跃唯一，取代进程内队列与互斥 |
| 小用户系统与写操作鉴权 | done | `docs/design/app-overview.md` | `docs/requirements/2026-09-17-user-auth.md` | 两级角色（admin/user）、可吊销会话 + HttpOnly cookie、全局 fail-closed 守卫、QA 会话按用户隔离、admin 用户管理页 |
| 云端/NAS 拆分（cloud-server / nas-worker / server-common） | done（代码；部署待 Stage D） | `docs/architecture/module-boundaries.md`、`docs/architecture/system-baseline.md` | `docs/requirements/2026-09-17-cloud-project-split.md` | Phase 3：退役单体 `packages/server`，拆分 cloud-server（对外 HTTP + 作业生产）/ nas-worker（无 HTTP、作业消费执行）/ server-common（共享内核），COS 客户端下沉 adapters；作业队列为跨主机解耦通道。Stage A–C/B-5 代码完成，三镜像部署接线属 Stage D 保护区待人工批准（当前 `docker:build` 失效）。Plan：`docs/plans/2026-09-30-cloud-project-split-plan.md` |

## Rule

This file is not a backlog dump. Keep it to supported or actively owned features.