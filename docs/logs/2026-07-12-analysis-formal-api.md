# 2026-07-12 Analysis Formal API 实现日志

## Plan
- `docs/plans/2026-07-07-analysis-formal-api-plan.md`

## 改动
- `packages/server/src/analysis/analysis-engine.ts`: `AnalysisInput` 新增 `metadata`、`screenshotVideoPath?`，`subtitlePath` 改为可选；`analyze()` 支持 `subtitlePath` 缺失时跳过 SRT 解析、仅传视频给 LLM
- `packages/server/src/analysis/analysis.controller.ts`: 移除 `POST /api/analysis/debug` 及所有 debug 辅助函数；新增 `POST /api/analysis/run` 接收 `AnalysisRequest`，含完整校验（绝对路径、videoTitle 非空、metadata.type 枚举、bilibili 必填字段）

## 验证
- `pnpm typecheck`: 全 6 包 Done
- `pnpm build`: 全 6 包 Done
- curl 手动测试 7 用例：debug 404、empty body 400、relative videoPath 400、bilibili 缺 videoUrl 400、invalid metadata.type 400、empty videoTitle 400、valid local 进入 engine 因缺 QWEN_API_KEY 报 400（证明校验通过）

## 备注
- AC#5/AC#6（front matter video_url）裁定给 doc-opt plan，本 plan closure 不要求
- `screenshotVideoPath` 字段已定义但截图源选择逻辑未实现（属 3b plan scope）
- 运行时 LLM 调用未 exercised（需 QWEN_API_KEY + vision proxy 环境），校验逻辑与编译已验证
- `docs/design/app-overview.md` 待扩展以覆盖 `POST /api/analysis/run` 接口
