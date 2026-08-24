# 2026-08-24 Docker 镜像版本化日志

> 关联计划：`docs/plans/2026-08-24-docker-image-version-plan.md`
> 测试文档：`docs/testing/2026/08-24-docker-image-version-testing.md`

## 需求

用户要求：docker compose 打包镜像时使用对应包的 version 作为镜像 version（server ↔ `packages/server/package.json`，vision-proxy ↔ `packages/vision-proxy/pyproject.toml`），每次打包都有明确的版本指定（不再静默 `latest`）。

## 决策

- 镜像 tag = 对应包 version，由新增 `packages/docker/compose.mjs` 自动推导；`SERVER_VERSION` / `VISION_PROXY_VERSION` 环境变量可覆盖（如发测试 tag）。
- compose 层用 `${SERVER_VERSION:?err}` / `${VISION_PROXY_VERSION:?err}` 必填插值，版本缺失即报错，保证"每次构建显式指定版本"。
- wrapper 把两个版本键合并写入 `packages/docker/.env`（保留用户其他配置行），使直接 `docker compose` 命令也可用；`.env` 为 gitignore 生成物。
- 不做 `latest` 别名、不加镜像内版本 LABEL/ARG、不改包版本值。
- 顺带修复两处既有问题：`packages/docker/package.json` 的 `docker:save` 沿用旧镜像名（`bilibili-downloader:latest`）已失效；`docker:build:server` / `docker:build:vision-proxy` 在 dc758ef 被移除后 README/codebase-map 仍引用（重建并修复漂移）。

## 实施

- 新增 `packages/docker/compose.mjs`：版本解析（包文件 + env 覆盖）、docker tag 合法性校验、`.env` 合并同步、`docker compose` / `docker build -f` / `docker save` 派发（spawn args 数组、退出码透传、save 前 mkdir -p）。
- `packages/docker/docker-compose.yml`：两 service 的 `image` 加 `${VAR:?err}` 版本插值。
- `packages/docker/package.json`：全部 docker:* 脚本路由至 `node compose.mjs`，重建 `docker:build:server` / `docker:build:vision-proxy`，新增 `docker:save:server` / `docker:save:vision-proxy` / `docker:config`。
- 根 `package.json`：`docker:save server` / `docker:save vision-proxy` 改路由至 docker 包（统一版本解析）。
- `packages/docker/.env.example`：补充镜像版本变量说明（一般无需手工配置，env 可覆盖）。
- 文档：README、codebase-map、project-context、system-baseline 同步。

## 验证

- `node --check packages/docker/compose.mjs` 通过；版本解析、env 覆盖（`SERVER_VERSION=9.9.9-test` → config 输出 `:9.9.9-test`）、`.env` 合并保底（用户行保留、无重复键）全部实测通过；移走 `.env` 直接 `docker compose config` 报"required variable ... is missing a value"（版本必填生效）。
- `docker compose config`（经 wrapper）输出 `bilibili-downloader-server:0.0.1` / `bilibili-downloader-vision-proxy:0.0.1`。
- `pnpm docker:build` 实建两镜像成功（daemon 29.7.2，~71s，Image Built）；`docker:build:vision-proxy` 独立构建派发成功；`docker:save server` / `docker:save` 导出 tar 成功。
- `pnpm docker:run` 运行冒烟：双容器 healthy、宿主 3000 返回 200、容器运行 `:0.0.1` 镜像；`pnpm docker:down` 干净退出。
- `pnpm typecheck` 全绿（基线确认，无 TS 改动）。
- 测试详情见 `docs/testing/2026/08-24-docker-image-version-testing.md`。
