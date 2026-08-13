# 2026-08-14 前端技术栈迁移：Vue 3 → React 19

> Plan Status: completed
> Last Reviewed: 2026-08-14
> Source: 用户直接需求——将 `packages/frontend` 由 Vue 技术栈改造为 React 19 + TypeScript + Zustand + antd，其余技术选型按社区最佳实践，全程自主执行并提交推送。
> Related: `docs/context/project-context.md`（Current Technical Baseline 需更新）、`docs/architecture/system-baseline.md`（Frontend Stack 段）、`docs/design/app-overview.md`（Web Frontend 行）、`docs/context/codebase-map.md`（Frontend 行）
> Audit: cold-replay（reviewer availability = none；本计划为前端框架替换，不改 auth/data-deletion/deployment 行为与契约，非 protected、非高风险）
> Testing: `docs/testing/2026/08-14-frontend-react-migration-testing.md`

## Current Baseline

- `packages/frontend/` 为 Vue 3 SPA：Vue 3.5 + vue-router 4 + Pinia 3 + PrimeVue 4 + Tailwind 4 + Vite 6 + vue-tsc。
- 8 个视图：`Home / Login / ParseResult / ParseResultList / VideoDetail / Downloading / AiSummaryTasks / Settings`，其中 `ParseResultList.vue`、`VideoDetail.vue`、`Downloading.vue`、`AiSummaryTasks.vue` 交互复杂（树表、分页、筛选、轮询、对话框）。
- `src/api/index.ts` 与 `src/types/index.ts` 为框架无关的 fetch 封装与 TS 契约，本次原样沿用。
- 本地存储 key：`bilibili-downloader-settings`、`bilibili-downloader-task-ids`（迁移后保持 key 不变，兼容既有用户数据）。
- 构建入口：`pnpm --filter @bilibili-downloader/frontend build`（Dockerfile:64 调用），产物 `dist/` → Docker runtime `public/`。Dockerfile 不随本次改动。
- 版本事实（npm registry，2026-08-14 核验）：react 19.2.8 / react-dom 19.2.8 / antd 6.6.0 / @ant-design/icons 6.3.2 / zustand 5.0.15 / @tanstack/react-query 5.101.4 / react-router 7.18.2 / vite 8.2.1 / @vitejs/plugin-react 6.0.5（vite ^8 peer 满足）/ @tailwindcss/vite 4.3.3（vite ^8 peer 满足）/ typescript 5.9.3（工作区其他包统一 ^5.7.0，取同线）/ node 本机 22.22.3（vite 8 engines 满足）。

## Goals

- `packages/frontend` 技术栈替换为：React 19 + TypeScript + Vite 8 + react-router 7（library 模式）+ Zustand（客户端状态）+ TanStack Query（服务端状态）+ antd 6（组件库）+ Tailwind 4（布局工具类保留）+ dayjs（日期）。
- 页面数量、路由路径、文案、交互行为与 Vue 版一一对应（逐页对照实现）。
- 保留本地存储 key 与 API 契约不变；`pnpm typecheck` / `pnpm build` / 全仓 `pnpm typecheck` 通过；Docker 构建入口（frontend build）不受影响。

## Non-Goals

- 不修改后端 API 契约、数据库、auth/删除/部署行为（三者均原样重实现或不受影响）。
- 不新增页面、不重构业务交互语义、不引入 SSR/测试框架/代码质量工具链。
- 不修改 Dockerfile 与 docker 包。
- 不回改历史文档（requirements/plans/testing 中的 .vue 引用为当时记录）。

## Infrastructure And Config Prereqs

- 无新 env、无数据迁移。依赖锁文件 `pnpm-lock.yaml` 将随 `pnpm install` 更新并随提交进入仓库（Docker `--frozen-lockfile` 依赖它）。
- Dockerfile 逐字不动；仅验证其调用的 `pnpm --filter @bilibili-downloader/frontend build` 成功（该命令即本计划 Phase 3 验证项）。

## Execution Plan

### Phase 1 - 包配置替换

Status: completed
Targets: `packages/frontend/package.json`、`packages/frontend/tsconfig.json`、`packages/frontend/vite.config.ts`、`packages/frontend/index.html`、`packages/frontend/env.d.ts`、`packages/frontend/src/assets/main.css`

- Item Types: `Fix`（配置替换），声明 `Fix-heavy`
- Prereqs: none

- [x] Fix: `package.json` 移除 vue/vue-router/pinia/primevue/@primevue/themes/lucide-vue-next/@vueuse/core/@vueuse/integrations/qrcode/vue-tsc/@vitejs/plugin-vue/clsx/tailwind-merge/class-variance-authority（cva 与 cn 均无消费方，见 Phase 0 grep 证据）；新增 dependencies：react、react-dom、react-router（v7）、antd、@ant-design/icons、zustand、@tanstack/react-query、dayjs；新增 devDependencies：@types/react、@types/react-dom、vite、@vitejs/plugin-react、typescript（^5.7.0 与工作区一致）、tailwindcss、@tailwindcss/vite。scripts：`dev` → `vite`；`build` → `tsc -p tsconfig.json && vite build`；`typecheck` → `tsc -p tsconfig.json`（移除 vue-tsc -b，避免 build 模式/tsbuildinfo 纠缠）；`preview` 保留不动（Phase 3 冒烟依赖）。
- [x] Fix: `tsconfig.json` 改为独立配置（不 extends 工作区 base，与现状一致）：`jsx: "react-jsx"`、移除 `jsxImportSource`、`types: ["vite/client"]`、`noEmit: true`、include 覆盖 `src/**/*.ts`、`src/**/*.tsx`、`env.d.ts`。
- [x] Fix: `vite.config.ts` 插件换为 `react()`（@vitejs/plugin-react）+ `tailwindcss()`（@tailwindcss/vite），保留 `@` alias 与 `/api → http://localhost:3100` proxy、端口 5173。
- [x] Fix: `index.html` 入口脚本 `/src/main.tsx`；`env.d.ts` 移除 `*.vue` 声明，仅保留 vite/client 引用。
- [x] Fix: `assets/main.css` 保留 `@import "tailwindcss";`，追加 antd v6 中文 locale 所需的 dayjs zh-cn 导入由 main.tsx 负责（CSS 文件不引 JS）。
- [x] Proof: `pnpm install` 成功且 lockfile 更新（Packages: +99 -87）；Phase 3 统一 typecheck/build 通过。

Exit Criteria:

- [x] 依赖与脚本替换完成，无 vue 生态依赖残留（`package.json` grep 验证）。
- [x] Docker 构建入口命令不变（`pnpm --filter @bilibili-downloader/frontend build`）。

### Phase 2 - 源码实现（stores / 路由 / 布局 / 8 页面）

Status: completed
Targets: `packages/frontend/src/{stores,router.tsx,App.tsx,main.tsx,pages/,api/,types/,lib/}`（`views/*.vue` 全部删除，由 `pages/*.tsx` 替代）

- Item Types: `Add` 为主（同构重写），声明 `Add-heavy`
- Prereqs: Phase 1

- [x] Add: `stores/settings.ts` —— zustand + `persist`（name `bilibili-downloader-settings`，默认值与 Pinia 版一致）；提供 `update(patch)` 原子更新；`load`/`save` 因 persist 自动持久化而不再需要（调用点不保留）。已知有意行为差异：Vue 版点"保存设置"才写 localStorage，React 版每次 `update()` 即自动落盘（持久化更即时，按钮仅保留反馈），闭核算按此核对。
- [x] Add: `stores/downloadQueue.ts` —— zustand + `persist`（name `bilibili-downloader-task-ids`）；`taskIds/addTaskId/addTaskIds/removeTaskId/clearFinished`；移除原版调试 console.log。
- [x] Add: **旧数据迁移**（计划审计修订项，两个 store 共用同一模式）——Pinia 版写入的是裸 JSON（settings = `AppSettings` 对象、task-ids = 裸数组），zustand `persist` 写入的是 `{state, version}` 信封，两者不兼容，直接换 persist 会让既有用户数据被静默重置。因此在各 store 模块加载时执行一次 `migrateLegacyStorage()`：读取旧 key，若解析结果不含 `state` 字段则判定为旧裸格式，一次性转写为 `{state:{settings: parsed}, version: 0}` / `{state:{taskIds: parsed}, version: 0}` 信封后由 persist 正常接管；含 `state` 字段（已是新格式）则跳过。失败静默忽略（catch 不抛）。
- [x] Add: **显式 merge**（实施期测试发现，Node mock localStorage 实测：persist 默认 merge 为顶层替换，`settings` 会被存储数据整体替换、丢失存储中不存在的默认字段）——两 store 的 persist 均补 `merge`：settings 字段级 `{...DEFAULT_SETTINGS, ...persisted.settings}`，taskIds `Array.isArray` 守卫；复测断言通过。
- [x] Add: `stores/auth.ts` —— zustand（不持久化）：`user/qrcodeUrl/qrcodeKey/loginStatus` + `checkLogin/startLogin/closeQrCode/logout/startPolling/stopPolling`，轮询语义与 Pinia 版一致（2s 间隔、confirmed 停止、expired 停止），`statusText` 导出保留。
- [x] Add: `api/index.ts`、`types/index.ts` —— 从 Vue 版原样迁移（框架无关）。
- [x] Add: `lib/utils.ts` —— 原 `cn` 无消费方，不迁移；目录与文件删除。
- [x] Add: `main.tsx` —— `createRoot` + `StrictMode`；`QueryClientProvider`（queries: retry 1、refetchOnWindowFocus false）；antd `ConfigProvider`（locale zh_CN、`token.colorPrimary: "#f43f5e"` 对齐玫瑰红品牌色、borderRadius 6）+ `App`（antd）；`dayjs/locale/zh-cn`；`RouterProvider`。
- [x] Add: `router.tsx` —— `createBrowserRouter`，父路由挂 App 布局，子路由 8 条 `lazy`（模块导出 `Component` 命名导出），路径与 Vue 版一致（`/`、`/parse-result`、`/parse-result/list`、`/video`、`/downloading`、`/summary-tasks`、`/settings`、`/login`）。
- [x] Add: `App.tsx` —— 布局等价 `App.vue`：顶部导航（首页/下载队列/AI 总结任务/设置 + 登录态头像），`onMounted(checkLogin)` → `useEffect`，`router-view` → `<Outlet/>`。
- [x] Add: `pages/Home.tsx` —— 输入 + 解析跳转 + 两个快捷入口；antd Input/Button。
- [x] Add: `pages/Login.tsx` —— 获取二维码（antd QRCode 组件替代 @vueuse useQRCode）、状态文案、过期重取、卸载停轮询（useEffect cleanup → stopPolling）。
- [x] Add: `pages/ParseResult.tsx` —— useQuery 调 `parseLink`，redirect 逻辑（user-space 渲染分组 / ugc-season / favorites / video → `/parse-result/list` 查询参数）逐条对齐 Vue 版。
- [x] Add: `pages/ParseResultList.tsx` —— 路由参数解析 4 种 list 类型；useQuery 按 `[type, 参数, page, pageSize]` 取数，queryFn 内先取列表再 `checkTasks` 合并 downloaded/queuedTaskId/autoSummaryEnabled；本地 state 承载选中/开关；加入队列（含子目录 Modal）、一键 AI 总结 4 分支、分页控件（antd Pagination，`type==='video'` 不渲染）、分组色条/当前视频高亮/时长格式化与 Vue 版一致。
- [x] Add: `pages/VideoDetail.tsx` —— 派生式 state 重写（不用可变树）：`videoInfo` 走 useQuery；`pageStates: Record<key, {resolved/downloaded/qualityList/audioQualityList/selectedQuality/selectedCodec/selectedAudio/selectedSubtitleLang}>`、`selectedKeys: Set<key>`、`selectedSectionId`；section 胶囊、全选/反选、展开式表格（antd Table tree data + 行内画质/编码/字幕 Select）、"解析当前页所有视频"、"加入下载队列"（默认子目录 = 合集标题/分区标题，Modal 确认）、已下载标记（checkTasks 入队去重）。key 格式与 Vue 版一致（`${sectionId}-${epCid}-${pageCid}` 与 `video-${bvid}-${cid}`）。
- [x] Add: `pages/Downloading.tsx` —— 列表 useQuery + 每行 `TaskRow` 子组件 useQuery `['task', id]` 并以 `refetchInterval` 函数按非终态 3s 轮询（终态停止），行数据以轮询结果覆盖列表快照；统计卡（进行中/已完成/失败）、状态过滤、每页条数、分页、暂停/恢复/取消/删除/AI 总结按钮语义逐条对齐。
- [x] Add: `pages/AiSummaryTasks.tsx` —— 筛选状态（status/search/updatedFrom/updatedTo）+ 分页统一为查询 key；antd Table 列对齐 Vue 版（标题/状态/模型/总结时间/执行耗时/更新时间/操作）；"查看原始" Modal（加载中/错误/内容/空态/失败回退文案 + completed 时"重新构建总结"）；删除/重新总结/删除时进行中禁用语义对齐。
- [x] Add: `pages/Settings.tsx` —— 下载目录展示 + 复制（navigator.clipboard）+ 来源标记；自动操作/画质/编码/音频质量/文件名模板/附加内容表单（antd Switch/Select/Input）；"保存设置"按钮保留（persist 已自动落盘，按钮仅反馈"已保存 ✓"）；`getDownloadConfig` 走 useQuery。
- [x] Proof: Phase 3 的 typecheck/build 全绿。

Exit Criteria:

- [x] 8 个页面 + 布局 + 路由 + 3 store 完成；`.vue` 源文件零残留（glob 验证 `src/**/*.vue` 为空）。
- [x] 路由路径、localStorage key、API 调用、交互分支与 Vue 版逐条对应（对照表见闭核算阶段逐项核对）。

### Phase 3 - 依赖安装与构建验证

Status: completed
Targets: `pnpm-lock.yaml`、`packages/frontend/dist/`

- Item Types: `Fix`（lockfile 与构建产出）
- Prereqs: Phase 1–2

- [x] Proof: `pnpm install`（lockfile 更新，Packages: +99 -87，postinstall FFmpeg 检查通过）；`pnpm --filter @bilibili-downloader/frontend typecheck` 零错误；`pnpm --filter @bilibili-downloader/frontend build` 成功（1557 modules，按路由懒加载分块）；全仓 `pnpm typecheck` 5 包全部 Done；`vite preview --port 4173` 冒烟：`/` 200、SPA 深链 `/downloading` 200、主 bundle 200；`dist/assets/*.js` grep 无 vue 运行时残留；store 迁移 + rehydrate Node mock localStorage 实测断言全部通过。

Exit Criteria:

- [x] typecheck/build/preview 全部通过；`dist/` 产物存在且无 vue 字样（grep 验证）。

### Phase 4 - 基线文档同步与闭核算

Status: completed
Targets: `docs/context/project-context.md`、`docs/context/codebase-map.md`、`docs/architecture/system-baseline.md`、`docs/design/app-overview.md`、`docs/logs/2026/08-14.md`、`docs/audits/2026-08-14-closure-audit-frontend-react-migration.md`、`docs/testing/2026/08-14-frontend-react-migration-testing.md`

- Item Types: `Fix`（文档对齐）
- Prereqs: Phase 1–3

- [x] Fix: project-context `Current Technical Baseline` 前端行改为 React 19 + Vite + TypeScript（补充 Zustand/antd/TanStack Query）；验证命令不变。
- [x] Fix: codebase-map Frontend 行更新（React 19 SPA + 状态管理/组件库说明），Last Verified 2026-08-14。
- [x] Fix: system-baseline `Frontend Stack` 与 `State Management Approach` 前端行改为 React 19 + antd + Zustand + TanStack Query。
- [x] Fix: app-overview Web Frontend 行 runtime 改 React 19 SPA，导航模型 vue-router → react-router。
- [x] Fix: logs 2026/08-14 追加本次迁移记录（短、dated、append-only）。
- [x] Proof: 对照计划逐项 cold-replay 核对真实 diff（config / stores / pages / lockfile / docs）；typecheck + build 结果复核；`docs/testing/2026/08-14-frontend-react-migration-testing.md` 各方向 passed 或显式 adjudicated out of scope（D6 运行级 UI 交互留用户手动验证）。

Exit Criteria:

- [x] 基线文档与实现一致；闭核算文件与测试文档就位。

## Plan Audit

- Status: passed（首轮 NEEDS REVISION → 修订并入 → 复核通过）
- Reviewer / Agent: 独立 subagent（general，agent `General_7616457`）+ cold-replay 复核
- Evidence: 见 `docs/audits/2026-08-14-plan-audit-frontend-react-migration.md`；独立审计 8 项核查 7 项 PASS、1 项问题——zustand `persist` 信封（`{state,version}`）与旧版裸 JSON 存储不兼容会导致既有用户设置与队列 task-ids 被静默重置，已按修订并入 Phase 2（`migrateLegacyStorage()` 旧格式转写）。其余非阻塞提示已并入本计划：保留 `preview` script；StrictMode 下 Login 轮询 effect 双执行由 store 内 `startPolling` 先 `stopPolling` 的自愈设计吸收（dev 仅多一次请求）；antd v6（6.3+）size 枚举统一为 `large/medium/small`，代码中避免 `middle` 与 `bordered`（用 `variant`）；Tailwind v4 preflight 与 antd 观感冲突留实现期/运行级验证；设置自动落盘为有意行为差异（见 Phase 2）。

## Closure Gates

- [x] in-scope behavior is complete
- [x] relevant docs are aligned
- [x] verification has run（`pnpm typecheck` + `pnpm --filter @bilibili-downloader/frontend build` + preview 冒烟 + store 迁移 Node 实测）
- [x] corresponding `docs/testing/2026/08-14-frontend-react-migration-testing.md` 存在且各方向 confirmed passed 或 adjudicated out of scope
- [x] no in-scope item downgraded to deferred/follow-up
- [x] plan audit passed before implementation
- [x] cold-replay 真实 diff 核对（文件/行数）
- [x] text consistency verified（status、phases、gates、testing、log 一致）
- [x] closure audit independent（独立 subagent）
- [x] closure evidence exists in files

## Deferred But Adjudicated

（无）

## Closure

Status Note: 四个阶段全部完成。`packages/frontend` 由 Vue 3 + Pinia + PrimeVue 迁移为 React 19 + react-router 7 + Zustand + TanStack Query + antd 6 + Tailwind 4 + Vite 8 + TS 5.9；8 条路由路径、localStorage key、API 契约保持不变；3 个 zustand store 完成旧裸格式数据迁移（`migrateLegacyStorage`）与显式 merge 修复；`pnpm --filter @bilibili-downloader/frontend typecheck`、`pnpm build`、全仓 `pnpm typecheck`、`vite preview` 冒烟（根路径/SPA 深链/bundle 200）全部通过；dist 无 vue 残留；store 迁移 + rehydrate Node mock localStorage 实测断言全部通过。运行级 UI 交互（浏览器）留用户手动验证（testing D6 adjudicated）。Dockerfile 逐字未动，其前端构建入口验证通过。

Closure Audit Evidence:

- Reviewer / Agent: 独立 subagent + cold-replay 复核
- Evidence: 见 `docs/audits/2026-08-14-closure-audit-frontend-react-migration.md`；对照计划逐条核对真实 diff（package.json / tsconfig / vite.config / 3 store / router / App / 8 pages / lockfile / 4 份基线文档）；`.vue` 源文件零残留；typecheck/build/preview/store 实测证据复核。

Follow-up:

- 无。
