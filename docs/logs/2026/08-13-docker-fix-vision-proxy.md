# 2026-08-13 Docker 双服务镜像改造

- 修复 Docker builder 在 Alpine 构建 `better-sqlite3` 所需的 Python、make、g++ 工具链。
- 依赖清单提前复制，并通过 BuildKit cache mount 缓存 pnpm 与 pip 下载内容，业务源码变化不会使 Node 依赖层失效。
- 使用与项目 engines 对齐的 `node:24-alpine`，builder/runtime 保持相同 Node ABI 与 libc。
- 使用 `pnpm deploy --filter @bilibili-downloader/server --prod` 生成最小 Node 生产运行时闭包，前端只复制 Vite dist。
- 镜像内加入 Python Qwen 视觉代理；入口脚本启动 Node 与 Python，外部仅暴露 3000，代理保持 127.0.0.1:8765。
- `.dockerignore` 排除 `.env`、虚拟环境、缓存与构建产物，避免敏感配置进入构建上下文。
- `.dockerignore` 进一步排除本地下载、总结截图和测试素材，减少 Docker context 传输时间。
- 验证：`pnpm typecheck`、`pnpm build` 已通过；Docker 构建与运行冒烟待命令完成后补充。
