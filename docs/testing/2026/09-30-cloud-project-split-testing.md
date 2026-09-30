# 09-30 Phase 3 拆分 cloud-server / nas-worker Testing

> 需求：`docs/requirements/2026-09-17-cloud-project-split.md`
> 计划：`docs/plans/2026-09-30-cloud-project-split-plan.md`
> 定位：需求级观察态（应呈现/不应呈现），非测试脚本。

## 检查应覆盖的状态

### T1 三包结构与依赖方向
- 存在 `server-common` / `cloud-server` / `nas-worker`；依赖 cloud-server/nas-worker → server-common → adapters → core；无反向依赖。

### T2 server-common 抽离零行为变更（Stage A）
- DB/logging/worker_job 仓储/settings/cookie/共享类型迁入 server-common；原 server 全量测试仍绿。

### T3 模块归属与物理隔离
- 云端含 parse/download 创建读取/analysis 触发查询/chat-RAG/knowledge/prompt/settings/作业生产；NAS 含下载执行/分析引擎/截图/screenshot_retry/完整性检查/vision-proxy 客户端/作业消费/PathsService。
- 不应出现：cloud-server import ffmpeg / 分析执行 / vision-proxy。

### T4 LLM / 缓存 / Cookie
- 云端多模态经 `openai` SDK 连 `QWEN_VISION_PROXY_URL`（模型/端点/配置不变）；NAS 用 QwenClient/vision-proxy。
- 云端 FileCacheStore；NAS 内存缓存。Cookie app_settings 物化 + 版本刷新（含 ParseService 刷新）。

### T5 运行形态（行为与 Phase 2 一致）
- 云端在无 NAS 卷下可读/问答/触发；NAS worker 认领执行作业回写 DB/COS；NAS 离线作业排队。

### T6 部署（Stage D，人工批准 + auth 前置）
- 三镜像：cloud-server 无 ffmpeg/Python/vision-proxy；nas-worker 含 ffmpeg + compose 内 vision-proxy；vision-proxy 独立。worker 独立最小权限 DB 角色。
- 验证 `pnpm docker:build`、`docker compose config`。**auth 未完成前公网暴露 blocked。**

### T7 无回归
- 各包 typecheck/build/test 绿；端到端（下载→分析→查看→问答）行为不变。

## 验证命令
- `pnpm typecheck`、`pnpm build`
- `pnpm --filter @bilibili-downloader/server test`（迁移后按新包名）
- Stage D（批准后）：`pnpm docker:build`、`docker compose config`

## 结论
- 状态：待实施后回填每条方向的通过/裁决结论（Stage D 视 auth 与人工批准）。
