# Plan Audit — Docker 镜像版本化（对应包 version 作为镜像 tag）

- 计划：`docs/plans/2026-08-24-docker-image-version-plan.md`
- 测试文档：`docs/testing/2026/08-24-docker-image-version-testing.md`
- 审计日期：2026-08-24
- 审计方式：独立 subagent（`General_8375580`，只读审计，未修改被审文件）。涉 deployment 保护区域（ask-first），计划须经 subagent 复核；用户已在会话中直接提出该需求，构成该保护区域的人工授权。

## 结论

VERDICT: needs-changes → 修正后 approved。无 Blocker；1 项 Major、3 项 Minor、4 项 Nit 均已并入计划/测试文档。

## 发现与吸收

- **Major-1（基线失真）**：计划 Current Baseline 声称 `packages/docker/package.json` 含 `docker:build:server` / `docker:build:vision-proxy`，但二者已在 commit `dc758ef`（2026-08-24）移除（git 实证），README/codebase-map 仍引用属既有文档漂移。已修正基线如实描述 5 个脚本并标注漂移，Phase 2 相应条目由 `Fix` 改为 `Add`（重建命令顺带修复失效引用）。
- **Minor-1（错误提示语义）**：`${VAR:?err}` 对 down/logs/config 等所有 compose 子命令生效；错误提示改为中性指引（"先运行任意 pnpm docker:* 命令同步版本，或设置环境变量"）。已并入计划。
- **Minor-2（owner doc 范围）**：Phase 3 补充 `docs/architecture/system-baseline.md`（Build And Package Tools + Deployment Shape）作为 deployment 真相 owner doc。已并入计划并实施。
- **Minor-3（测试缺口）**：测试文档补"wrapper 落盘 .env 后直接 `docker compose config` 可用"与 down/logs 路径。已并入。
- **Nits（已吸收）**：save 前 `mkdir -p`；派发用 spawn args 数组而非 shell 字符串；双版本恒校验取舍已在计划注明；错误消息以 `docker compose config` 实测（中文经 compose 输出，终端乱码仅为 PowerShell 控制台编码显示问题，文件为 UTF-8，不影响功能）。

## 核查要点

- 设计正确性：compose.mjs 派发（cwd=`packages/docker` 时 `-f Dockerfile.*` 与上下文 `../..` 均正确）、save 输出路径与现状一致、`.gitignore` 的 `.env` 规则确实覆盖 `packages/docker/.env`。
- 必填插值 vs `:-latest` 兜底：兜底会重新引入静默 latest，与 Non-Goals 冲突；现行必填设计正确。
- pnpm 空格键名 `"docker:save server"`：须引号调用（测试文档已用 `pnpm "docker:save server"`），不改根键名、不破坏 README 既有命令。

## 留档说明

本文件为计划审计证据；吸收项已在实施前落入计划与测试文档。
