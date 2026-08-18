# 2026-08-18 移除多模态直连分支与 chatCompletion 死代码

## 需求来源

用户会话中提出：`multimodalChat` 中"不走 VisionProxy 直连模型"的分支在当前形态下是死代码，应去掉；经确认，`chatCompletion` 方法同样无调用方，一并删除。

## 现状核实

- `QwenClient.multimodalChat`（`packages/adapters/src/llm/qwen-client.ts:135-228`）有两个分支：配置 `visionProxyUrl` 时转发给 Python 视觉代理（L145-201）；未配置时 Node 直连 `baseUrl/chat/completions`（L203-227）。
- 全仓库 `multimodalChat` 唯一调用点：`packages/server/src/analysis/analysis-engine.ts:169`；其前置守卫（L153-157）`usesVisionProxy()` 为假时直接抛错「视频分析需要配置 QWEN_VISION_PROXY_URL」。因此直连分支**不可达，确认为死代码**。
- `chatCompletion` 方法（`qwen-client.ts:104-130`）与 `ChatCompletionRequest` 接口（L30-35）经全仓库 grep 无任何调用方/消费者（仅 `llm/index.ts:4` 再导出），同为死代码。
- 当前视频分析实际流程（`analysis-engine.ts:118-214`）：单次 `multimodalChat(video_url + 字幕)` 返回时间戳 → 截图 → 生成 Markdown；无第二次"多模态选图"调用，也从不调用 `chatCompletion`。

## 决策点

1. **是否移除直连分支**：移除。理由：不可达 + 保留会误导（暗示"无代理也能多模态"），且新增防御性错误信息（未配置代理时代理调用直接报错）与现状行为一致（现状该场景本就抛错）。
2. **是否一并删除 chatCompletion**：删除。用户确认。理由：与直连分支同属无消费者死代码，继续保留会在文档与 API 面上传播过期契约。
3. **守卫位置**：保留 `analysis-engine.ts` 的早期守卫（快速失败、错误信息友好），`multimodalChat` 内再加防御性抛错（防未来出现新调用点误用）。
4. **文档同步**：`video-analysis-baseline.md` 中"无代理直连 / 公网 URL"描述与流程图中 `chatCompletion()` 引用全部更正；`docs/testing/2026/08-18-env-var-cleanup-testing.md` 的"无代理路径一致"测试方向改为"代理必选"。

## 待确认（非阻塞）

- 无。

## 推进路径

- 完整 plan：`docs/plans/2026-08-18-remove-llm-dead-paths-plan.md`（改动 adapter 公共契约 + 跨模块 + 多文档，full plan + 独立 plan/closure audit）。