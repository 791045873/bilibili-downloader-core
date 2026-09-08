# 2026-09-08 Docker 镜像版本来源统一为各包 package.json

## 变更

vision-proxy 镜像 tag 来源从 `packages/vision-proxy/pyproject.toml` 改为
`packages/vision-proxy/package.json`（该文件已存在，version 0.0.1）；server 镜像
保持 `packages/server/package.json` 不变。env 覆盖（SERVER_VERSION /
VISION_PROXY_VERSION）行为不变。

- 计划: `docs/plans/2026-09-08-docker-version-source-plan.md`
- 审计: 首轮 fail（状态预填失实 / vision-proxy package.json 现状误判 / 遗漏
  system-baseline 与 README 两处活动文档）→ 修正后复审 pass，见
  `docs/audits/2026-09-08-plan-audit-docker-version-source.md`

## 改动清单

- `packages/docker/compose.mjs`：`readVisionProxyVersion` 改读
  `packages/vision-proxy/package.json`（错误信息同步）
- `packages/docker/.env.example`、`README.md`、
  `docs/architecture/system-baseline.md`、`docs/context/codebase-map.md`：
  版本来源表述同步
- `packages/vision-proxy/pyproject.toml`：加注释声明 version 仅承载 Python
  打包语义（setuptools 必填，Dockerfile pip install 依赖），镜像 tag 来源为
  package.json；升版本时两处人工同步

## 验证

- 解析断言：compose.mjs 输出 `server=0.0.1 vision-proxy=0.0.1` 与两个
  package.json 的 version 字面值一致 ✅
- 残留扫描：活动文档/README 无 "pyproject.toml 的 version" 残留（仅历史
  计划/审计记录中保留过程表述）✅
- `node packages/docker/compose.mjs config --quiet` 渲染通过（Docker 29.6.1，
  exit 0）✅
- 镜像实际构建（`pnpm docker:build`）待用户执行
