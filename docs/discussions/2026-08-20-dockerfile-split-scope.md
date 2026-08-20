# 2026-08-20 拆分 Dockerfile：server 与 vision-proxy 独立构建

## 需求来源

用户会话中提出：当前 Python 服务（vision-proxy）与 Node 服务（server）使用同一个多 target Dockerfile 打包，希望改为两个分离的 Dockerfile、打包成两个相互独立的镜像；因 Node 会调用 Python 服务，将 Python 服务 URL 在 Node 侧做成可配置且完全自定义；同步调整 package.json 打包命令。

## 决策点

1. **URL 配置层**：仅环境变量（`QWEN_VISION_PROXY_URL`）。Node 已从 `process.env` 读取（`analysis.controller.ts:478`、`analysis-trigger.service.ts:663`），未设置时 `qwen-client.ts` 给出明确错误。不做 DB 化、不改设置页 UI。移除 server 镜像内硬编码默认值，镜像不再耦合 compose 服务名。
2. **镜像命名**：独立命名 `bilibili-downloader-server` 与 `bilibili-downloader-vision-proxy`（不再共用 `bilibili-downloader` repository 名 + tag）。
3. **Dockerfile 布局**：两个独立文件 `packages/docker/Dockerfile.server` 与 `packages/docker/Dockerfile.vision-proxy`，各自自包含（server 含 builder+server 两阶段；vision-proxy 含 python-builder+vision-proxy 两阶段），构建互不共享、无跨文件 `COPY --from`。
4. **排除项**：保留多 target 单文件形态；URL 不 DB 化；不拆分前端容器；不引入多平台构建矩阵。

## 交付范围

- 新增 `Dockerfile.server` / `Dockerfile.vision-proxy`；删除原 `Dockerfile`。
- `docker-compose.yml`：两个 service 的 `build.dockerfile` 指向两个新文件、删除 `build.target`；`image` 改为新命名。
- `packages/docker/package.json` 新增 `docker:build:server` / `docker:build:vision-proxy` 独立构建命令；根 `package.json` 的 `docker:save server` / `docker:save vision-proxy` 镜像名更新。
- `.env.example` 补充 `QWEN_VISION_PROXY_URL` 说明。
- 文档对齐：codebase-map、system-baseline、module-boundaries、app-overview、video-analysis-baseline、source-of-truth-and-precedence、project-context、README。

## 待确认（非阻塞）

- 无。

## 推进路径

- 完整 plan 已创建：`docs/plans/2026-08-20-split-dockerfile-server-vision-proxy-plan.md`（涉 deployment 保护区域，plan audit 使用独立 subagent 复核）。