# 2026-08-18 Python 视觉代理包目录归属讨论

## 需求来源

用户会话中提出：Python 视觉代理与 Node server 已分别打包为两个 Docker 镜像（`vision-proxy` / `server`），询问是否有必要将 Python 服务从 `packages/server/python/` 中拆出，作为仓库中单独的子包存在。经评估推荐拆分，用户确认按推荐方向推进。

## 现状

- Python 视觉代理源码位于 `packages/server/python/`（`pyproject.toml` + `qwen_vision_proxy.py`），但部署形态已是独立容器 `vision-proxy`（compose 双容器，见 `docs/plans/2026-08-18-docker-split-vision-proxy-plan.md`）。
- Docker 打包边界已独立：`python-builder` / `vision-proxy` 阶段只引用 `packages/server/python/` 下两个文件；server 镜像构建时 `COPY packages/server/ packages/server/` 仍会携带该目录，随后 `rm -rf /app/python` 主动剥离（等于为目录归属错误打补丁）。
- 宿主开发模式经根目录 `scripts/setup-vision-proxy.mjs` / `scripts/start-vision-proxy.mjs` 按 `packages/server/python` 路径管理 `.venv` 与启动。
- `qwen_vision_proxy.py:70-71` 用 `Path(__file__).resolve().parents[1] / ".env"` 加载 `packages/server/.env`（开发模式密钥来源，与 server 共享同一 env 文件）。
- 仓库约定 `packages/*` 即 pnpm workspace 子包（core / adapters / server / frontend / docker / bilibili-api-sdk 均有 package.json）；vision-proxy 是唯一"独立部署单元却挂在别包目录下"的例外。

## 决策点

1. **是否拆分**：拆分。理由见下，收益为结构一致性与构建上下文瘦身。
   - 结构一致性：Docker 部署边界已独立，代码目录应反映该事实；`docs/architecture/module-boundaries.md` 已声明"Python 只做薄代理、不加入业务语义"的边界，物理布局应一致。
   - 构建上下文：`COPY packages/server/` 不再携带 `server/python`（含本机 `build/`、`*.egg-info`、`__pycache__` 等未纳入 `.dockerignore` 的产物），`rm -rf /app/python` 可删除。
   - 备选（不拆分）：功能上可继续工作，但上述两点残留，且新人在 codebase-map 上看到的路径与部署形态不一致。
2. **新位置与子包身份**：新建 `packages/vision-proxy/`，并补一个最小 `package.json`（`@bilibili-downloader/vision-proxy`，private，无 build/typecheck 脚本，`setup`/`start` 委托根目录脚本），使其与其余 `packages/*` 一样成为 pnpm workspace 子包。
   - 备选：不建 package.json，仅移动目录——pnpm 会忽略无 package.json 的目录，功能不受影响，但与仓库"packages/* 即子包"约定不一致。
   - 代价：新增 workspace importer，需 `pnpm install` 重新生成 `pnpm-lock.yaml` 并提交；`pnpm -r build` / `pnpm -r typecheck` 因无对应脚本自动跳过，不受影响。
3. **代理开发模式 env 归属**：`qwen_vision_proxy.py` 的 `load_dotenv` 从 `parents[1] / ".env"`（即 `packages/server/.env`）改为 `parent / ".env"`（即 `packages/vision-proxy/.env`）。
   - 理由：拆分后代理与 server 各自拥有 env 文件，符合子包独立原则；Docker 模式密钥仍经 compose 注入，不受影响。
   - 行为变更提示：宿主开发模式下 `DASHSCOPE_API_KEY` 等需从 `packages/server/.env` 迁至 `packages/vision-proxy/.env`（本地 `packages/server/.env` 含密钥，属 .gitignore 忽略文件，不由实施过程自动搬运，仅文档说明）。
4. **宿主脚本与 venv**：根目录两个脚本保留原位（仓库级工具），仅更新内部路径常量至 `packages/vision-proxy`；`.venv` 不可搬迁（Windows 下 pyvenv.cfg 绝对路径失效），实施时删除旧目录遗留产物并重建于新位置。
5. **Dockerfile**：`python-builder` 与 `vision-proxy` 阶段的 COPY 路径改为 `packages/vision-proxy/`；server 阶段删除 `rm -rf /app/python`（目录已不存在，保留无意义）。

## 待确认（非阻塞）

- 新目录名使用 `vision-proxy` 与镜像/服务名一致；如需其他命名（如 `python-vision-proxy`）可在 plan audit 阶段提出。

## 推进路径

- 已解析结论写入 `docs/architecture/module-boundaries.md`（新增 vision-proxy 边界段）与 `docs/context/codebase-map.md`、`docs/architecture/2026-07-06-video-analysis-baseline.md`、`README.md`。
- 完整 plan 已创建：`docs/plans/2026-08-18-extract-vision-proxy-package-plan.md`（涉 deployment 保护区域，plan audit 使用独立 subagent 复核）。