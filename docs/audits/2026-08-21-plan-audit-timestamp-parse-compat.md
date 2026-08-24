# Plan Audit — LLM 时间戳解析兼容（三段式语义兜底）

- 计划：`docs/plans/2026-08-21-timestamp-parse-compat-plan.md`
- 测试文档：`docs/testing/2026/08-21-timestamp-parse-compat-testing.md`
- 审计日期：2026-08-21
- 审计方式：冷回放代审计（`docs/context/ai-autonomy-policy.md` reviewer availability = `none`；本计划非 protected 区域、非 high-risk，允许冷回放）。只读审计，未修改文件；以"首次接触计划"视角重放 live 基线、计划范围、执行项、Exit Criteria、Closure Gates 与测试方向。

## 结论

VERDICT: approved（1 处已吸收收紧）。无 BLOCKING / MAJOR。

## 事实核查（对照 live 代码）

- `packages/server/src/analysis/timestamp.ts:5` `transTimestampToSeconds` 仅 2/3 段、纯数字、分/秒 <60（两段分钟也 <60）——与计划基线一致。
- `packages/server/src/analysis/analysis-engine.ts:301` 对 `undefined` 直接 `continue` 跳过截图；`packages/adapters/src/ffmpeg/ffmpeg-screenshot.ts:132` 越界帧静默失败——与计划基线一致。
- `ffmpeg-screenshot.ts:197` `getVideoDuration` 私有、含 `probeVideoDuration` + `durationCache`（按 path 缓存）——"改为 public 复用探测与缓存"可行。
- `packages/server/src/analysis/prompt-template.ts:14` 示例 `00:02:30代表2分20秒` 笔误属实；`BUILTIN_AI_PROMPT_CONTENT` 复用 `AI_PROMPT_FORMAT_SNIPPET`（改一处两处生效）属实。
- `transTimestampToSeconds` 全仓唯一消费方为 `analysis-engine.ts:27,301`（grep 确认），"删除避免死代码"成立。
- 验证命令 `pnpm typecheck` / `pnpm build` 为真实命令（根 package.json）。Node v22.22.3 支持 `--experimental-strip-types`，与 `docs/logs/2026-08-12-ai-summary-rebuild-from-raw.md` 既有断言验证基线一致。

## 审查要点

- **执行/闭包门禁诚实性**：Exit Criteria 与 Closure Gates 可被断言脚本 + typecheck/build + grep 实际证明，无虚设门禁。
- **隐藏依赖**：时长探测复用 `FfmpegScreenshot.getVideoDuration`（同一实例同一缓存），远程源探测成本与现状 `takeScreenshots` 首次探测相同；无新增外部服务/依赖。
- **无主遗留**：`transTimestampToSeconds` 删除、提示词示例修正、文档对齐均有归属 Phase；无遗留引用（历史留档除外，已排除）。
- **范围依赖未解问题**：无；方案决策（候选列表 + 时长择优 vs 仅解析兜底）已记录备选与残余风险。
- **测试方向**：已存在且为需求级可观察状态（应/不应成立 + 断言用例 + 范围外裁定），非纯实现细节；沿用了项目既有测试文档写法。
- **Micro-plan 例外未滥用**：4 个源码文件 + 多份文档、变更用户可见行为，正确声明 full plan。
- **候选公式复核**：三段 `05:32:40` → 候选 `[19960, 332]`；`02:30:500` → `[150]`；`00:02:30` → `[150, 2]`（择优 150）；`70:30` → `[4230]`；`01:60:00` / `12:60` / 非数字 / 空串 → `[]`。择优按首候选优先、超时长回退前两段分秒、全超时跳过，符合用户诉求（"默认解析无法正确截取时取前两段当分秒"）。

## 审计吸收（Minor，已并入计划/测试文档）

1. `pickTimestampSeconds` 对非法 `duration`（NaN/负/Infinity）的守卫语义原表述含歧义 → 计划与测试文档已收紧为"非有限非负视为未知取首候选"。
2. 未声明"不重写 Markdown 中展示的原始 timestamp 字符串" → 已加入 Non-Goals。

## 留档说明

本文件为计划审计证据；审计未修改任何被审文件，吸收项为审计前对计划/测试文档的两处措辞收紧。