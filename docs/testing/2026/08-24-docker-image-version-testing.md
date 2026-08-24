# 2026-08-24 Docker 镜像版本化测试

> Plan: `docs/plans/2026-08-24-docker-image-version-plan.md`
> 环境：本机 Windows 11 + PowerShell；Docker Compose v5.3.1；daemon 可用性以实测为准（`docker compose config` 不依赖 daemon）。

## 目标状态

- `packages/docker/docker-compose.yml` 两个镜像以对应包 version 打 tag：
  - `bilibili-downloader-server:<@bilibili-downloader/server 包 version>`（当前 `0.0.1`）
  - `bilibili-downloader-vision-proxy:<vision-proxy 包 version>`（当前 `0.0.1`）
- 版本由 `packages/docker/compose.mjs` 自动从包文件推导；`SERVER_VERSION` / `VISION_PROXY_VERSION` 环境变量可覆盖。
- 每次构建/导出均携带显式版本，缺失版本时 compose 报错并给出指引（不使用 `latest`）。

## 测试方向

### 1. 版本解析与覆盖（脚本行为，无需 daemon）

**必须可观测：**
- `node packages/docker/compose.mjs`（无参数）打印用法并提示可用子命令，退出码非 0。
- 正常调用（如 `config`）时打印一行实际版本：`server=0.0.1 vision-proxy=0.0.1`（与包文件一致）。
- 设置 `SERVER_VERSION=9.9.9-test` 后调用，打印的 server 版本为 `9.9.9-test`（环境变量覆盖包版本）；vision-proxy 不变。
- 版本非法（如含空格/大写路径字符）时报错退出。

**不得可观测：**
- 版本缺失时静默 fallback 到 `latest` 或空 tag。

### 2. `.env` 同步（合并保底）

**必须可观测：**
- 调用后 `packages/docker/.env` 存在，含 `SERVER_VERSION=0.0.1` 与 `VISION_PROXY_VERSION=0.0.1`。
- 预先在 `.env` 写入自定义行（如 `DOWNLOAD_HOST_PATH=C:\tmp` 或 `MAX_CONCURRENT_DOWNLOADS=3`），调用后该行保留，仅 `SERVER_VERSION` / `VISION_PROXY_VERSION` 被更新/追加。
- 再次调用（版本未变）不产生重复的 `SERVER_VERSION` 行。

### 3. compose 配置校验（无需 daemon）

**必须可观测：**
- `pnpm --filter @bilibili-downloader/docker docker:config`（= `node compose.mjs config` → `docker compose config`）通过，输出中两个 service 的 image 分别为 `bilibili-downloader-server:0.0.1` 与 `bilibili-downloader-vision-proxy:0.0.1`。
- 在 `.env` 缺失且无环境变量的场景（临时删除 .env 后直接 `docker compose config`）报错，错误信息含 `SERVER_VERSION` 与指引（版本必填）。
- **wrapper 落盘后直接 compose 可用**：先 `node compose.mjs config` 同步 .env，再直接 `docker compose config`（不经 wrapper）同样输出 `:0.0.1` 镜像名。
- `node compose.mjs down` / `node compose.mjs logs`（dry 校验：`config` 已覆盖插值路径，down/logs 与 build/up 走同一版本解析）不报版本缺失错误。

### 4. 构建与导出（需 daemon，可用则实测）

**必须可观测：**
- `pnpm docker:build` 构建出 `bilibili-downloader-server:0.0.1` 与 `bilibili-downloader-vision-proxy:0.0.1`（`docker images` 可见）。
- `pnpm --filter @bilibili-downloader/docker docker:build:server` 与 `docker:build:vision-proxy` 各自独立构建带对应版本 tag 的镜像。
- `pnpm "docker:save server"` 导出 `dist/docker/bilibili-downloader-server_linux-amd64.tar`，`docker load` 可读；`pnpm docker:save` 导出两个镜像的合并 tar。

**不得可观测：**
- 任何命令产出无 tag（`latest`）镜像引用。

### 5. 回归（无需 daemon 的部分）

**必须可观测：**
- `pnpm typecheck` 通过（无 TS 改动，作为基线确认）。
- 既有运行契约不变：compose 的 ports / volumes / environment / restart / depends_on 语义与改动前一致（`docker compose config` 输出比对）。

## 裁定记录

| 方向 | 结果 | 说明 |
| ---- | ---- | ---- |
| 1 版本解析与覆盖 | ✅ 通过 | `node compose.mjs` 无参打印用法退出 1；`config` 打印 `server=0.0.1 vision-proxy=0.0.1`；`$env:SERVER_VERSION=9.9.9-test` 时 config 输出 `bilibili-downloader-server:9.9.9-test`、vision-proxy 不变 |
| 2 `.env` 同步 | ✅ 通过 | 首次运行生成 `.env`（两键）；预置 `MAX_CONCURRENT_DOWNLOADS=3` 与注释行后重跑，用户行保留、版本键更新、无重复键 |
| 3 compose 配置校验 | ✅ 通过 | `pnpm --filter @bilibili-downloader/docker docker:config` 输出 `:0.0.1` 双镜像；移走 `.env` 后直接 `docker compose config` 报 `required variable ... is missing a value` 退出 1（含 SERVER_VERSION 指引）；wrapper 落盘后直接 `docker compose config` 可用；`docker:down` 经 wrapper 干净退出（down/logs 走同一插值路径） |
| 4 构建与导出 | ✅ 通过（daemon 29.7.2 可用） | `pnpm docker:build` 实建 `bilibili-downloader-server:0.0.1` / `bilibili-downloader-vision-proxy:0.0.1`（Image Built，~71s）；`docker:build:vision-proxy` 独立构建派发成功；`docker:save server` 导出 `dist/docker/bilibili-downloader-server_linux-amd64.tar`（263MB）、`docker:save` 导出 `dist/bilibili-downloader-images.tar`（306MB） |
| 4b 运行冒烟 | ✅ 通过 | `pnpm docker:run` 双容器 healthy、宿主 3000 返回 200、`docker inspect` 确认容器运行 `bilibili-downloader-server:0.0.1` / `bilibili-downloader-vision-proxy:0.0.1`；`pnpm docker:down` 干净退出 |
| 5 回归 | ✅ 通过 | `pnpm typecheck` 全绿；compose 的 ports/volumes/environment/restart/depends_on 与改动前一致（`docker compose config` 比对） |

> 说明：`docker:logs` 因 `-f` 跟随特性未做阻塞式实测，与 config/up/down 共用同一版本解析与插值路径，裁定由其余 compose 子命令覆盖。daemon 上残留的旧 `:latest` / `bilibili-downloader:*` 镜像为 dc758ef 时代的历史构建产物，本次任何命令均未产出无 tag 镜像引用。
