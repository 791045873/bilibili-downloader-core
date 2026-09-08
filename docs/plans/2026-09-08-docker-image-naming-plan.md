# Plan: Docker 镜像命名统一为 bilibili-downloader 仓库 + 版本/类型 tag

日期: 2026-09-08
状态: implemented
Autonomy: 用户直接请求的部署配置变更（用户已确认 tag 方案）
Audit: pass-with-conditions（`docs/audits/2026-09-08-plan-audit-docker-image-naming.md`，
条件已回填）

## 需求（用户确认：都带版本）

- server 镜像：`bilibili-downloader-server:0.0.1` → **`bilibili-downloader:{version}`**
  （如 `bilibili-downloader:0.0.1`）
- vision-proxy 镜像：`bilibili-downloader-vision-proxy:0.0.1` →
  **`bilibili-downloader:vision-proxy-{version}`**（如 `bilibili-downloader:vision-proxy-0.0.1`）
- 版本仍取各包 package.json（上一计划成果不变）；`SERVER_VERSION` /
  `VISION_PROXY_VERSION` 覆盖不变；compose `${VAR:?}` 显式版本守卫不变。
- 完整模板串（build -t 与 compose image 两侧严格一致，防 `vision-proxy-` 前缀
  单侧错配）：
  - server：`bilibili-downloader:${SERVER_VERSION}`
  - vision-proxy：`bilibili-downloader:vision-proxy-${VISION_PROXY_VERSION}`
- 版本值经 compose.mjs TAG_RE 校验；组合 tag（`vision-proxy-0.0.1`）符合
  docker tag 规则。

## 产出物

1. `packages/docker/compose.mjs`：提取 `serverImage` / `visionProxyImage` 常量，
   build-server / build-vision-proxy / save / save-server / save-vision-proxy
   全部改用新镜像名；save tar 文件名保持 `bilibili-downloader-{server|vision-proxy}_linux-amd64.tar`
   不变（避免与镜像名耦合）
2. `packages/docker/docker-compose.yml`：两服务 `image:` 改为新命名
   （保留 `${VAR:?}` 守卫）
3. 文档同步（审计补齐）：`README.md:28` 与 `README.md:38`、
   `docs/architecture/system-baseline.md:58`、
   `docs/architecture/module-boundaries.md:56`、
   `docs/context/codebase-map.md` Docker 行、`packages/docker/package.json`
   description
4. 日志 `docs/logs/2026-09-08-docker-image-naming.md`

## 风险

- 本机/NAS 旧名镜像（`bilibili-downloader-server:*` 等）不被新 compose 引用：
  属部署侧人工清理项，不影响功能；在日志中注明。
- 遗留镜像 `bilibili-downloader:latest`（2 周前旧构建）与新 server tag
  `bilibili-downloader:{version}` 仓库相同：docker 不冲突，仅注意 latest 指向旧
  版本不再被 compose 使用。

## 验证

- `node --check packages/docker/compose.mjs`
- `node packages/docker/compose.mjs config` 渲染出两个新 image 名
- `pnpm docker:build` 实际构建（层缓存命中，仅重打 tag）后
  `docker images` 断言两个新 tag 存在
- `pnpm docker:save-server` 实测一条导出（前一命名计划的 Proof 惯例），
  确认 tar 内容物为新镜像名；tar 文件名不变（NAS `docker load` 流程不受影响）
- 残留扫描：活动文档无 `bilibili-downloader-server:` / `bilibili-downloader-vision-proxy:` 旧镜像名
