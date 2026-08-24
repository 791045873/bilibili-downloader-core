# Log - 2026-08-21 LLM 时间戳解析兼容（三段式语义兜底）

计划：`docs/plans/2026-08-21-timestamp-parse-compat-plan.md`
测试：`docs/testing/2026/08-21-timestamp-parse-compat-testing.md`
审计：`docs/audits/2026-08-21-plan-audit-timestamp-parse-compat.md`、`docs/audits/2026-08-21-closure-audit-timestamp-parse-compat.md`

## Summary

解决"根据大模型返回内容进行截图"功能对 LLM 时间戳不稳定的兼容问题：LLM 可能返回 `hh:mm:ss`（三段）或 `mm:ss`（两段），且三段式可能实为"分:秒:毫秒/帧"。改动后截图时间戳解析产出有序候选秒数，并用视频时长择优：默认 `hh:mm:ss` 解读优先，仅当其不可用或超出实际视频时长时回退前两段按"分:秒"重算；两段 `mm:ss` 放开分钟 ≥60（覆盖超过 1 小时的视频）。同时修正内置提示词示例笔误（`00:02:30代表2分20秒` → `2分30秒`）并显式允许 `mm:ss`，从源头降低模型输出不稳定。

## Changes

- `packages/server/src/analysis/timestamp.ts`：`transTimestampToSeconds` 替换为 `parseTimestampCandidates`（三段：候选1 `h:m:s`、候选2 前两段 `分:秒`；两段：`分:秒` 允许分钟 ≥60；去重保序，不可解析返回 `[]`）与 `pickTimestampSeconds`（`duration` 有限非负时取第一个 ≤ duration 的候选，否则取首候选）。
- `packages/adapters/src/ffmpeg/ffmpeg-screenshot.ts`：私有 `getVideoDuration` 改为 `public`（签名与行为不变），供引擎复用既有 ffprobe 时长探测与按路径缓存。
- `packages/server/src/analysis/analysis-engine.ts`：截图循环前探测一次截图源时长（失败 warn 并退化为默认解读）；循环内改用候选解析 + 时长择优；跳过日志含原始时间戳、候选与时长上下文。
- `packages/server/src/analysis/prompt-template.ts`：`AI_PROMPT_FORMAT_SNIPPET` 时间戳约束改为"格式为 `hh:mm:ss` 或 `mm:ss`，分钟和秒需小于 60"，示例修正为 `00:02:30代表2分30秒`（内置提示词复用同一片段随之生效；已保存的自定义提示词不迁移）。

## Verification

- `node --experimental-strip-types` 临时断言脚本（不入库）：`parseTimestampCandidates` 16 用例 + `pickTimestampSeconds` 11 用例共 27 项全部 PASS（含 `02:30:500`→150、`05:32:40`→[19960,332] 配 350s 取 332、`70:30`→4230、`01:60:00`/`12:60`/非数字/空串→`[]`、NaN/负/Infinity 时长按未知处理）。
- `pnpm typecheck`：通过（7 个 workspace 项目全部 Done）。
- `pnpm build`：通过（frontend vite build + server nest build 等全部 Done）。
- 残留扫描：`transTimestampToSeconds` / `2分20秒` 活动源码 0 命中；活动文档命中仅存在于本变更的 plan/testing/log/audit 验证工件（描述变更用）与历史留档（不参与扫描）。

## Notes

- 真实 B 站视频 + LLM 端到端截图验证为运行级人工残余项（需密钥/外部网络/完整分析环境），纯函数断言 + 编译验证已覆盖解析择优逻辑。
- Markdown 文档中展示的 `timestamp` 仍为 LLM 原样返回的字符串（截图落点用换算后秒数），不重写文档内容。