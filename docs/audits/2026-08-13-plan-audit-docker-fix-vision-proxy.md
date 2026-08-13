# Plan Audit — Docker 镜像修复并纳入 Python 视觉代理

- 计划：`docs/plans/2026-08-13-docker-fix-vision-proxy-plan.md`
- 来源：用户需求——(1) 修复 `docker:build` 既有问题；(2) 把 Python 视觉代理纳入镜像
- 审计日期：2026-08-13
- 审计方式：独立 subagent 两轮（冷启动）
  - 首轮 task `ses_00574f009ffeG6Vfm8u1us5GQB`：对照 live 代码 + docker 实测全量复核
  - 复核轮同 task（resume）：仅复核修订后的阻断项与非阻断建议吸收情况

## 首轮审计结论

`needs revision`

### 阻断问题

1. **B1 — 「Node 服务 3100 可用」与容器实际端口矛盾**：Goal/Phase 3 Proof/Exit Criteria 断言 Node 跑在 3100，但容器内 `Dockerfile:41` `ENV PORT=3000`、`docker:run` 映射 `-p 3000:3000`；`main.ts:10` 的 3100 仅在 PORT 未设置时生效。按字面必然失败。

### 非阻断建议（均已吸收）

1. Phase 2 COPY 目标路径未写明（`/app/python`），且影响 `load_dotenv` 的 SERVER_DIR 查找。
2. `DASHSCOPE_API_KEY` 未入 Dockerfile ENV，代理 POST 必需；testing 应覆盖无 key 路径。
3. `.dockerignore` 未排除 `.env`（含密钥），builder 阶段 `COPY packages/server/` 会带入镜像（既有问题）。
4. `video-analysis-baseline.md:96`「start-vision-proxy 自动重启自愈」不变量与容器无守护编排的张力，需对齐措辞。

## 事实核查（首轮通过）

- Baseline 准确：Dockerfile 两阶段结构、better-sqlite3 `prebuild-install || node-gyp rebuild --release`、`node:22-alpine` 无 python3/make/g++（docker 实测）、代理不进当前镜像、`QWEN_VISION_PROXY_URL` 指向容器外。
- 技术可行性（docker 实测）：`node:22-alpine` + `apk add python3 py3-pip ffmpeg` → Python 3.14.7/pip 26.1.2；`pip3 install --break-system-packages dashscope==1.26.6 python-dotenv==1.2.2` 成功；容器内运行 `qwen_vision_proxy.py` healthz 200。
- 方案正确性：builder 加 python3/make/g++ 解决 better-sqlite3 编译（实测无工具链 `gyp ERR! not ok`，有工具链 install code 0 且建表/查询成功）；entrypoint.sh 后台 Python + `exec node` 前台（PID 1=Node）信号转发合理；代理失败不阻塞 Node 合理。
- 环境变量一致性：`QWEN_VISION_PROXY_URL` 原文作为完整 URL POST，与代理 handler 路径精确匹配。
- 受保护区：deployment=ask-first，用户已授权；Phase 5 对齐 app-overview/system-baseline；bugs 记录计划齐备。
- 合规性：Item Types、Exit Criteria、closure gates、testing 引用、Decision、micro-plan 判定（full plan）齐备。
- 回归风险低：宿主脚本与 venv 不受影响，docker:build/docker:run 命令零改动。

## 复核轮结论

`approved`（B1 三处端口已修正为容器内 `PORT=3000`；四条建议全部吸收；无残留阻断项）。

## 关闭审计

本计划尚未实施；closure audit 将在计划关闭时另行独立执行（证据另行归档）。
