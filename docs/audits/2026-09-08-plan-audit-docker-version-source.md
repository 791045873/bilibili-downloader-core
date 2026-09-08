# Plan Audit: Docker 镜像版本来源统一为 package.json

日期: 2026-09-08
类型: plan audit（independent subagent）
对象: `docs/plans/2026-09-08-docker-version-source-plan.md`
结论: 首轮 **fail** → 计划修正后复审 **pass**（技术方案 compose.mjs:19-28 换源
设计本身无需变更）

## 首轮 fail 项（已全部回填计划）

1. **状态/审计预填失实**：计划头部曾预填 `implemented` 与不存在的审计记录 →
   已改正，本文件为真实审计记录
2. **vision-proxy package.json 现状误判**：计划曾称"该文件不存在需新建"；
   实际已存在（version 0.0.1、private、scripts setup/start，2026-08-18 extract
   计划创建）→ 产出物改为复用现有文件；workspace install 副作用风险不成立
3. **活动文档遗漏**：`docs/architecture/system-baseline.md:58` 与
   `README.md:28` 同样写有 pyproject.toml 来源 → 已补入产出物
4. 验证补充：无参运行 exit 1 为预期；解析值断言；`pyproject.toml 的 version`
   残留 grep 闭环门

## 核验通过

- compose.mjs 改动点仅 readVisionProxyVersion（:19-28 含 :26 错误信息）；
  versions 消费方（tag 校验 :36-44、build/save 拼接 :97/:108-112）、.env 回写
  （:46-68）、compose 插值（docker-compose.yml:8/:26）均与来源无关
- pyproject `version` 为 setuptools [project] 必填且 Dockerfile.vision-proxy
  pip install 依赖，保留正确；`#` 注释对 setuptools/pip 无影响
- `pnpm docker:*` 根 package.json scripts 经 compose.mjs 派发，无其他入口
- 历史过程文档（docs/plans/audits/logs 2026/08-24）不改写，可接受
