# 09-30 重试截图（screenshot_retry 收窄）Testing

> 需求：`docs/requirements/2026-09-17-screenshot-retry.md`
> 计划：`docs/plans/2026-09-30-screenshot-retry-plan.md`
> 定位：需求级观察态（应呈现/不应呈现），非测试脚本。

## 检查应覆盖的状态

### T1 纯截图重试
- screenshot_retry 作业：读段 timestampSeconds + 截图源 → 截图 → 传 COS → 仅回写 screenshot_url；不调 LLM、不改 summary 文本/段内容/向量、不改 ai_summary_task 状态。

### T2 批量幂等
- 仅处理 screenshot_url 为空且 timestamp 非空的段；已有截图不重传；重复投递由 dedup_key 去重。

### T3 截图源三级降级
- 本地高清 → NAS 下载 → 远端兜底；降级/跳过显式记日志。

### T4 作业化
- 触发（/rebuild 收窄）写 screenshot_retry 作业；status 读 DB（Phase 2 语义）。

### T5 安全跳过
- 本地视频缺失 / timestamp 缺失 / COS 未配置或上传失败 → 该段跳过并记录，不使整作业失败、不破坏内容。

### T6 前端语义
- rebuild 按钮呈现“重试截图”语义（补齐缺失、不重跑分析）；调用路径不变，兼容。

### T7 无回归
- 全量 server 测试绿；前端 typecheck/build 绿；旧“全量重建”副作用（改内容/向量/状态）不再发生。

## 验证命令
- `pnpm --filter @bilibili-downloader/server test`（测试容器，`TEST_DATABASE_URL`）
- `pnpm --filter @bilibili-downloader/server typecheck` / `build`
- `pnpm --filter @bilibili-downloader/frontend typecheck` / `build`

## 结论
- 状态：待实施后回填每条方向的通过/裁决结论。
