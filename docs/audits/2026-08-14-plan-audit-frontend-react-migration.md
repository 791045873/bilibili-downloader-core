# Plan Audit - 2026-08-14 前端技术栈迁移：Vue 3 → React 19

## Meta

- Plan: `docs/plans/2026-08-14-frontend-react-migration-plan.md`
- Audit type: 独立 subagent（General_7616457）+ 计划修订 + cold-replay 复核
- Result: passed（首轮 NEEDS REVISION → 修订并入 → 复核通过）
- Date: 2026-08-14

## Audit Method

独立 subagent 以只读方式核对计划与仓库现状，并实测 npm registry 版本事实。8 项核查：配置替换、路由/页面映射、localStorage key、Dockerfile、死代码依赖、api/types 框架无关性、antd v6 版本事实、风险遗漏。

## Findings

### Blocking（已修订并入计划）

- B1: zustand `persist` 写入 `{state, version}` 信封；Pinia 版写入裸 JSON（settings = 对象、task-ids = 数组）。直接替换会让既有用户数据在首次加载后静默重置。计划仅声明"key 不变即兼容"，未设计迁移。
  - 修订：Phase 2 增加 `migrateLegacyStorage()` —— 模块加载时读取旧 key，无 `state` 字段即旧格式，一次性转写为信封格式（`{state:{settings:parsed}, version:0}` / `{state:{taskIds:parsed}, version:0}`）；含 `state` 字段跳过；失败静默忽略。

### Non-blocking（已并入计划）

- N1: 保留 `preview` script（Phase 3 `vite preview` 冒烟依赖）。
- N2: StrictMode 下 Login 轮询 effect 双执行（dev only）——由 store `startPolling` 先 `stopPolling` 的自愈设计吸收，生产构建不受影响。
- N3: antd v6（6.3.0 起）size 枚举统一为 `large/medium/small`，代码避免 `middle`；`Select bordered` → `variant`。
- N4: Tailwind v4 preflight 与 antd 观感冲突留运行级验证。
- N5: 设置自动落盘（persist 即时写）与 Vue 版"点保存才写"的差异为有意行为变更，已标注于计划 Phase 2，闭核算按此核对。

## Verdict

PASS —— 版本事实（react 19.2.8 / antd 6.6.0 含 QRCode / icons 6.3.2 / react-router 7.18.2 / vite 8.2.1 / plugin-react 6.0.5 / tailwindcss 4.3.3 peer 均满足）、路由映射（8 条一一对应）、Dockerfile（:64 构建入口 + :40 COPY 三文件）、cn/cva 死代码、api/types 可原样迁移均核查通过；唯一实质问题 B1 已修订并入计划。
