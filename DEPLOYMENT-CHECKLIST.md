# 部署上线 Checklist — 三镜像（cloud-server / nas-worker / vision-proxy）

> 适用：Phase 3 云端/NAS 拆分后的容器化部署（`packages/docker/` 三镜像 + compose）。
> 范围：真实上线动作（镜像构建产物与 compose 已在 Stage D 验证通过，本清单为运维执行步骤）。
> 创建：2026-10-03。相关：`packages/docker/.env.example`、`docs/architecture/system-baseline.md`（Deployment Shape）。

## A. 前置准备
- [ ] 云端 PostgreSQL（RDS）就绪，运行容器的出口 IP 已加入 RDS 白名单。
- [ ] 建**两个 DB 角色**：特权角色（建表/读写，给 cloud-server）+ 受限角色（无 DDL、仅作业读写，给 nas-worker）。
- [ ] 腾讯云 COS 桶已建（`BucketName-APPID`）并开「公有读私有写」（否则 md 预览图匿名读 403）。
- [ ] 准备 LLM/embedding 的 `llm.apiKey`（经前端设置页写入 `app_settings`，非环境变量）。

## B. 构建与分发
- [ ] `pnpm docker:build`（三镜像：cloud-server / nas-worker / vision-proxy）。
- [ ] 如需离线分发：`pnpm docker:save` 导出 tar，载入目标主机。

## C. 配置 `packages/docker/.env`（勿入库）
- [ ] `DATABASE_URL` = 特权连接串（cloud-server 建表用）。
- [ ] `WORKER_DATABASE_URL` = 受限角色连接串（nas-worker 用；不设则回退特权，**上线应显式设置**以生效最小权限）。
- [ ] `ADMIN_INITIAL_PASSWORD` = 初始 admin 口令（**不设则全 API 401、无人可登录、无法建号**；播种后建议从环境移除）。
- [ ] `SESSION_COOKIE_SECURE=true`（HTTPS 暴露时；纯 HTTP 置 true 会导致登录态立刻丢失）。
- [ ] COS 五项、`EMBEDDING_*`、SMTP/`NOTIFICATION_EMAIL`（需邮件通知时）、`DOWNLOAD_HOST_PATH`（NAS 媒体宿主目录）。
- [ ] 云端多模态模型端点 `QWEN_API_BASE`（OpenAI SDK baseURL，基址无需 `/chat/completions`；默认 DashScope 北京 compatible-mode，国际站改 `dashscope-intl`）。cloud-server 经 openai SDK 直连，**不依赖 vision-proxy**。
- [ ] `QWEN_VISION_PROXY_URL`（**仅 NAS 侧**：默认走 compose 内 `vision-proxy:8765`；跨主机部署再改为可达地址）。

## D. 启动与网络
- [ ] `pnpm docker:run`（compose up -d）。启动顺序由 compose 保证：vision-proxy healthy → nas-worker；cloud-server 不再依赖 vision-proxy（多模态直连 DashScope），仅作为 schema 属主先跑 `prisma db init`。
- [ ] 确认**仅 cloud-server:3000 对外发布**；nas-worker 与 vision-proxy 不映射宿主端口。
- [ ] 公网暴露务必置于 **TLS / 反向代理** 之后（配 HTTPS，再回头确认 `SESSION_COOKIE_SECURE=true`）。
- [ ] 反代传递真实客户端 IP（登录失败锁定按 IP 计；反代后 IP 粒度塌缩是 auth 已知遗留项，需正确处理 `X-Forwarded-For`）。

### D-bis. 两机分布式部署（cloud-server 上云服务器、nas-worker 上 NAS）
> 单机本地验证用上面的 `pnpm docker:run`（三服务同机）。真正两机分开时改用按主机拆分的 compose：
- [ ] 云服务器：`pnpm docker:cloud:up`（`docker-compose.cloud.yml`：仅 cloud-server，多模态直连 DashScope，无 vision-proxy；暴露 3000）。
- [ ] NAS：`pnpm docker:nas:up`（`docker-compose.nas.yml`：nas-worker + 本地 vision-proxy + 媒体卷；无对外端口）。
- [ ] **先起云侧**（cloud-server `db init` 建库）再起 NAS 侧；NAS 侧不建库，启动早于 schema 就绪时靠 `restart` + 应用内哨兵重试。
- [ ] 两侧 `.env` 都能连到同一云 RDS，且各自出口 IP 在 RDS 白名单内；NAS 侧建议配 `WORKER_DATABASE_URL`（受限角色）。
- [ ] 云侧多模态经 `QWEN_API_BASE` 直连 DashScope（无需 vision-proxy）；NAS 侧本地 vision-proxy，`QWEN_VISION_PROXY_URL` 用 compose 内默认服务名即可（无需跨主机互连）。

## E. 上线后人工验证（运行级，手动执行）
- [ ] cloud-server 容器日志见 `prisma db init` 成功 + HTTP 监听 3000；`/` 返回 200（否则 nas-worker 的 `depends_on: cloud-server healthy` 不满足、不会启动）。
- [ ] nas-worker 日志见 worker 轮询启动、无 contract/缺表报错；容器内 `ffmpeg` 可用。
- [ ] 用 admin 登录前端；验证未登录 401 → 跳转登录、角色可见性正确。
- [ ] **端到端五链路**：创建下载 → 执行完成 → 触发分析 → 问答检索 → （如配）邮件通知；COS 截图公网可读、md 预览正常。
- [ ] B 站 cookie：扫码登录或手动粘贴入口 `POST /api/auth/cookie`（受登录保护）任一可写入 `app_settings`，解析/下载生效。

## F. 回滚
- [ ] 保留上一组镜像 tag（tag 取各包 version，`CLOUD_SERVER_VERSION`/`NAS_WORKER_VERSION`/`VISION_PROXY_VERSION` 可覆盖）；异常时 `pnpm docker:down` 后切回旧 tag `pnpm docker:run`。
- [ ] schema 为 additive（`db init` 幂等），回滚镜像通常不需回滚库；若涉及列变更，按「改 contract → emit → db migrate」流程另处理。
