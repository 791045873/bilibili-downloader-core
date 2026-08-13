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

- [ ] `pnpm docker:build`
- [ ] Docker build context 不包含 `downloads`、`summaryDir`、`test_assets` 等本地运行/测试素材
- [ ] 运行容器并通过宿主映射端口访问前端 HTML
- [ ] 运行容器并通过宿主映射端口访问 Node API
- [ ] 容器内部访问 `http://127.0.0.1:8765/healthz` 返回 200
- [ ] Docker health status 在 Node 与 Python 均运行时为 healthy
- [ ] 容器内部确认 Python 代理导入 `dashscope`、`dotenv`
- [ ] 容器内部实例化 `better-sqlite3` 内存数据库成功
- [ ] 容器内存在 `/app/dist/main.js` 且入口脚本可以启动该文件
- [ ] 容器内部不存在 `vite`、`typescript` 等仅构建所需的开发依赖
- [ ] 容器停止后 Node 与 Python 进程均退出

### 明确裁定

- [ ] 不对外暴露 8765：该端口只供同一容器内的 Node 服务调用
- [ ] 不在镜像中写入 `DASHSCOPE_API_KEY`：密钥由运行期环境变量注入
- [ ] 不执行真实 DashScope 模型调用：需要用户密钥和外部网络，超出本地镜像冒烟验证范围

## 执行证据

待 Docker 构建与容器冒烟执行后补充命令、退出码和关键响应。
