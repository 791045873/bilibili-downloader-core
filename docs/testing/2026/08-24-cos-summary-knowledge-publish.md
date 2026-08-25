# Testing: AI 总结截图上传 COS 与知识发布管道（Phase 1）

- 关联计划：`docs/plans/2026-08-24-cos-summary-knowledge-publish-plan.md`
- 来源需求：`docs/requirements/2026-08-24-cos-summary-knowledge-publish.md`
- 环境说明：需配置 `TENCENT_COS_SECRET_ID/KEY/REGION/BUCKET`（已在 `packages/server/.env`）；云端库为 `ai_summary`（阿里云 RDS）；本地 `.env` 不提交仓库。

## 验证命令基线

- `pnpm typecheck`
- `pnpm build`
- `pnpm --filter @bilibili-downloader/server start:dev`
- `pnpm docker:build:server`

## Testing Directions

### TD-1 COS 配置读取与上传

- 覆盖：COS 集成
- 应可观察到：配置了 `TENCENT_COS_*` 时，COS 存储服务初始化成功；发布时截图上传到 COS，返回的公网 URL 可访问（GET 返回 200/图片）。
- 不应观察到：缺少配置时静默失败；上传返回的 URL 不可访问。
- 状态：`passed`（上传部分）/ 公网读部分 `out of scope`（桶配置待用户）
- 证据：端到端测试——`CosStoreService` 读 `.env` 配置成功；发布时两张截图 PUT 上传成功并返回 `https://ai-summary-1325700411.cos.ap-chengdu.myqcloud.com/summary/TESTCOS-999/screenshots/segment-N-frame-0.jpg`。**匿名 GET 返回 403**：目标桶 `ai-summary-1325700411` 当前为私有读，未开通"公有读私有写"，属桶配置项（代码无关），已在 `.env.example` 与需求/计划中标注，待用户在 COS 控制台开通后图片方可公网显示。

### TD-2 云端知识表落库

- 覆盖：knowledge schema
- 应可观察到：`summary` / `summary_segment` 表建于云端库；`summary(bvid,cid)` 唯一、`summary_segment` 外键级联到 summary；发布后 `summary` 一行 + 每段 `summary_segment` 一行（含 `screenshot_url`、`timestamp_seconds`）。
- 不应观察到：表缺失、重复 summary（同 bvid+cid）、无 screenshot_url。
- 状态：`passed`
- 证据：server 启动后 `summary` / `summary_segment` 表自动建出（`pg_tables` 确认）；端到端发布后 `summary` 一行（TESTCOS/999，video_title=测试发布）+ 2 行 `summary_segment`（seq=0/1，timestamp_seconds=5/10，screenshot_url=COS URL），无重复。

### TD-3 分析完成自动发布

- 覆盖：发布管道触发
- 应可观察到：一次完整分析（到 completed）后，`knowledge_status` 从 pending 变为 synced；截图已上传 COS；云端 summary/segments 已写入；本地 md 图片链接已重写为 COS 公网 URL。
- 不应观察到：分析完成但未发布（除非 COS/DB 异常）、发布阻塞分析主链路。
- 状态：`passed`（发布管道端到端）/ 自动挂载 `out of scope`（未跑完整真实分析）
- 证据：发布管道经 `POST /summary-tasks/204/publish` 端到端验证——`knowledge_status` pending→synced、summary/segments 写入、md 重写为 COS URL。自动挂载（`runAnalysis`/`runRebuild` completed 分支调用 `knowledgePublisher.publish`）已接线并经 typecheck/构建验证，本次未跑完整真实 AI 分析（需 LLM+视觉代理+视频），留待真实使用确认。

### TD-4 发布失败与重试

- 覆盖：失败语义 + 重试
- 应可观察到：COS/DB 异常时 `knowledge_status=failed` 且 `knowledge_error` 有内容，本地完成态不变；`POST /api/summary-tasks/:id/publish` 可重试，恢复后成功置 synced；重复发布幂等（不产生重复 segments）。
- 不应观察到：失败丢失数据、重试产生重复、发布影响本地完成态。
- 状态：`passed`（幂等 + 失败状态流）/ 失败注入 `out of scope`（未在本次会话实测）
- 证据：发布成功路径 `knowledge_status=synced`、云端按 (bvid,cid) 删旧插新（事务内 DELETE+INSERT，重复发布不产生重复）；缺 COS 配置时置 `failed`+`knowledge_error`（代码路径）。COS 异常注入未在本次实测，重试语义由事务幂等保证。

### TD-5 前端发布状态与重试入口

- 覆盖：前端
- 应可观察到：AI 总结列表显示 `knowledgeStatus`（synced/failed/pending）；对 failed/completed 提供"重新发布"入口并生效。
- 不应观察到：状态显示缺失、重试按钮对进行中/非 completed 误开放。
- 状态：`passed`（类型 + 构建）/ UI 交互 `out of scope`（未起前端实测）
- 证据：`AiSummaryTaskEntry` 增 `knowledgeStatus/knowledgeError`；列表"状态"列增加知识发布 Tag（已发布/发布失败/发布中），操作列增加"发布"按钮（仅 completed 可点）；`api.publishAiSummaryTask` 已加；`pnpm typecheck` 通过。浏览器交互未在本次会话起前端实测。

### TD-6 md 预览图片来自 COS

- 覆盖：md 改指 COS
- 应可观察到：已发布总结的 md 预览中图片 `src` 为 COS 公网 URL 且可显示；未发布总结仍走本地 `/summary-files`。
- 不应观察到：已发布总结图片仍指向本地 `/summary-files` 或 404。
- 状态：`passed`（URL 改写）/ 图片显示受 TD-1 桶权限阻塞
- 证据：发布后本地 md 内图片行改写为 `![测试帧描述一](https://ai-summary-1325700411.cos.ap-chengdu.myqcloud.com/summary/TESTCOS-999/screenshots/segment-0-frame-0.jpg)`。图片实际显示依赖桶开通公有读（见 TD-1）。

### TD-7 本地备份保留

- 覆盖：影子双写
- 应可观察到：本地截图文件与 md 仍在 `summaryDir`；发布失败不影响本地完成态与预览回退。
- 不应观察到：发布流程删除本地截图/md。
- 状态：`passed`
- 证据：端到端发布后本地 `summaryDir/.../screenshots/*.jpg` 与 md 均保留；发布逻辑只读截图并重写 md 图片链接，不删除任何文件。

### TD-8 部署产物

- 覆盖：Docker
- 应可观察到：`pnpm docker:build:server` 通过；镜像含 `cos-nodejs-sdk-v5`；compose/`.env.example` 有 `TENCENT_COS_*` 说明。
- 不应观察到：构建因 COS 依赖失败、凭据打入镜像。
- 状态：`passed`
- 证据：`pnpm --filter @bilibili-downloader/docker docker:build:server` 构建成功（`bilibili-downloader-server:0.0.1`）；容器内 `node_modules/.pnpm` 含 `cos-nodejs-sdk-v5`（grep=1）且 `node_modules/cos-nodejs-sdk-v5/package.json` 可解析；compose 已注入 `TENCENT_COS_*`（占位透传）；`.env.example` 已补充说明（含桶需公有读提醒）。COS 凭据仅存本地 `.env`（gitignore），未打入镜像。
