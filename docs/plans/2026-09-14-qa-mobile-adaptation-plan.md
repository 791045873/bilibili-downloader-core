# 2026-09-14 QA 穿搭问答页移动端适配（含共享顶栏壳层）

> Plan Status: planned
> Last Reviewed: 2026-09-14
> Source: `docs/requirements/2026-09-14-qa-mobile-adaptation.md`
> Related: `docs/requirements/2026-09-09-rag-chat-service.md`（QA 页功能基线）
> Audit: required
> Testing: `docs/testing/2026/09-14-qa-mobile-adaptation-testing.md`

## Current Baseline

- `/qa` 路由懒加载 `packages/frontend/src/pages/QaChat.tsx`，在 `packages/frontend/src/App.tsx` 壳内渲染，属全宽页面集合 `FULL_WIDTH_PATHS`（`App.tsx:20`）。
- QA 页为桌面双栏：左侧固定 `w-64` 会话列表 + 右侧聊天区，根容器 `flex gap-4 h-[calc(100vh-7.5rem)]`（`QaChat.tsx:183-184`）；消息滚动区在 `QaChat.tsx:231`（`flex-1 overflow-auto p-4 space-y-4`），底部输入区在 `QaChat.tsx:261`（`border-t border-zinc-200 p-3`）。
- 消息渲染使用固定百分比/固定像素宽度：用户气泡 `max-w-[70%]`（`QaChat.tsx:335`）、助手 `max-w-[85%]`（`QaChat.tsx:343`）、用户照片固定 `width={120}`（`QaChat.tsx:326`）、回复图片卡片 `w-40`（`QaChat.tsx:350`）。
- 回车直接发送（`QaChat.tsx:293-298`，Shift+回车换行）；待发照片 chip 无换行（`QaChat.tsx:262-270`）；会话删除为 `size="small"` 图标按钮（`QaChat.tsx:216-222`）。
- 共享顶栏为 `h-14` + 横向导航（logo + 5 导航项 + 登录），无折叠（`App.tsx:34-75`）；`main` 为 `px-4 py-6`（`App.tsx:76`）。
- `index.html` 视口仅 `width=device-width, initial-scale=1.0`，无 `viewport-fit`；全局 `src/assets/main.css` 仅含 Markdown 预览样式。
- 全仓库无移动端断点/抽屉/动态视口/安全区处理（仅 `Home.tsx:78`、`ParseResult.tsx:250` 使用 `md:grid-cols-2`）。
- 另有一处视口高度耦合需纳入回归面：`AiSummaryTasks.tsx:886` 使用 `max-h-[calc(100vh-150px)]`（全屏总结预览弹窗）。
- 缺口：`100vh` + 硬编码 `7.5rem`（实际顶栏 3.5rem + `main` `py-6` 3rem = 6.5rem，存在 1rem 偏差）、固定 `w-64` 侧栏、顶栏导航无折叠、无安全区/软键盘适配、触屏触控目标偏小、回车误发风险。

## Goals

- 使 `/qa` 在常见竖屏手机（约 360–430px 宽）上布局可用、输入可操作、内容不溢出。
- 使共享顶栏在窄屏可折叠，保证 QA 入口可达，且其他页面不回归。
- 保持桌面端（≥768px）QA 页布局与顶栏行为不变（助手回复示例图形态按下方 Decision 在两端统一更新，不属于桌面端布局重设计）。
- 不改动后端/API/数据模型/鉴权/部署。

## Non-Goals

- 其他页面（下载队列、AI 总结、设置、提示词）的内容布局重设计。
- PWA/离线/原生封装。
- 回答流式化、三段式结构、照片上传语义变更。
- 桌面端布局/顶栏视觉重设计（助手回复示例图形态调整除外）。
- 全屏查看器的自定义滑动手势（左右滑动切换）；仅用内置切换按钮/键盘方向键。

## Infrastructure And Config Prereqs

- No infra prereqs beyond existing baseline.
- 不新增依赖：移动端抽屉与断点判定复用仓库现有 antd 6（Drawer/Grid）与 Tailwind 4 能力。
- 无数据迁移、无回滚脚本需求。
- 保护区域：本次不涉及 auth/权限、数据删除、支付、部署，均不改动；登录入口仅位置移入抽屉，登录逻辑与鉴权行为不变。

## Execution Plan

### Phase 1 - 全局视口与安全区基线

Status: planned
Targets: `packages/frontend/index.html`, `packages/frontend/src/assets/main.css`

- Item Types: `Add`
- Prereqs: none

- [ ] `Add`: 更新视口配置，支持安全区适配与虚拟键盘交互模式，保证动态视口高度语义可用。
- [ ] `Add`: 在全局样式中补充动态视口/安全区基础能力（供壳层与 QA 页消费），并保持既有 Markdown 预览样式不变。
- [ ] `Add`: 设置 `theme-color` 为品牌色 `#f43f5e`。
- [ ] `Proof`: 运行 `pnpm typecheck`、`pnpm build`；在窄屏目测动态视口与安全区变量生效。链接 `docs/testing/2026/09-14-qa-mobile-adaptation-testing.md` 对应方向。

Exit Criteria:

- [ ] 全局基线不影响桌面端渲染，`pnpm typecheck`、`pnpm build` 通过。
- [ ] 安全区/动态视口基础能力可被后续相位复用。
- [ ] No owner-doc update required（本相位不产生用户可见行为变更，由 Phase 4 汇总更新）。
- [ ] `docs/logs/` 记录本相位进展。

### Phase 2 - 共享顶栏壳层响应式与高度模型

Status: planned
Targets: `packages/frontend/src/App.tsx`, `packages/frontend/src/assets/main.css`

- Item Types: `Add | Fix | Decision`
- Prereqs: Phase 1

- [ ] `Decision`: 窄屏顶栏折叠采用"汉堡 + Drawer"（用户 2026-09-14 已确认）。选择理由：改动面小、与 QA 会话抽屉模式一致、不新增常驻布局。备选：底部 Tab 栏（更接近原生，但需重排全部导航、改动更大）。残余风险：抽屉需一次额外点击才能到达导航项。
- [ ] `Add`: 窄屏（`< 768px`）将导航折叠为汉堡入口 + 抽屉，抽屉内可到达全部导航项与登录入口，选中后关闭。
- [ ] `Fix`: 顶栏在窄屏保持固定高度不换行；`≥ 768px` 顶栏与导航保持现有横向行为不变。
- [ ] `Decision`: 高度模型采用"壳层暴露顶栏实测高度变量（含顶部安全区） + QA 页局部消费动态视口高度"，不把其他全宽页切到壳层固定高度。选择理由：QA 是唯一底部锚定输入区的页面，局部改动回归面最小。计算式：动态视口 − 顶栏实测高度 − `main` 垂直内边距 − 底部安全区；顺带修正现有 `7.5rem` 与实际 `6.5rem`（3.5rem + 3rem）的偏差。备选：全宽页统一改为壳层固定高度（更一致，但会改变 `/downloading`、`/summary-tasks` 及 `AiSummaryTasks.tsx:886` 的滚动行为，回归面更大）。残余风险：依赖顶栏实测值，测量时序与横竖屏切换需覆盖。软键盘策略随本决策定稿：Android 用 `interactive-widget=resizes-content` + 动态视口，iOS 用 `visualViewport` 事件调整可视高度。
- [ ] `Fix`: 保证共享顶栏改动后，首页/下载队列/AI 总结/提示词/设置/登录页面在窄屏与桌面均可正常打开，无布局回归。
- [ ] `Proof`: `pnpm typecheck`、`pnpm build`；窄屏逐页目测导航可达性与无横向溢出；桌面端目测无差异。链接 testing 文档对应方向。

Exit Criteria:

- [ ] 窄屏顶栏不溢出、可展开抽屉并到达全部导航项；桌面顶栏与改造前一致。
- [ ] 其他页面在窄屏与桌面均可正常打开，无回归（含下载队列/AI 总结列表的滚动可用）。
- [ ] 决策项已记录选择、备选与残余风险。
- [ ] 相关 owner doc 更新（由 Phase 4 统一执行，本相位如产生基线变化则同步 `docs/design/app-overview.md`）。
- [ ] `docs/logs/` 记录本相位进展。

### Phase 3 - QA 页移动端改造

Status: planned
Targets: `packages/frontend/src/pages/QaChat.tsx`, `packages/frontend/src/App.tsx`（消费 Phase 1/2 的全局能力）

- Item Types: `Add | Fix | Decision`
- Prereqs: Phase 1, Phase 2

- [ ] `Decision`: 窄屏首屏落点采用"自动选中最近会话直接进入聊天 + 会话列表抽屉入口"。选择理由：与桌面一致、保持会话连续性。备选：进入后先展示会话列表（更接近 IM 列表首页，但与桌面不一致且多一次点击）。残余风险：新用户可能需先理解抽屉入口，用明确按钮文案缓解。
- [ ] `Add`: 以 `768px` 为单一断点，`< 768px` 时 QA 页切换为单列；会话列表移入 `Drawer`，提供"会话列表"入口，选中会话后抽屉关闭，当前会话高亮。
- [ ] `Fix`: 聊天容器与底部输入区适配动态视口与安全区；消息区内部滚动，滚到最新不引起整页跳动；软键盘弹收后输入区仍可见可操作。
- [ ] `Fix`: 导航栏状态与抽屉在会话新建/删除/切换后保持正确（列表即时更新、删除二次确认、切换回退合理）。
- [ ] `Fix`: 输入区窄屏紧凑化，照片/发送控件改为图标形态且触控目标足够；文本域可用宽度不被过度挤压。
- [ ] `Fix`: 回车语义按指针粒度区分——粗指针回车换行、按钮发送；细指针保持回车发送、Shift+回车换行。残余风险：触屏笔记本可能上报粗指针而按触屏语义处理（可接受）。
- [ ] `Decision`: 助手回复示例图改为"横向并排缩略图条 + 全屏查看器（点击放大、左右切换）"，缩略图不显示文字、全屏显示 `tipTitle`/`caption`，桌面与移动端采用同一形态（用户 2026-09-14 确认）。选择理由：缩略图更紧凑、不占纵向空间；全屏复用 antd `Image.PreviewGroup` 内建的放大与左右切换（已核实 antd 6.6.0 提供 `Image.PreviewGroup`，单图自动隐藏左右切换），不引入新依赖。切换方式为内置左右按钮/键盘方向键，**不含左右滑动手势**（安装版预览仅按钮/键盘导航，滑动手势需自研，已列入 Non-Goals）。备选：保留带标题的固定卡片（窄屏每行仅 1 张、较重）、单张大图 + 数量角标（信息量不足）。残余风险：全屏查看器需适配底部安全区；`items` 不携带 caption，需按 `onChange` 索引映射当前图标题/说明；此为对已通过审计计划的用户可见方案细化（Phase 3 范围内，无契约/跨界面边界变化），已记录于本项。
- [ ] `Fix`: 助手回复示例图替换为横向缩略图条 + 全屏查看器（同一条回答的图片为一组，用 `Image.PreviewGroup`）；缩略图不显示文字，全屏展示当前图技巧标题与说明；切换用内置左右按钮/键盘方向键，单张时无左右切换；缩略图/全屏加载失败保留占位降级；缩略图 key 用索引避免同 URL 重复冲突。
- [ ] `Fix`: 待发照片 chip 支持换行；用户照片、视频来源、长文本在窄屏不横向溢出且自适应宽度。
- [ ] `Fix`: 会话删除等交互控件在触屏下触控目标不小于约 44px，保留二次确认。
- [ ] `Proof`: `pnpm typecheck`、`pnpm build`；按 device matrix 手工验证移动端全流程（进入/切换/新建/删除、文本问答、照片问答、三段式渲染与来源跳转、空/载/错态、键盘与安全区）。链接 testing 文档全部方向。

Exit Criteria:

- [ ] 窄屏 QA 页单列可用，抽屉会话管理完整；桌面双栏与改造前一致（助手回复示例图按新形态更新除外）。
- [ ] 软键盘、安全区、横竖屏、系统大字体、长文本/图片溢出、回复图片加载失败降级、照片上限禁用态场景均通过（对应 testing 文档 D5–D9、D12–D14）。
- [ ] 助手回复示例图横向缩略图条 + 全屏左右切换通过（含缩略图无文字、全屏显示标题/说明、单张无切换、加载失败降级；对应 testing 文档 D18）。
- [ ] 既有 QA 功能在移动端行为不变（含空/载/错态、删除二次确认、来源 `?t=` 跳转）。
- [ ] 决策项已记录选择、备选与残余风险。
- [ ] `docs/design/app-overview.md` 的"穿搭问答（Web）"与导航模型描述更新为包含移动端行为。
- [ ] `docs/logs/` 记录本相位进展。

### Phase 4 - 文档、测试方向与闭合

Status: planned
Targets: `docs/testing/2026/09-14-qa-mobile-adaptation-testing.md`, `docs/design/app-overview.md`, `docs/context/codebase-map.md`, `docs/context/project-context.md`, `docs/backlog/README.md`, `docs/logs/`

- Item Types: `Proof | Add`
- Prereqs: Phase 1–3

- [ ] `Proof`: 确认 testing 文档已存在，且每条测试方向均有 `passed` 或带理由的 `out of scope` 记录。
- [ ] `Add`: 更新 `docs/design/app-overview.md`（移动端 QA 行为、顶栏导航模型）与 `docs/context/codebase-map.md`（Frontend 行 Last Verified/注记）。
- [ ] `Add`: 更新 `docs/context/project-context.md`（active requirement/plan 指向本工作，完成后回填现状）与 `docs/backlog/README.md`（记录其他页面移动端适配为后续候选）。
- [ ] `Add`: 写入 `docs/logs/` 聚合日志（含验证命令与证据）。
- [ ] `Proof`: 执行 `pnpm typecheck`、`pnpm build` 并记录输出；整理手工设备矩阵证据。
- [ ] `Proof`: 独立 closure audit（优先独立 subagent）。本计划非保护区域，若独立 reviewer 不可得，允许按政策使用"与执行期上下文隔离的 cold-replay"自检并记录证据与限制；若实施中发现未解决的产品风险，则不得用 cold-replay 替代，门禁保持开放。

Exit Criteria:

- [ ] testing 文档所有方向已确认或带理由出界。
- [ ] owner doc / codebase-map / project-context / backlog / log 全部更新。
- [ ] `pnpm typecheck`、`pnpm build` 通过且有记录。
- [ ] closure audit 独立完成或按政策记录限制并保持门禁。
- [ ] `docs/logs/` 聚合日志已写入。

## Plan Audit

- Status: passed
- Reviewer / Agent: 独立 subagent（两轮：首轮 `needs revision`，修订后复审 `pass`）；另有针对回复示例图细化的聚焦复审（`needs revision` → 按修复项修订）
- Evidence: `docs/audits/2026-09-14-plan-audit-qa-mobile-adaptation.md`（首轮 task `ses_f60f8fc64ffeXOINeSFtYJ0BZO`；复审 task `ses_f60f607ebffe2WHMKpGjo6PkeP`；聚焦复审 task `ses_f60e7bfd4ffeEpYsaUOEYolc1N`）
- Post-audit refinement: 回复示例图细化（2026-09-14）已记录于 Phase 3 Decision/Fix 与 Non-Goals，聚焦复审两项阻断（桌面范围矛盾、滑动手势不可用）已按修复项修订：统一"桌面与移动端同形态"、明确切换仅内置按钮/键盘、滑动列入 Non-Goals。

## Closure Gates

- [ ] in-scope behavior is complete
- [ ] relevant docs are aligned
- [ ] verification has run（`pnpm typecheck`、`pnpm build` + 手工移动端设备矩阵，视觉/UX 型结果面，按计划自定义门禁）
- [ ] corresponding `docs/testing/` document exists and every testing direction is confirmed passed or explicitly adjudicated out of scope
- [ ] no in-scope item downgraded to deferred/follow-up
- [x] plan audit passed before implementation（`docs/audits/2026-09-14-plan-audit-qa-mobile-adaptation.md`，2026-09-14）
- [ ] micro-plan exception not applicable（本计划为跨界面变更，须完整审计）
- [ ] text consistency verified: status, phases, gates, testing document, and log all agree
- [ ] closure audit was independent（或按政策记录限制）
- [ ] closure evidence exists in files

## Deferred But Adjudicated

### 其他页面的移动端内容适配（下载队列/AI 总结/设置/提示词）

- Classification: `out-of-scope improvement`
- Why Not Blocking Closure: 本次范围经用户确认为 QA 页 + 共享顶栏壳层；其他页面仅需不因壳层改动回归，内容级移动端重设计不在本次。
- Successor Required: `yes`（条件：用户提出对其他页面做移动端适配时，另立需求与计划；已记入 backlog 候选）

## Closure

Status Note: 待实施与闭合后填写。

Closure Audit Evidence:

- Reviewer / Agent: 待回填
- Evidence: 待回填

Follow-up:

- 待实施后按需填写非阻塞项。
