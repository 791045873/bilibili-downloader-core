# Docker 双服务镜像验证记录

## 验证范围

- 镜像可以在干净构建上下文中完成构建，且依赖锁文件变化之外的业务源码修改不会重新安装 Node 依赖。
- runtime 不包含 Vite、TypeScript、Nest CLI 等前端/编译开发依赖，server 仍可加载全部 workspace 生产依赖。
- 镜像运行时包含 Node 服务、前端静态产物、FFmpeg 和 Python 视觉代理。
- 容器只对外发布 Node/前端入口端口；Python 代理仅监听容器内回环地址。
- 通过已发布端口可以访问前端页面和 Node API，Python `/healthz` 可从容器内部访问。
- 未提供 `DASHSCOPE_API_KEY` 时，Python 代理不会伪装成可用的模型调用，但健康检查仍可用。
- 容器停止时，后台 Python 进程不会被启动脚本遗留为独立运行进程。

## 结果

### 通过

- [x] `pnpm docker:build`（用户手动构建成功，镜像
  `sha256:f69290633cf087b32277af13b0a084ce1b10e9002e3a32c14b21149324876fda`）
- [x] Docker build context 不包含 `downloads`、`summaryDir`、`test_assets`、`.env`
- [x] 运行容器并通过宿主映射端口访问前端 HTML（HTTP 200，`text/html`）
- [x] 运行容器并通过宿主映射端口访问 Node API（`/api/download/config` 返回
  `{"outputDir":"/download","source":"env"}`）
- [x] 容器内部访问 `http://127.0.0.1:8765/healthz` 返回 200 和
  `{"status":"ok"}`
- [x] Docker health status 在 Node 与 Python 均运行时为 healthy（连续检查 exit 0）
- [x] 容器内部确认 Python 代理导入 `dashscope`、`dotenv`，且
  `sys.executable=/opt/vision-venv/bin/python`
- [x] 容器内部实例化 `better-sqlite3` 内存数据库并建表、写入、查询成功
- [x] 容器内存在 `/app/dist/main.js`、`/app/public/index.html`，入口脚本成功启动
- [x] 容器内部不存在 `vite`、`typescript`、`@nestjs/cli`、pip、make、g++
- [x] 容器停止后 Node 与 Python 进程均退出；0.44 秒内完成，未 OOM、未超时强杀

### 明确裁定

- [x] 不对外暴露 8765：`docker port` 仅列出 3000；该端口只供同容器 Node 调用
- [x] 不在镜像中写入 `DASHSCOPE_API_KEY`：运行期 env 无该键；无 key POST 返回 500 和明确错误
- [x] 不执行真实 DashScope 模型调用：需要用户密钥和外部网络，超出本地镜像冒烟验证范围
- [x] `docker stop` 的容器退出码为 143：entrypoint 保留 Node 的 SIGTERM 退出码；
  两个子进程已快速清理且未被超时强杀，符合当前设计，不判为失败

## 执行证据

- `pnpm typecheck`：exit 0。
- `pnpm build`：exit 0。
- 旧 Docker 26 的 `docker buildx build --check` 记录不可复现（该 CLI 返回
  `unknown flag: --check`），不再作为验收依据；本轮以真实镜像构建和容器运行验收为准。
- 修复前的 `bilibili-downloader:optimized-check` 镜像曾成功生成，但运行时
  `better-sqlite3` native binding 缺失，且大小约 2.07GB；该结果判定为不通过。
- 已在 Dockerfile 中增加 runtime 闭包内的 `better-sqlite3` 源码编译，并通过
  `.dockerignore` 排除嵌套 `downloads`、`summaryDir`、`test_assets`。
- 修复后执行默认 `pnpm docker:build` 时，`node:24-alpine` 的约 53.10MB 基础镜像层
  在约 95 分钟后仅下载至 33.55MB，任务被中断，未生成新镜像。
- 2026-08-14 切换为 `node:24.16.0-bookworm-slim`：Node builder、Python venv
  builder、runtime 分离；APT/pnpm/pip 默认使用可覆盖的国内源，runtime 不含 pip 和编译工具。
- 首次 Debian 自动构建在 slim 镜像缺少 CA 证书时访问 HTTPS APT mirror 失败；默认
  `APT_MIRROR` 改为 HTTP 清华源后由用户手动构建成功。APT 仓库内容仍由 Debian Release
  签名校验。
- 镜像 inspect：内容大小 `306806570` bytes，只声明 `3000/tcp`，
  entrypoint 为 `tini -- /app/entrypoint.sh`。`docker image ls` 在当前 Docker
  Desktop/containerd 显示 1.22GB，属于不同存储口径；history 中最大应用层为
  Debian `ffmpeg + python3 + tini` 系统依赖层，约 513MB 展开大小。
- 进程树验证：`tini -> entrypoint.sh -> vision venv Python + Node`。
- runtime 可写 `/download` 与 `/download/logs`，实际生成
  `server-2026-08-13.log`、`vision-proxy.log`；镜像不含 `.env` 和本地运行/测试目录。
- 构建源参数未进入 runtime env，未残留 `.npmrc`/`pip.conf`。
- `pnpm typecheck`、`pnpm build`：本轮均 exit 0。
- 当前结论：最终镜像构建、容器运行与所有既定冒烟方向已通过或明确裁定。
