# 2026-08-13 Docker 双服务镜像改造

- 修复 Docker builder 在 Alpine 构建 `better-sqlite3` 所需的 Python、make、g++ 工具链。
- 依赖清单提前复制，并通过 BuildKit cache mount 缓存 pnpm 与 pip 下载内容，业务源码变化不会使 Node 依赖层失效。
- 使用与项目 engines 对齐的 `node:24-alpine`，builder/runtime 保持相同 Node ABI 与 libc。
- 使用 `pnpm deploy --filter @bilibili-downloader/server --prod` 生成最小 Node 生产运行时闭包，前端只复制 Vite dist。
- 镜像内加入 Python Qwen 视觉代理；入口脚本启动 Node 与 Python，外部仅暴露 3000，代理保持 127.0.0.1:8765。
- `.dockerignore` 排除 `.env`、虚拟环境、缓存与构建产物，避免敏感配置进入构建上下文。
- `.dockerignore` 进一步排除本地下载、总结截图和测试素材，减少 Docker context 传输时间。
- 验证：`pnpm typecheck`、`pnpm build` 已通过；Docker 构建与运行冒烟待命令完成后补充。
- 状态补充：修复前的 `bilibili-downloader:optimized-check` 曾构建成功，但运行时发现
  `better-sqlite3` native binding 缺失，且镜像误包含本地运行数据，不能作为最终成果。
- 已修复 runtime native binding 编译与嵌套目录排除；修复后的默认
  `node:24-alpine` 构建因基础镜像层下载长期停滞而中断，尚未产出可用于冒烟验证的新镜像。
- 待处理：在网络可稳定拉取 `node:24-alpine` 后重新执行 `pnpm docker:build`，
  完成前端、Node API、Python healthz、SQLite、Docker health、端口与进程退出验证，
  再更新计划并执行独立 closure audit。
- 2026-08-14 续作：按用户要求优化构建耗时，基础镜像切换为
  `node:24.16.0-bookworm-slim`；APT/pnpm/pip 使用可覆盖国内源，Python 依赖在独立
  venv builder 安装，runtime 仅保留 Python、FFmpeg、tini 和生产闭包。
- 最终镜像已构建成功；`pnpm typecheck`、`pnpm build`、前端、Node API、Python
  healthz/venv、better-sqlite3、FFmpeg、Docker health、单端口、日志、运行时裁剪、
  无密钥失败语义和停止清理均已验证。详细证据见 testing 文档，待独立 closure audit。
