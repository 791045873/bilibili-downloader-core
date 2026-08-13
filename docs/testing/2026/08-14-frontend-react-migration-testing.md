# Testing - 2026-08-14 前端技术栈迁移：Vue 3 → React 19

## Meta

- Plan: `docs/plans/2026-08-14-frontend-react-migration-plan.md`
- Date: 2026-08-14
- 验证范围：包配置替换、源码重写、依赖安装、类型检查、构建、preview 冒烟、localStorage 迁移逻辑

## Directions

### D1 依赖与脚本替换

- Status: passed
- Evidence: `packages/frontend/package.json` grep 无 vue/vue-router/pinia/primevue/@vueuse/lucide-vue-next/qrcode/vue-tsc/@vitejs/plugin-vue/clsx/tailwind-merge/class-variance-authority 残留；dependencies 为 react 19.2.x、react-router 7、antd 6.6.0、@ant-design/icons 6.3.2、zustand 5、@tanstack/react-query 5、dayjs；scripts 为 `dev`/`build`（tsc + vite build）/`preview`/`typecheck`。

### D2 类型检查

- Status: passed
- Evidence: `pnpm --filter @bilibili-downloader/frontend typecheck`（tsc -p）零错误；全仓 `pnpm typecheck`（core/adapters/server/sdk/frontend 5 包）全部 Done。

### D3 构建

- Status: passed
- Evidence: `pnpm --filter @bilibili-downloader/frontend build` 成功，1557 modules transformed，`dist/` 产出含按路由懒加载分块（Home/ParseResult/ParseResultList/VideoDetail/Downloading/AiSummaryTasks/Settings/Login 各自 chunk）。该命令即 Dockerfile:64 的构建入口，入口命令未变、产物目录 `dist/` 未变。

### D4 preview 冒烟

- Status: passed
- Evidence: `vite preview --port 4173`：`/` HTTP 200；SPA 深链 `/downloading` HTTP 200（history fallback 正常）；主 bundle HTTP 200（64 KB）。`dist/assets/*.js` grep 无 Vue 运行时残留（createApp/vue-router 等）。

### D5 localStorage 迁移与 rehydrate（关键修复项）

- Status: passed
- Evidence: 将 `settings.ts`/`downloadQueue.ts` 编译后以 mock `window.localStorage` 在 Node 实测：
  1. 旧裸格式（`{autoParse:true,...}` 与 `[7,8,9]`）→ 模块加载时自动转写为 `{state:...,version:0}` 信封；
  2. persist 异步 rehydrate 后 `settings` 完整（默认字段 `defaultAudioQuality:"192K"` 等保留，显式 merge 修复了顶层替换丢字段问题）、`taskIds=[7,8,9]`；
  3. `addTaskId(10)` 后落盘仍为信封 `[7,8,9,10]`；
  4. 更新设置后重新加载模块，默认字段与新值均保留（S2 断言）。
  - 全部断言通过（`ALL STORE ASSERTIONS PASSED`）。注：首轮测试发现 zustand persist 默认 merge 为顶层替换导致 settings 丢失存储中不存在的默认字段，已通过显式 `merge` 修复并复测通过。

### D6 运行级 UI 交互

- Status: adjudicated out of scope（留用户手动验证）
- Reason: 本机无浏览器自动化环境；交互逐条对照 Vue 版实现（路由 8 条、登录二维码轮询、下载任务 3s 轮询、AI 总结筛选/弹窗、VideoDetail 分P 选择与画质/编码/字幕选择、子目录弹窗）。建议用户手动过一遍：首页解析、登录扫码、下载队列、AI 总结任务、设置页。

## Summary

- 自动可验证方向（D1–D5）全部 passed；D6 显式留用户手动验证。typecheck/build/preview/store 迁移逻辑均有落盘证据。
