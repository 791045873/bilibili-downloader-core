# 2026-06-11 本地开发体验优化测试说明

- Linked Plan: `docs/plans/2026-06-11-local-dev-experience-plan.md`
- Source Requirement: `docs/requirements/2026-06-11-local-dev-experience.md`

## Environment / Notes

- 使用现有 monorepo 依赖与根脚本。
- 观察重点为开发者可见的启动方式、脚本清理结果与文档一致性。

## Testing Directions

### 1. 一键联调入口

- Requirement / Change: 项目应提供一个推荐的一键本地联调命令。
- Should Be Observable: 开发者只需执行一个根脚本命令，即可同时启动后端和前端开发服务；如环境允许，应能观察到 server 监听 3000、frontend 监听 5173，并可从浏览器访问 `http://localhost:5173`。
- Should Not Be Observable: 开发者仍需要按 README 主流程分别手动启动多个命令才能完成标准联调，或文档宣称一键启动但实际仍缺少其中一个服务。
- Status: passed
- Evidence: 2026-06-11 实际运行 `pnpm dev:server`：先完成 `build:deps`，随后 frontend 输出 `Local: http://localhost:5173/` ready，server 完成 Nest 启动并打印 `Web 界面: http://localhost:3000`；README 主流程已收敛为单命令联调。

### 2. 脚本清理结果

- Requirement / Change: 根 `package.json` 中多余、命名误导或失效的命令应被清理，但不误删仍有用途的入口。
- Should Be Observable: 根脚本列表能清晰区分本地联调主入口与其他仍有效的构建/CLI/Docker 命令。
- Should Not Be Observable: 保留明显与当前工作流冲突的误导性脚本，或删除现有文档仍依赖的有效命令。
- Status: passed
- Evidence: 根 `package.json` 已删除 `clean`、`dev`、`server:start`、`dev:deps`，保留 `dev:server`、`frontend:dev`、CLI、构建、Docker 相关有效入口，并与当前需求和包级 README 用法对齐。

### 3. 文档一致性

- Requirement / Change: 开发调试文档与验证命令应反映最终实际脚本。
- Should Be Observable: README 与 `docs/context/project-context.md` 对开发者说明一致，并与根脚本行为匹配。
- Should Not Be Observable: 文档仍描述旧的双命令启动流程，或验证命令与实际脚本不一致。
- Status: passed
- Evidence: `README.md` 已改为以 `pnpm dev:server` 为主流程；`docs/context/project-context.md` Verification Commands 与 active plan 已同步；需求文档验收项与当前脚本方向一致。
