# 2026-09-14 QA 穿搭问答页移动端适配（含共享顶栏壳层）— 实施日志

- 需求：`docs/requirements/2026-09-14-qa-mobile-adaptation.md`
- 计划：`docs/plans/2026-09-14-qa-mobile-adaptation-plan.md`（`Plan Status: in progress`）
- 测试方向：`docs/testing/2026/09-14-qa-mobile-adaptation-testing.md`
- 计划审计：`docs/audits/2026-09-14-plan-audit-qa-mobile-adaptation.md`

## 变更文件

- `packages/frontend/index.html`：viewport 补 `viewport-fit=cover`、`interactive-widget=resizes-content`；新增 `theme-color=#f43f5e`。
- `packages/frontend/src/assets/main.css`：新增 `:root` 的 `--app-header-h`/`--vvh` 默认值与 `.pt-safe`/`.pb-safe`（安全区）。
- `packages/frontend/src/App.tsx`：顶栏 `≥768px` 横向导航、`<768px` 汉堡 + 右抽屉（含登录入口）；`ResizeObserver` 写 `--app-header-h`，`visualViewport` 写 `--vvh`；根容器 `min-h-dvh`；`main` 与其他全宽页滚动行为不变。
- `packages/frontend/src/pages/QaChat.tsx`：
  - 断点（`max-width: 767.98px`）单列；会话列表移入左抽屉，新增"会话列表"入口，选中关闭、当前会话高亮；删除按钮触控目标 44px。
  - 聊天高度 `calc(var(--vvh) - var(--app-header-h) - 3rem)`；消息区容器内滚动（不再整页 `scrollIntoView`）；输入区 `.pb-safe`。
  - 窄屏照片/发送按钮图标化；粗指针回车换行、细指针回车发送、Shift+回车换行；待发 chip `flex-wrap`。
  - 助手示例图：横向缩略图条（无文字）+ `Image.PreviewGroup` 受控全屏查看；`imageRender` 显示当前图 `tipTitle`/`caption`；捕获阶段 `touchstart`/`touchend` 横向滑动切换（阈值 50px、方向校验、`scale>1` 不切换、首末不循环、单图不切换）；缩略图以索引打开。

## Explore 结论（计划 Phase 3）

- 选用路线：antd `Image.PreviewGroup` 受控 `open`/`current` + `items` + 自建缩略图，在其上叠加原生捕获阶段滑动手势；不新增依赖。
- 静态依据：antd 6.6.0 提供 `Image.PreviewGroup`；rc `PreviewGroup` 用 `useControlledState` 支持受控 `current`/`open`；`showLeftOrRightSwitches = count > 1`（单图自动隐藏切换）；`items` 剥离非 `COMMON_PROPS`，caption 需按索引映射；`onTransform` 提供 `scale`。
- 残余风险（留待设备矩阵）：滑动与内置缩放/平移的仲裁、`onTransform` raf 批处理导致手势起始 `scale` 读数滞后、`movable` 是否按 `scale` 切换。
- 证据位置：本日志。

## 验证

- `pnpm typecheck`：通过（core / bilibili-api-sdk / frontend / adapters / server 全包）。
- `pnpm build`：通过（frontend `vite build` 3409 modules，其余包 tsc/nest build 通过）。
- 未执行：移动端设备矩阵手工验证（D1–D19），尤其 D5 软键盘、D6 安全区、D18/D19 画廊与滑动仲裁。

## 未闭合项

- testing 文档 D1–D19 仍为 `pending`；需人工设备矩阵执行后确认或裁决。
- 计划各相位保持 `in progress`；待 testing 方向确认与独立 closure audit 后方可闭合。
