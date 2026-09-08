# 2026-09-08 Docker 镜像命名统一为 bilibili-downloader 仓库

## 变更

- server 镜像：`bilibili-downloader-server:{version}` → `bilibili-downloader:{version}`
- vision-proxy 镜像：`bilibili-downloader-vision-proxy:{version}` →
  `bilibili-downloader:vision-proxy-{version}`
- 版本仍取各包 package.json；compose `${VAR:?}` 显式版本守卫与 env 覆盖不变；
  save tar 文件名不变（NAS `docker load` 流程不受影响）

- 计划: `docs/plans/2026-09-08-docker-image-naming-plan.md`
- 审计: `docs/audits/2026-09-08-plan-audit-docker-image-naming.md`、
  `docs/audits/2026-09-08-closure-audit-docker-image-naming.md`

## 改动清单

- `packages/docker/compose.mjs`：提取 serverImage/visionProxyImage 常量，build/save
  全部消费点改用新命名
- `packages/docker/docker-compose.yml`：两服务 image 字段同步
- 文档：README.md（两处）、system-baseline.md、module-boundaries.md、
  codebase-map.md

## 验证

- `node --check compose.mjs` ✅
- `compose.mjs config` 渲染 `bilibili-downloader:0.0.1` /
  `bilibili-downloader:vision-proxy-0.0.1` ✅
- `pnpm docker:build` 实际构建出两个新 tag ✅
- `pnpm docker:save server` 导出 tar，manifest 含两个新镜像名 ✅
- 残留扫描：活动文档无旧镜像名 ✅

## 部署侧提醒

- 本机/NAS 上旧名镜像（`bilibili-downloader-server:*` /
  `bilibili-downloader-vision-proxy:*`）不被新 compose 引用，可人工清理
- 旧 `bilibili-downloader:latest`（2 周前构建）仍在本地，compose 不再使用
