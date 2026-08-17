# bilibili-downloader-core

一个以 Bilibili 下载为核心能力的下载引擎，方便嵌入至各种环境。

## 项目目标

本项目旨在在充分理解 `yaobiao131/downkyicore` 架构与下载流程的基础上，重新设计一个更易扩展、适合多种运行形态的 Bilibili 下载引擎。

目前项目有 6 个子包，分别是：

1. Adapter
2. Sale
3. Core
4. Docker
5. Frontend
6. Server

其中 Core 是 bilibili 下载器的核心包。Adapter 是对核心包的一些适配代码，例如：
   (a) 使用 HTTP 下载器是如何下载的
   (b) 使用 Aria2 下载器是如何下载的
   (c) B 站的权限部分是怎么做的

这些具体的业务实现在 Adapter 中，而 Core 中主要是核心逻辑的编排。

server 是下载器的后端代码，front 部分是下载器的前端代码。

Docker 是将下载器打包为镜像的 Dockerfile（多 target：`server` 与 `vision-proxy`）与 docker compose 编排（`packages/docker/docker-compose.yml`），`docker:build` / `docker:run` 命令内部已改用 compose。

如果想要通过源码进行本地调试，先执行 `pnpm install`，再运行 `pnpm dev:server`。该命令会先安装所有 Node 工作区依赖，并在检测到本机 Python 可用时自动创建 `packages/server/python/.venv` 并安装 `packages/server/python/pyproject.toml` 中锁定的视觉代理依赖；随后同时启动后端开发服务（3000）和前端开发服务（5173）。启动后直接访问 `http://localhost:5173` 即可。

如果你只想单独补齐视觉代理依赖，或者 `pnpm install` 时因为本机没有 Python 而跳过了这一步，可以在仓库根目录执行 `pnpm setup:vision-proxy`。该命令会自动寻找可用的 Python 解释器，创建虚拟环境并安装 `dashscope`、`python-dotenv` 等锁定版本依赖。

如果需要单独排查后端，可以运行 `pnpm --filter @bilibili-downloader/server start:dev`；如果需要单独排查前端，也可以单独运行 `pnpm frontend:dev`。

如果需要本地启动视觉代理来支持视频分析，可进入 `packages/server` 后运行 `pnpm start:vision-proxy`。当缺少 Python 依赖时，启动命令会直接给出修复提示，而不是抛出原始模块导入异常。

如果想要在 NAS 中使用，在仓库根目录执行 `pnpm docker:build` 构建两个镜像，再执行 `pnpm docker:run` 通过 docker compose 启动 `server`（Node + 前端 + FFmpeg，对外暴露 3000 端口）与 `vision-proxy`（Python 视觉代理，仅供容器间调用）。两个容器均配置 `restart: unless-stopped`，任一崩溃会自动单独重启。

默认情况下，两个容器会把宿主机 `$HOME/Downloads/bilibili_download`（Windows 宿主为 `%USERPROFILE%\Downloads\bilibili_download`）挂载到容器内 `/download`，所有视频下载到该目录；可用环境变量 `DOWNLOAD_HOST_PATH` 覆盖挂载位置。

如需启用 AI 视频分析视觉代理，请在 `packages/docker/` 下创建 `.env`（已被 .gitignore 忽略，不会提交）并写入 `DASHSCOPE_API_KEY=你的密钥`，然后重新 `pnpm docker:run`。参考 `packages/docker/.env.example`。

之后的步骤，请参考你自己的 NAS 中 Docker 的使用教程。
注意在使用 Docker 的时候，宿主机的目录和容器的下载目录要能对应得上。

## 特别提醒

整个项目是使用 AI 从 `yaobiao131/downkyicore` 迁移过来的，由于我只会 JS，所以这个项目的主要语言也是 JS 或者 TS。
