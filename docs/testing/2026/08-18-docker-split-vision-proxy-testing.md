# 2026-08-18 Docker 拆分 Python 视觉代理测试验证

关联计划：`docs/plans/2026-08-18-docker-split-vision-proxy-plan.md`

## 验证范围

本测试文档描述拆分后两个容器相互独立的可观察状态，验证方向按"应成立 / 不应成立"组织，供实施后逐条确认。

## 前提

- 本机具备 `docker compose`（v2+）与 BuildKit。
- 验证过程在本地镜像构建与容器运行完成，不要求真实 DashScope API Key（无 key 时代理 `/healthz` 仍应 200，仅真实分析会失败）。
- 若提供 `DASHSCOPE_API_KEY`，可额外确认代理对 DashScope 的真实调用路径，不作为必须项。
- Windows 宿主默认下载目录经 `USERPROFILE` 回退解析（HOME 为空）；可用 `DOWNLOAD_HOST_PATH` 覆盖。

## 测试方向

### 镜像职责分离

- [x] 应成立：`bilibili-downloader`（server 镜像）与 `bilibili-downloader:vision-proxy` 两镜像均可被独立构建。
- [x] 应成立：server 镜像内不存在 python、`/opt/vision-venv`、`qwen_vision_proxy.py`、`/app/python`。
- [x] 应成立：vision-proxy 镜像内不存在可运行的 Node 组件（`command -v node`/`command -v npm` 无结果）、前端静态产物（`/app/public`）、FFmpeg（`command -v ffmpeg` 无结果）；基础镜像层残留不算功能性组件。
- [x] 应成立：vision-proxy 镜像内 `/opt/vision-venv/bin/python` 可导入 `dashscope`、`dotenv`。
- [x] 不应成立：两镜像都不包含 `DASHSCOPE_API_KEY` 明文（该值只在运行期经 compose 注入）。

### Compose 编排与网络

- [x] 应成立：`docker compose config` 校验通过；默认网络内两个 service 名称分别为 `server` 与 `vision-proxy`。
- [x] 应成立：宿主仅映射 3000 端口；`docker port` 只列出 3000。
- [x] 应成立：vision-proxy 在容器内以 0.0.0.0:8765 监听（可通过 server 容器访问它，即监听地址非 127.0.0.1）。
- [x] 应成立：server 容器内 `fetch('http://vision-proxy:8765/healthz')` 返回 200 且 body 为 `{"status":"ok"}`。
- [x] 不应成立：当容器健康后 `docker ps` 中任一容器长期处于 unhealthy（不经人为破坏时）。

### 崩溃独立恢复

- [x] 应成立：模拟 vision-proxy 主进程崩溃（kill 容器 PID 1）后，vision-proxy 容器被 Docker 自动重启并恢复到 healthy，server 容器全程不受影响（无重启）。
- [x] 应成立：模拟 server 主进程崩溃（kill 容器 PID 1）后，server 容器被 Docker 自动重启并恢复到 healthy，vision-proxy 容器全程不受影响（无重启）。
- [x] 不应成立：任一容器崩溃触发另一个健康容器同时重启。

### 数据与日志

- [x] 应成立：两个容器可访问同一宿主机下载目录（共享 volume 挂载到 `/download`）。
- [x] 应成立：运行期 `/download/logs` 同时生成 `server-YYYY-MM-DD.log` 与 `vision-proxy.log`。
- [x] 应成立：`docker compose down` 后两容器均停止，无残留孤儿进程，退出干净。

### 真实业务链路（已裁定为范围外）

- [x] 已裁定：配置 `DASHSCOPE_API_KEY` 后 AI 总结链路中多模态调用经 `http://vision-proxy:8765/v1/chat/completions` 成功——需用户密钥 + 外部网络，本验证不执行；容器网络可达性（server→proxy 8765/healthz）、无 key 错误路径已覆盖。
- [x] 已裁定：未配置 `DASHSCOPE_API_KEY` 时代理把自身伪装成可用——代理代码 `os.getenv` 返回空串即视为缺失并拒绝分析请求（`qwen_vision_proxy.py:238-240`），healthz 保持 200 属设计行为；本方向以代码审查 + healthz 实测覆盖。

## 结果

### 通过

- [x] 镜像职责分离：`bilibili-downloader` 与 `bilibili-downloader:vision-proxy` 独立构建成功（`docker compose build`，两个 Image Built）。
- [x] server 镜像无 python（`command -v python3` 无结果）、无 `/opt/vision-venv`、无 `/app/python`；有 ffmpeg、node、`/app/public/index.html`。
- [x] vision-proxy 镜像内 `command -v node` / `command -v npm` / `command -v ffmpeg` 均无结果，无 `/app/public`；`/opt/vision-venv/bin/python` 可导入 `dashscope`、`dotenv`（sys.executable 指向 venv）。
- [x] 两镜像不含 `DASHSCOPE_API_KEY` 明文（Dockerfile 未写、运行期才经 compose 注入）。
- [x] `docker compose config` 校验通过；两个 service 名称为 `server` / `vision-proxy`；volume 默认路径在本机 Windows 解析为 `C:\Users\Admin/Downloads/bilibili_download`（HOME 为空经 USERPROFILE 回退）。
- [x] 宿主仅映射 3000；`docker port bilibili-downloader-server-1` 仅列出 3000。
- [x] vision-proxy 监听非 127.0.0.1：server 容器内 `node -e fetch('http://vision-proxy:8765/healthz')` 返回 200 `{"status":"ok"}`。
- [x] 启动后两容器均 healthy（`docker compose ps` 双 healthy），无额外人为破坏时不进入 unhealthy。
- [x] 崩溃独立恢复：容器内 SIGKILL vision-proxy 主进程 → 容器被 Docker 自动重启并恢复 healthy（Up 18 seconds healthy），server 全程 running；SIGKILL server 主进程（node）→ server 容器自动重启恢复（Up 24 seconds healthy），vision-proxy 全程不受影响。
- [x] 两容器共享下载目录：运行期 `/download/logs` 同时生成 `server-2026-08-17.log`（16758 B）与 `vision-proxy.log`（1245 B）。
- [x] `docker compose down` 后两容器均停止并移除、网络清除，无残留容器/孤儿进程。

### 明确裁定

- [x] 真实 DashScope 模型调用（AI 总结端到端）：需用户密钥 + DashScope 可访问网络，超出本地冒烟验证范围；代理 `/healthz`、无 key 错误路径与容器网络可达性已覆盖。
- [x] `docker kill`（宿主显式停止）不触发 restart 策略：Docker 官方行为（用户显式停止不受 restart 策略约束），崩溃场景以容器内进程被 SIGKILL 验证为准；compose 的 `restart: unless-stopped` 已实际生效。
- [x] vision-proxy 镜像的基础库层仍包含 Node 镜像层体积：按"功能性组件剔除、`command -v node` 无结果"为准，层字节残留不判失败（与 plan Decision 一致）。

## 执行证据

- `docker compose config`：校验通过，services `server`/`vision-proxy`，bind volume source 解析为 `C:\Users\Admin/Downloads/bilibili_download`。
- `pnpm docker:build`（`docker compose build`）：`Image bilibili-downloader Built`、`Image bilibili-downloader:vision-proxy Built`。
- server 镜像检查：`NO_PYTHON / NO_VENV / NO_PYTHON_DIR / /usr/bin/ffmpeg / /usr/local/bin/node / /app/public/index.html`。
- vision-proxy 镜像检查：`NO_NODE / NO_NPM / NO_FFMPEG / NO_PUBLIC / /opt/vision-venv/bin/python`。
- 运行期：`docker compose up -d` 双容器 healthy；server 内 `healthz 200 {"status":"ok"}`；宿主 `GET /` 200、`GET /api/download/config` → `{"outputDir":"/download","source":"env"}`。
- 崩溃恢复：容器内 /proc 巡检定位 `vision_proxy` / `dist/main.js` 进程并 SIGKILL；容器均被自动重启且恢复 healthy，对端容器全程 running。
- 日志：`$USERPROFILE\Downloads\bilibili_download\logs\server-2026-08-17.log`、`vision-proxy.log`（容器内系统时钟为 UTC，跨本机时区午夜轮转，故 server 日志文件名日期为 08-17 属正常按天轮转）。
- `docker compose down`：双容器 Stopped/Removed、网络 Removed，`compose ps -a` 为空。
- `pnpm typecheck`：exit 0。