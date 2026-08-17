# 2026-08-18 Docker 拆分范围讨论

## 需求来源

用户会话中提出：为仓库内两个服务（Node server 与 Python 视觉代理）提供容器内/Docker 层面的自动重启机制，并询问 Docker 拆容器方案；随后确认按推荐方向执行——仅拆分 Python 代理为独立容器，前端保持与 server 容器同源托管。

## 决策点

1. **拆分对象**：把 Python 视觉代理（`qwen_vision_proxy.py`）拆为独立容器，与 server（Node + 前端）分离。
   - 理由：代理崩溃目前只能靠整体重启恢复，拆分后各自 `restart: unless-stopped` 提供独立崩溃自动重启；代理为可选能力，隔离后可独立故障与恢复。
   - 备选方案（讨论中排除）：单容器 + pm2/supervisor（进程级守护，无容器级隔离）；单容器 + 重启循环（Node 崩溃仍牵连代理）。
2. **前端是否独立拆容器**：不拆。
   - 理由：前端已由 server 用 `useStaticAssets` 同源托管，拆出会产生跨域/auth cookie（含扫码登录 session cookie）处理成本，对 NAS 单机场景无收益；nginx 反代维持同源等于引入额外组件，收益不抵复杂度。
3. **进程重启机制**：使用 Docker `restart: unless-stopped`（容器级崩溃自动重启），不在容器内引入 supervisor。
   - 已记录残余项：进程"存活但挂死"无法由 Docker 原生策略兜底（见 plan 的 `Deferred But Adjudicated`）。

## 交付范围

- 多 target Dockerfile（`server` / `vision-proxy`）+ `packages/docker/docker-compose.yml`。
- `docker:build` / `docker:run` 命令名不变，内部改用 compose。
- server 镜像不再携带 Python/venv/代理脚本；vision-proxy 镜像不携带 Node/FFmpeg/前端产物。
- 容器间经 compose 网络服务名 `vision-proxy:8765` 通信；两容器共享 `/download` 文件系统。

## 待确认（非阻塞）

- 代理容器监听 `0.0.0.0:8765`：仅为 compose 内部网络可达，不发布宿主机端口；如未来需对宿主机暴露需重新评估鉴权。