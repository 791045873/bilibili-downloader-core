# Plan Audit: Docker 镜像命名统一为 bilibili-downloader 仓库

日期: 2026-09-08
类型: plan audit（independent subagent）
对象: `docs/plans/2026-09-08-docker-image-naming-plan.md`
结论: **pass-with-conditions**（条件已回填计划）

## 核验通过

- compose.mjs 镜像名消费点共 3 处（build tag、save 合并、save 单独），
  产出物全覆盖；tar 文件名由 cmd 派生，与镜像名解耦可行
- build -t 与 compose image 经 compose.mjs env 注入保证版本一致，不会重建/
  找不到镜像
- pyproject.toml Python 包名、历史文档（plans/logs/testing/audits/discussions）
  无需改动；无 .github/scripts/AGENTS.md 引用
- 组合 tag `vision-proxy-0.0.1` 符合 docker tag 规则

## 已回填计划的条件

1. 计划头部状态/审计引用与磁盘事实一致（本文件为真实审计记录）
2. 文档同步补齐遗漏：`README.md:38`、`docs/architecture/module-boundaries.md:56`
3. 验证补齐：`node --check compose.mjs`、一条 `docker:save-server` 实测
4. 明写两侧完整镜像名模板串，防 `vision-proxy-` 前缀单侧错配
5. 修正 TAG_RE 表述（其只校验版本值，不校验组合 tag）
