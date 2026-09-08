# Plan: Docker 镜像版本统一以各包 package.json 为来源

日期: 2026-09-08
状态: implemented
Autonomy: 用户直接请求的部署配置变更（用户已确认来源选择）
Audit: fail→修正后复审 pass（`docs/audits/2026-09-08-plan-audit-docker-version-source.md`；
首轮 fail 项：状态预填失实、vision-proxy package.json 现状误判、遗漏两处活动文档）

## 需求（用户确认）

镜像 tag 版本来源统一为 package.json：

- server 镜像：`packages/server/package.json` 的 `version`（现状不变）
- vision-proxy 镜像：改为 `packages/vision-proxy/package.json` 的 `version`
  （该文件已存在：version 0.0.1、private、scripts setup/start；现状 compose.mjs
  取的是 pyproject.toml）
- `SERVER_VERSION` / `VISION_PROXY_VERSION` 环境变量覆盖行为保持不变

## 现状与理由

- compose.mjs:19-28 从 `packages/vision-proxy/pyproject.toml` 读版本。
- pyproject.toml 的 `version` 属 Python 打包语义（setuptools [project] 必填，
  Dockerfile.vision-proxy:31 依赖该文件安装依赖），不应承担镜像 tag 职责；
  保留其字段（Python 语义），加注释指明镜像 tag 来源为 package.json。
- 两个镜像版本仍各自独立解析（与现状一致），仅 vision-proxy 换源。

## 产出物

1. 复用现有 `packages/vision-proxy/package.json`（version 0.0.1，已是 pnpm
   workspace 成员，无需新建/无需改结构）
2. 修改 `packages/docker/compose.mjs`：`readVisionProxyVersion` 改读该
   package.json，错误信息同步更新
3. 修改 `packages/docker/.env.example:7` 注释
4. 修改 `docs/architecture/system-baseline.md:58` 与 `README.md:28` 的版本
   来源表述（首轮审计发现的活动文档遗漏）
5. 更新 `docs/context/codebase-map.md` Docker 行（pyproject.toml → package.json）
6. `packages/vision-proxy/pyproject.toml` 加注释（仅指镜像 tag 来源变更，
   Python 包版本仍以本文件为准）
7. 日志 `docs/logs/2026-09-08-docker-version-source.md`

## 风险与对策

- pyproject.toml 的 `version` 属 setuptools [project] 必填（Python 打包语义，
  Dockerfile.vision-proxy 依赖），保留不动；镜像 tag 来源为 package.json，
  两字段并存存在漂移可能：注释 + 日志声明升版本时人工同步。
- 无新增 workspace 包（vision-proxy package.json 本就是成员），无 install 副作用。

## 验证

- `node packages/docker/compose.mjs`：版本解析与输出先于 argv 分派，无参运行
  会打印 `[compose.mjs] server=... vision-proxy=...` 后以 usage 错误 **exit 1**
  （预期行为，非失败）；同时刷新 packages/docker/.env（已 gitignore）
- 断言解析值 === 两个 package.json 的 version 字面值（脚本比对，不只肉眼）
- 残留扫描门：`grep "pyproject.toml 的 version"` 于 docs/ 活动文档与 README.md
  应无残留（历史 plans/audits/logs 不改写）
- 如本机 docker 可用：`node packages/docker/compose.mjs config` 验证 compose
  渲染；镜像实际构建由用户执行（`pnpm docker:build`）

## 明确不做

- 不改 Dockerfile、不改 pyproject 版本值、不引入版本联动脚本
