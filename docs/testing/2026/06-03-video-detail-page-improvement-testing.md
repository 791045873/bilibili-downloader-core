# 视频解析页面优化测试方向

> Status: pending
> Plan: `docs/plans/2026-06-03-video-detail-page-improvement-plan.md`
> Source Requirement: `docs/requirements/2026-06-02-video-detail-page-improvement.md`
> Last Reviewed: 2026-06-03

## Scope

本文档记录当前 Plan 对应的需求级测试方向。它不是单元测试代码，也不是详细执行脚本；每一项只描述应观察到的需求状态和不应出现的反状态。

本文件只覆盖需求级可观察状态与反状态。文档同步、日志更新、feature inventory 状态、Plan/Testing/Log 文本一致性、Plan Audit 和 Closure Audit 证据由 Plan 的 Closure Gates 与 Closure Audit 单独验证。

## Environment Notes

- Frontend: Vue 3 + Vite + TypeScript
- Backend: NestJS + TypeScript
- Database: SQLite（better-sqlite3，通过 server 包管理）
- Verification commands from project context:
  - `pnpm typecheck`
  - `pnpm build`
  - 手动运行前端：`pnpm frontend:dev`
  - 手动运行后端：`pnpm --filter @bilibili-downloader/server start:dev`
- Current automated E2E/integration test command: `none`

## Testing Directions

### 1. Section 选择器仅展示当前 section

- Requirement / Change Covered: 新增 section 胶囊选择器，替代一次性展示所有 section。
- Should Be Observable:
  - 页面加载有合集视频时，用户能看到按原顺序排列的 section 胶囊按钮。
  - 默认选中第一个 section，页面只展示该 section 下的视频内容。
  - 切换到其他 section 后，页面内容随所选 section 更新。
- Should Not Be Observable:
  - 页面同时展开多个 section 的视频列表。
  - 胶囊按钮顺序与原视频合集顺序不一致。
  - 切换 section 后仍显示旧 section 的内容。
- Status: pending
- Evidence: 待执行后记录。

### 2. 无合集视频不显示 section 选择器

- Requirement / Change Covered: 当视频无合集时，隐藏 section 选择器并直接展示默认视频内容。
- Should Be Observable:
  - 无合集视频进入解析页面后，用户直接看到可解析的视频内容。
  - 页面没有多余的 section 胶囊选择区域。
- Should Not Be Observable:
  - 无合集视频仍显示一个无意义的 section 胶囊按钮。
  - 因缺少合集数据导致页面空白、报错或无法继续解析。
- Status: pending
- Evidence: 待执行后记录。

### 3. 视频表格选择列语义清晰

- Requirement / Change Covered: 视频表格第一列 header 文案修正。
- Should Be Observable:
  - 用户能从第一列表头明确理解该列用于选择视频。
- Should Not Be Observable:
  - 第一列表头仍使用含义过短或不清晰的文案。
  - 表头文案与该列实际交互用途不一致。
- Status: pending
- Evidence: 待执行后记录。

### 4. 解析当前页所有视频

- Requirement / Change Covered: “解析选中”调整为“解析当前页所有视频”。
- Should Be Observable:
  - 用户不需要先勾选视频，也能一键解析当前可见范围内所有尚未解析且可解析的视频。
  - 有合集时，“当前页所有视频”等同于当前选中 section 中可见的视频。
  - 无合集时，“当前页所有视频”等同于默认展示的视频内容。
  - 解析过程中有明确的处理中状态，并避免重复触发。
  - 解析完成后，当前可见范围内的视频展示可用画质、编码或对应结果状态。
- Should Not Be Observable:
  - 按钮仍只解析已勾选的视频。
  - 有合集时，点击后解析了非当前 section 的视频。
  - 重复点击导致重复请求、状态混乱或页面不可恢复。
- Status: pending
- Evidence: 待执行后记录。

### 5. 后端任务状态批量查询支撑入队判定

- Requirement / Change Covered: 新增按 `bvid + cid` 批量查询任务状态的后端能力，支撑前端已入队判定和 24 小时复用规则。
- Should Be Observable:
  - 后端支持按多个 `bvid + cid` 一次性查询任务状态。
  - 查询结果能让调用方识别每个匹配视频的 `bvid`、`cid`、任务状态和创建时间。
  - 查询多个视频时，每个有匹配任务的视频都能得到对应状态；没有匹配任务的视频不会被错误报告为已存在。
  - 同一 `bvid + cid` 存在多条历史任务时，查询结果以最新创建的任务为准。
  - 前端页面的已入队状态来自后端持久任务查询，而不是仅来自当前浏览器会话。
- Should Not Be Observable:
  - 批量查询只能处理单个视频，或多个视频时遗漏/混淆结果。
  - 查询结果缺少状态或创建时间，导致无法判断 24 小时复用规则。
  - 同一 `bvid + cid` 有多条任务时使用旧记录导致错误判定。
  - 刷新页面或重新进入页面后，仅因本地会话状态丢失而无法识别已入队视频。
- Status: pending
- Evidence: 待执行后记录。

### 6. 已入队与可复用状态判定完整

- Requirement / Change Covered: 基于后端持久任务判定已入队状态，避免重复加入下载队列，并允许 24 小时后复用已完成任务。
- Should Be Observable:
  - 后端没有匹配任务的视频在页面中保持可选状态。
  - 已存在且状态不是已完成的同一 `bvid + cid` 视频呈现已入队状态，并不可再次选中加入队列。
  - 已完成但创建时间距今不超过 24 小时的同一 `bvid + cid` 视频呈现已入队状态，并不可再次选中加入队列。
  - 已完成且创建时间早于当前时间 24 小时以上的同一 `bvid + cid` 视频允许用户重新选择并加入队列。
  - 用户本次选中 A、B 并成功加入下载队列后，A、B 在当前页面转为“已选中但禁用”状态：已选中表示已经加载到队列，禁用表示不能再次选中或取消选中以重复操作。
- Should Not Be Observable:
  - 没有后端匹配任务的视频被错误展示为已入队且不可选。
  - 已入队视频仍可被重复勾选、取消勾选或重复加入队列。
  - 已完成超过 24 小时的视频仍被永久禁止重新加入。
  - 已完成但未超过 24 小时的视频被提前允许重新加入。
  - 本次入队成功后，刚加入的 A、B 仍保持普通可选状态，允许用户立即重复提交。
- Status: pending
- Evidence: 待执行后记录。

### 7. 加入下载队列后停留在当前解析页面

- Requirement / Change Covered: 入队完成后不自动跳转到下载队列页面。
- Should Be Observable:
  - 用户确认加入下载队列后仍停留在当前视频解析页面。
  - 当前 section、解析结果和页面上下文保持可继续操作。
  - 入队成功后，刚加入的视频呈现已入队/不可重复操作状态。
- Should Not Be Observable:
  - 加入成功后自动跳转到 `/downloading`。
  - 入队成功后页面上下文被意外清空，导致用户无法继续处理当前视频。
  - 入队成功后用户能立即对同一批视频重复执行加入队列操作。
- Status: pending
- Evidence: 待执行后记录。

### 8. 加入下载队列前确认目录

- Requirement / Change Covered: 点击加入下载队列时弹出目录确认/修改弹框。
- Should Be Observable:
  - 用户点击加入下载队列后，先看到目录确认/修改弹框。
  - 弹框默认目录符合当前 section；无合集时默认目录符合当前视频标题。
  - 用户修改目录后，本次加入队列使用修改后的目录。
- Should Not Be Observable:
  - 用户未确认目录就直接加入下载队列。
  - 修改后的目录未生效，仍使用旧目录或空目录。
  - 弹框混入跨 section 的目录选择语义。
- Status: pending
- Evidence: 待执行后记录。

### 9. 空目录被前后端阻止

- Requirement / Change Covered: 目录不能为空，前端和后端均应阻止。
- Should Be Observable:
  - 用户在目录弹框输入空目录时，前端阻止提交并给出可理解提示。
  - 绕过前端直接请求创建下载任务时，后端以 HTTP 400 拒绝空目录。
  - 缺少 `bvid`、`cid` 或 `title` 等必填字段时，也以一致的 400 校验错误处理。
- Should Not Be Observable:
  - 空目录任务被创建成功。
  - 空目录或缺少必填字段返回 HTTP 200 且只在响应体中包含错误。
  - 前端错误提示后仍继续提交创建任务。
- Status: pending
- Evidence: 待执行后记录。

### 10. 入队失败时页面可恢复

- Requirement / Change Covered: 加入队列失败时页面不跳转，并展示错误或保留可重试状态。
- Should Be Observable:
  - 入队失败后用户仍停留在当前解析页面。
  - 用户能看到失败提示，或至少能继续修改目录/重试。
  - 已选择的视频状态不会变成不可恢复的中间状态。
- Should Not Be Observable:
  - 入队失败后跳转到下载队列页面。
  - 页面静默失败，没有提示且用户无法判断是否成功。
  - 失败后选择状态、解析结果或目录弹框进入不可恢复状态。
- Status: pending
- Evidence: 待执行后记录。

### 11. 非目标范围保持不变

- Requirement / Change Covered: 不修改 Core、CLI、Docker、认证/login、跨页面下载管理能力、整体 Web UI，且去重仅以 `bvid + cid` 为唯一标识。
- Should Be Observable:
  - 当前改动只影响视频解析页面、相关前端入队交互和必要后端任务查询/校验行为。
  - CLI、Docker 部署形态、Core 下载逻辑和认证/权限语义保持现有状态。
  - 同一 `bvid + cid` 的入队判定不因画质或编码不同而被视为不同视频。
- Should Not Be Observable:
  - CLI 行为、Docker 配置、Core 下载流程或认证/权限行为出现与本需求无关的变化。
  - 下载管理页面新增未经本 Plan 定义的跨页面实时同步能力。
  - 整体 Web UI 被重新设计，超出视频解析页面优化范围。
  - 用户通过选择不同画质或编码绕过同一 `bvid + cid` 的已入队限制。
- Status: pending
- Evidence: 待执行后记录。

### 12. 项目级验证命令

- Requirement / Change Covered: 计划要求 `pnpm typecheck` 通过。
- Should Be Observable:
  - `pnpm typecheck` 在当前仓库状态下通过。
  - 如执行 `pnpm build`，应记录通过或失败原因。
- Should Not Be Observable:
  - 未实际运行命令却记录为通过。
  - 将已失败的命令写入 known-good baseline 的 `Commands Passed`。
- Status: pending
- Evidence: 待执行后记录。

## Closure Requirement

关闭当前 Plan 前，本文件中每个测试方向必须满足以下之一：

- `Status: passed`，并记录实际证据。
- `Status: out of scope`，并记录明确原因和责任归属。

任何仍为 `pending` 或 `failed` 的测试方向都会阻止 Closure Audit 通过。
