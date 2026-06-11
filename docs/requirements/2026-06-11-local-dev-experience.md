# Feature: 本地开发体验优化

## Status

Drafted: 2026-06-11

Source: 用户直接需求（优化本地调试前后端项目时的便捷性）

## Goal

修复并优化本地开发启动流程，使得开发者可以用一条命令同时启动前后端，减少手动步骤和终端窗口数量。

## In Scope

- 修复根 `package.json` 中 `dev:server` 脚本的 bug：确保其真正通过一条命令同时启动后端和前端。
- 提供并保留一个明确的本地主开发入口命令，用于同时启动 NestJS 后端（`start:dev --watch`）和 Vue 前端（`vite dev`）。
- 确保启动命令先构建底层依赖（`core` + `adapters`），再并行启动前后端。
- 盘点根 `package.json` 中现有脚本，删除多余、命名误导、当前文档未使用或与本地联调目标冲突的命令。
- 保留仍被当前工作流或使用文档依赖的命令（如 CLI、构建、类型检查、Docker 相关命令），避免误删现有能力入口。
- 更新项目文档，明确当前项目的本地开发调试方式，包括一键联调命令、访问地址，以及必要时的分开启动方式。
- 更新 `docs/context/project-context.md` 中的 Verification Commands，反映最终保留的开发启动命令。

## Out Of Scope

- 不修改产品功能代码（Core、Server API、Frontend UI）。
- 不修改 CLI、Docker 部署配置本身，但允许保留它们当前仍在使用的命令入口。
- 不引入新的 dev 工具（如 turbo、nx 等），仅修复和利用已有的 `concurrently`。
- 不新增 lint、test 等其他开发工具链。
- 不为当前未进入本地开发主流程的脚本额外补齐新能力，只处理清理、修正和文档对齐。

## Main User Flows

1. 开发者克隆项目后，执行 `pnpm install`。
2. 执行一条命令，自动完成：构建 `core` + `adapters` 依赖 → 并行启动 NestJS server（端口 3000，热重载）+ Vite frontend（端口 5173，API 代理到 3000）。
3. 开发者在浏览器访问 `http://localhost:5173` 开始调试。

## Business Rules

- 启动命令必须先确保 `core` 和 `adapters` 已构建（因为 server 依赖它们的编译输出）。
- 前后端进程并行运行，任一进程退出时整体退出。
- 使用已有的 `concurrently` 工具，不引入新依赖。
- 脚本清理应以“当前仓库真实工作流是否使用”为准，不能仅因命令暂未用于本地联调就删除仍有文档或包级用法依赖的入口。
- 若某脚本名称与行为明显不符，优先删除或重命名；若当前任务不做重命名，则至少避免其继续作为推荐开发入口出现在文档中。

## API / Integration Impact

- 无。

## Acceptance Criteria

- [x] `dev:server` 脚本修复为真正同时启动 server 和 frontend，并作为项目推荐的本地主开发入口。
- [x] 根 `package.json` 中与当前本地开发目标冲突、命名误导或已失效的多余命令已清理，且保留仍被文档或既有功能依赖的有效命令。
- [x] 执行修复后的 `dev:server` 命令后，server（端口 3000）和 frontend（端口 5173）均能正常访问。
- [x] `docs/context/project-context.md` 与面向开发者的说明文档中已更新当前本地开发调试方式。
- [x] 使用独立子 agent 对脚本清理结论、实现结果与文档一致性进行复核；如发现分歧，继续修正并重复验证直至结论一致。
- [x] `pnpm typecheck` 通过（此改动不涉及 TypeScript 源码，但作为门禁检查）。
