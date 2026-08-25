# 需求：AI 总结截图上传腾讯云 COS 与知识发布管道（Phase 1）

## Goal

分析完成（AI 总结）后，将截图上传腾讯云 COS，并把总结知识（summary + summary_segment）写入云端 PostgreSQL，供后续向量化 / RAG 问答使用；本地文件保留作备份（影子双写）。对应 `docs/discussions/2026-08-21-summary-cloud-knowledge-base.md` 目标第 2、3 点与方案 B Phase 1（知识发布管道）。

## 决策（用户确认）

1. 范围：**完整发布管道 Phase 1**——截图上传 COS + 总结知识写入云端 `summary` / `summary_segment` 表，本地保留作备份。
2. Markdown 预览图片来源：**md 改指 COS**——截图上传后 md 内图片链接改为 COS 公网 URL，前端直接从 COS 加载。
3. 本轮即建云端知识库表（`summary` / `summary_segment`）并写入 segments，为 Phase 2 向量化铺路。
4. "照片"本轮**仅指 AI 总结截图**，不含用户穿搭照片（属问答场景一，后续）。
5. 云端数据库与本地已统一为同一个 PostgreSQL（阿里云 RDS `ai_summary`），因此知识库表建在同一库内。

## In Scope

- 新增 COS 集成：server 依赖 `cos-nodejs-sdk-v5`；新增 COS 存储服务，读 `TENCENT_COS_SECRET_ID/KEY/REGION/BUCKET`（已在 `.env`）上传截图，公网读。
- 新增云端知识表（同库）：
  - `summary(id, bvid, cid, video_title, video_url, model_name, raw_response JSONB, created_at, updated_at, UNIQUE(bvid,cid))`
  - `summary_segment(id, summary_id FK→summary ON DELETE CASCADE, seq, title, content, timestamp_seconds, frame_description, screenshot_url, created_at)`
  - embedding 列留到 Phase 2（embedding 模型选型后置）。
- 知识发布管道：分析完成后（`runAnalysis` 与 `runRebuild` 的 completed 分支）异步发布——
  1. 解析 `raw_response` → summary segments（复用现有归一化：四字段非空过滤）；
  2. 上传截图到 COS（Key：`summary/<bvid>-<cid>/screenshots/<basename>`，公网 URL `https://<bucket>.cos.<region>.myqcloud.com/<key>`）；
  3. upsert 云端 `summary` + `summary_segment`（按 `(bvid,cid)` 全量替换：事务内删旧插新，`(summary_id, seq)` 幂等）；
  4. 重写本地 md 图片链接为 COS 公网 URL。
- 发布状态：`ai_summary_task` 新增 `knowledge_status`（pending/synced/failed）与 `knowledge_error`；发布成功置 synced、失败置 failed + 错误信息；本地完成态不受发布失败影响（影子双写）。
- 重试入口：新增 `POST /api/summary-tasks/:id/publish`（仅 completed 且 raw_response 非空可重试）；`summary-tasks` 列表/详情响应增加 `knowledgeStatus`。
- 前端：AI 总结列表展示 `knowledgeStatus`，提供"重新发布"操作入口（复用现有重建/重试交互模式）。
- Docker：`Dockerfile.server` 打包新依赖（`cos-nodejs-sdk-v5` 纯 JS，无需原生编译）；compose/`.env.example` 补充 `TENCENT_COS_*` 变量说明。
- 文档对齐：`docs/design/app-overview.md`、`docs/context/codebase-map.md`、`docs/context/project-context.md`、需求/计划/测试/logs。

## Out Of Scope

- 用户穿搭照片上传 COS（问答场景一）。
- 向量化 / embedding / 检索 API（Phase 2）。
- 问答服务与独立前端 / `conversation` / `message` 表（Phase 3）。
- 历史已完成总结的回填（Phase 4）。
- 移除本地截图/md 备份路径（影子双写保留本地作备份）。

## 技术要点与风险

- 截图文件本地路径在 `summaryDir/screenshots/segment-N.jpg`；容器重建后本地截图可能丢失——重试发布时若截图文件缺失，标记 failed 并提示"可尝试 rebuild"（rebuild 用 raw_response 重截需本地视频，能力边界同既有）。
- COS 公网读依赖 bucket 公开读策略（用户已确认公开读）；私有桶/签名 URL 不做。
- 云端写入失败不影响本地完成态；发布为异步，失败可重试。
- `timestamp_seconds` 复用现有 `parseTimestampCandidates` / `pickTimestampSeconds` 解析。

## Roles / Permissions

- 单用户工具，无角色/权限系统，不受影响。
- COS 凭据为高权限密钥（`TENCENT_COS_SECRET_ID/KEY`）：仅存 `.env`（gitignore），不入库、不进镜像、不进日志。

## Edge Cases

- 空总结（无 segments）：无可发布内容，置 synced（无 segments 行），md 无图片无需重写。
- 部分截图上传失败：记录错误，置 failed，可整体重试（重试幂等，事务内删旧插新）。
- md 已含 COS 绝对 URL（绝对链接原样保留，`rewriteMarkdownImageUrls` 对绝对 URL 不重写）。
- 重试时截图文件缺失：置 failed + 提示 rebuild；不破坏本地完成态。
- COS 配置缺失：发布失败置 failed（错误含缺配置提示），不阻塞分析完成。

## Open Questions（非阻塞）

1. COS bucket 是否已开启公网读、URL 前缀形态（`cos.<region>.myqcloud.com` vs 自定义域名）——实现时用配置化 COS 公网 URL 前缀，默认 `https://<bucket>.cos.<region>.myqcloud.com`，必要时可覆盖。
2. 历史 89 条已完成总结是否立即回填——回填放 Phase 4，本轮只对"新完成"的总结发布。

## Acceptance Criteria

- [ ] 分析完成后截图自动上传 COS，公网 URL 可访问；云端 `summary` / `summary_segment` 正确写入（含 `screenshot_url`）。
- [ ] `ai_summary_task.knowledge_status` 正确流转（pending → synced/failed）；失败可重试。
- [ ] 前端 AI 总结列表显示 `knowledgeStatus` 并可"重新发布"。
- [ ] md 预览图片来自 COS 公网 URL（已发布总结）；未发布总结仍走本地 `/summary-files`。
- [ ] 本地截图/md 备份保留（影子双写）。
- [ ] `pnpm typecheck`、`pnpm build`、`pnpm docker:build:server` 通过；Docker 镜像含 COS 依赖。
