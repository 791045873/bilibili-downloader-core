# Docker runtime 缺失 better-sqlite3 native binding

## 现象

修复前的 Docker 镜像可以完成构建，但容器运行时加载 `better-sqlite3` 失败，找不到
native binding。该镜像同时误包含本地运行数据，体积约 2.07GB，不能作为有效构建成果。

## 原因

builder workspace 中编译出的 native binding 没有可靠进入 `pnpm deploy --prod` 生成的
runtime 生产依赖闭包。仅验证 builder 构建成功，不能证明最终镜像中的 musl/Node ABI
binding 可用。

## 修复

`packages/docker/Dockerfile` 在生成 runtime 生产闭包后，针对
`/app/runtime/node_modules/better-sqlite3` 显式执行源码安装，并确保 builder 含
`python3`、`make`、`g++`。

## 回归证明

最终镜像必须在容器内实际加载 `better-sqlite3`、创建内存数据库并执行 SQL。Docker
构建成功、TypeScript 编译成功或模块文件存在都不能替代该运行时检查。执行证据记录在
`docs/testing/2026/08-13-docker-fix-vision-proxy-testing.md`。
