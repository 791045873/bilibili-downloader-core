# 2026-08-21 LLM 时间戳解析兼容（三段式语义兜底）

> Plan Status: completed
> Last Reviewed: 2026-08-21
> Source: 用户需求——"根据大模型返回内容进行截图"功能对大模型返回时间戳不稳定（`hh:mm:ss` 三段式 / `mm:ss` 两段式混出）做兼容；默认逻辑解析无法正确截取时，考虑三段式实为"分:秒:毫秒"，将三段前两段按"分:秒"重算。
> Related: `docs/logs/2026-08-12-ai-summary-rebuild-from-raw.md`（`timestamp.ts` 抽取与既有 `node --experimental-strip-types` 断言验证基线）、`docs/plans/2026-07-07-screenshot-remote-3a-plan.md`（远端时长探测与 `Infinity` 兜底决策）
> Audit: required（非 protected 区域；reviewer availability = none → 采用冷回放代审计，证据落 `docs/audits/`）
> Testing: `docs/testing/2026/08-21-timestamp-parse-compat-testing.md`

## Current Baseline

- `packages/server/src/analysis/timestamp.ts`：`transTimestampToSeconds` 仅支持 `hh:mm:ss`（三段，分钟/秒 <60）与 `mm:ss`（两段，分钟也需 <60，即超过 1 小时的视频用 `mm:ss` 会被拒）；其余输入返回 `undefined`。
- `packages/server/src/analysis/analysis-engine.ts:301`：对 `undefined` 时间戳直接 `continue`，该总结段落不产截图（仅 warn 日志）；`FfmpegScreenshot.screenshotFrame`（`packages/adapters/src/ffmpeg/ffmpeg-screenshot.ts:132`）对超出视频时长的点静默失败、不产图。
- LLM 时间戳实际不稳定，三类失败形态：
  1. 三段 `mm:ss:xxx` 且第三段 ≥60（如 `02:30:500` 表示 2分30.5秒）→ 默认解析失败（秒 ≥60），该段无截图。
  2. 三段 `mm:ss:xxx` 且第三段 <60（如 `05:32:40` 表示 5分32.4秒）→ 默认解析"成功"但数值错误（5h32m40s），超视频时长被截图器静默丢弃，该段仍无截图。
  3. 两段 `mm:ss` 且分钟 ≥60（超过 1 小时的视频）→ 被拒。
- 内置提示词 `packages/server/src/analysis/prompt-template.ts:14`：格式片段示例 `00:02:30代表2分20秒` 有误（应为 2分30秒），且只约束 `hh:mm:ss` 单一格式。
- `FfmpegScreenshot.getVideoDuration`（ffmpeg-screenshot.ts:197）为私有方法，已有 ffprobe 探测 + 按路径缓存；`takeScreenshots` 内部已用它校验越界帧。
- server 无单元测试设施（仓库基线）；既有验证方式为 `node --experimental-strip-types` 临时断言脚本（不入库），见 `docs/logs/2026-08-12-ai-summary-rebuild-from-raw.md`。

## Goals

- 截图时间戳解析兼容模型不稳定返回：默认 `hh:mm:ss` 解读失败**或超出实际视频时长**时，将三段前两段按 `分:秒` 重算（丢弃第三段毫秒/帧）；两段 `mm:ss` 允许分钟 ≥60。
- 用视频时长做候选择优：优先文档化 `hh:mm:ss` 解读，仅当其不可用/超时长时回退前两段 `分:秒`；时长未知时保持现状（默认解读）。
- 修正内置提示词示例笔误并显式允许 `mm:ss`，从源头降低模型输出不稳定。
- 行为可观察：原能截图的用例不变；原"解析失败/超时静默无图"的用例按新逻辑尽量截到正确时间点，日志保留候选与时长上下文。

## Non-Goals

- 不改 `frameDescription` 处理、文档生成、`raw_response` 存储语义、API 契约、数据库、部署。
- 不引入仓库级单元测试设施（沿用既有临时断言脚本验证方式）。
- 不做关键帧/二次图像选择（保持"按时间戳直接截图"基线）。
- 不迁移已保存的自定义提示词（只改内置提示词与格式片段常量）。
- 不新增"毫秒精度截图"能力（丢弃毫秒段，相邻帧差异可忽略）。
- 不重写 Markdown 中展示的原始 `timestamp` 字符串（文档保留 LLM 原样返回的时间戳文本，仅截图落点用换算后秒数）。

## Infrastructure And Config Prereqs

- 无新增依赖；ffprobe 已在截图链路使用。
- 时长探测复用 `FfmpegScreenshot.getVideoDuration`（含按路径缓存），远程源探测成本与现状 `takeScreenshots` 首次探测相同（同一实例、同一缓存）。

## Execution Plan

### Phase 1 - 解析与候选择优

Status: completed
Targets: `packages/server/src/analysis/timestamp.ts`, `packages/adapters/src/ffmpeg/ffmpeg-screenshot.ts`, `packages/server/src/analysis/analysis-engine.ts`

- Item Types: `Decision | Fix | Proof`
- Prereqs: 无

- [x] `Decision`: 解析策略 = 有序候选列表 + 视频时长择优。备选方案：(a) 仅解析器兜底（默认解析失败才取前两段）——无法覆盖形态 2（默认解析"成功"但数值错误），即用户所述"截图无法正确截取"的主要形态，判定不足；(b) 把全部候选交给截图器各截一张——每段多产图片、改变文档内容，拒绝；(c) 采用方案：`parseTimestampCandidates` 产出有序去重候选（文档化 `hh:mm:ss` 在前），配合引擎探测到的视频时长取第一个 ≤ 时长的候选；时长未知时取首候选（与现状一致）。残余风险：当多个合法候选都落在视频时长内（如超长视频中 `01:30:00`），优先文档化解读可能与模型真实意图不符，属模型输出固有歧义，可接受。
- [x] `Decision`: 删除 `transTimestampToSeconds`（引擎改走候选择优后无调用方，避免死代码；`timestamp.ts` 导出 `parseTimestampCandidates` 与 `pickTimestampSeconds`）。备选：保留薄封装——无消费者、纯冗余，拒绝。
- [x] `Fix`: `timestamp.ts` 新增 `parseTimestampCandidates(timestamp): number[]`：三段时候选1 = `a*3600+b*60+c`（`b<60 && c<60`）、候选2 = 前两段 `a*60+b`（`b<60`，丢弃第三段）；两段时 `a*60+b`（秒 <60，允许分 ≥60）；仅接受纯数字段；去重保序；不可解析返回 `[]`。新增 `pickTimestampSeconds(candidates, duration?)`：`duration` 非有限非负时视为未知、取首候选；`duration` 为有限非负时取第一个 ≤ duration 的候选，无则 `undefined`。
- [x] `Fix`: `ffmpeg-screenshot.ts` 将私有 `getVideoDuration` 改为 `public`（签名与行为不变，供引擎复用时长探测与缓存）。
- [x] `Fix`: `analysis-engine.ts` 在截图循环前探测一次截图源时长（远程带 headers、本地不带；探测失败 → `undefined` 并 warn，退化现状）；循环内改用 `parseTimestampCandidates` + `pickTimestampSeconds`；候选为空或全部超出时长时 warn（日志含原始时间戳、候选、时长）并跳过该段。
- [x] `Proof`: 临时断言脚本（`node --experimental-strip-types` 直接 import `timestamp.ts`，不入库，见 `docs/testing/2026/08-21-timestamp-parse-compat-testing.md`）覆盖解析与择优矩阵。

Exit Criteria:

- [x] `timestamp.ts` 导出 `parseTimestampCandidates` / `pickTimestampSeconds`，无 `transTimestampToSeconds` 残留引用。
- [x] 引擎按"文档化解读优先、超时长回退前两段分秒、全部无效跳过"工作；跳过日志含候选与时长上下文。
- [x] 原有正常用例不回归：`hh:mm:ss` / `mm:ss` 合法时间戳截图行为不变。
- [x] `pnpm typecheck`、`pnpm build` 通过。

### Phase 2 - 内置提示词修正

Status: completed
Targets: `packages/server/src/analysis/prompt-template.ts`

- Item Types: `Fix | Proof`
- Prereqs: Phase 1（同一次发布，不阻塞实现顺序）

- [x] `Decision`: 修正格式片段 `AI_PROMPT_FORMAT_SNIPPET`：时间戳约束改为"格式为 `hh:mm:ss` 或 `mm:ss`，分钟和秒需小于 60"，示例 `00:02:30代表2分20秒` 改为 `00:02:30代表2分30秒`。理由：格式片段既是引擎依赖的格式约束，也是前端"一键插入"的单一来源；修正笔误并显式允许 `mm:ss` 可降低模型补零/错位概率，缓解解析兼容的压力。备选：仅改代码不做提示词修正——治标不治本，拒绝。残余风险：极小；已保存的自定义提示词不自动更新（无迁移，接受）。
- [x] `Fix`: `prompt-template.ts` 中格式片段按上述文本更新（内置提示词 `BUILTIN_AI_PROMPT_CONTENT` 引用同一片段，随之生效）。
- [x] `Proof`: grep 活动代码确认旧示例 `2分20秒` 无残留；内置提示词与格式片段文本一致。

Exit Criteria:

- [x] 格式片段与内置提示词示例已修正并显式允许 `mm:ss`；旧示例无残留。
- [x] 行为层面无 owner-doc 更新需求（提示词内容为产品数据，非文档契约）；`docs/logs/` 更新见 Phase 3。

### Phase 3 - 文档与日志对齐

Status: completed
Targets: `docs/context/project-context.md`, `docs/context/codebase-map.md`, `docs/logs/2026-08-21-timestamp-parse-compat.md`

- Item Types: `Fix | Proof`
- Prereqs: Phase 1、Phase 2 完成

- [x] `Fix`: `project-context.md` Active plan 指向本计划，最近完成项/Active backlog 描述同步（如适用）。
- [x] `Fix`: `codebase-map.md` server analysis 行与 adapters ffmpeg 相关行 Last Verified 更新为 2026-08-21（行为变更，无新增入口点）。
- [x] `Add`: `docs/logs/2026-08-21-timestamp-parse-compat.md` 记录实施与验证结果（简短、append-only）。
- [x] `Proof`: 文档与最终实现一致；残留扫描（活动源码/活动文档）：无 `transTimestampToSeconds` 活动引用、无旧示例 `2分20秒` 活动残留（本次变更的 plan/testing/log/audit 验证工件与历史留档除外）。

Exit Criteria:

- [x] 活动文档与真实实现一致。
- [x] `docs/testing/2026/08-21-timestamp-parse-compat-testing.md` 各方向均已确认或明确裁定。
- [x] `docs/logs/` 更新。

## Plan Audit

- Status: passed
- Reviewer / Agent: 冷回放代审计（reviewer availability = none；非 protected、非 high-risk）
- Evidence: `docs/audits/2026-08-21-plan-audit-timestamp-parse-compat.md`（VERDICT approved，无 BLOCKING / MAJOR；2 处措辞收紧已并入计划/测试文档）

## Closure Gates

- [x] in-scope behavior is complete
- [x] relevant docs are aligned
- [x] verification has run（`pnpm typecheck`、`pnpm build`、临时断言脚本 27 项全部通过）
- [x] corresponding `docs/testing/` document exists and every testing direction is confirmed passed or explicitly adjudicated out of scope
- [x] no in-scope item downgraded to deferred/follow-up
- [x] plan audit passed before implementation
- [x] micro-plan exception not applicable（4 个源码文件 + 多份文档、变更用户可见行为，full plan）
- [x] text consistency verified: status, phases, gates, testing document, and log all agree
- [x] closure audit was independent（冷回放代审计已记录）
- [x] closure evidence exists in files

## Deferred But Adjudicated

### 解析器对"毫秒段 <60 且与文档化解读同落在时长内"的固有歧义

- Classification: `watch-only residual`
- Why Not Blocking Closure: 当多个合法候选都落在视频时长内时优先文档化 `hh:mm:ss` 解读；这是模型输出本身的歧义，无法在无更多信息下消除。对短视频（本项目主流场景）文档化解读通常即正确意图。
- Successor Required: `no`

## Closure

Status Note: 三段式语义兜底已落地并验证通过：`timestamp.ts` 改为候选解析 + 时长择优，`FfmpegScreenshot.getVideoDuration` 公开复用，引擎探测时长后择优截图；内置提示词示例笔误已修正并显式允许 `mm:ss`。断言脚本 27/27 PASS、`pnpm typecheck`/`pnpm build` 通过，活动文档对齐，无 in-scope 项降级。

Closure Audit Evidence:

- Reviewer / Agent: 冷回放代审计（reviewer availability = none；非 protected、非 high-risk）
- Evidence: `docs/audits/2026-08-21-closure-audit-timestamp-parse-compat.md`（live diff 复核、断言脚本 27/27、typecheck/build 全绿、文档一致性、残留扫描边界核对后 approve closure）

Follow-up:

- 无（无降级项）。