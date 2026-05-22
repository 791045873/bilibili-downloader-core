# bilibili-downloader-core

一个以 Bilibili 下载为核心能力的下载引擎，方便嵌入至各种环境。

## 项目目标

本项目旨在在充分理解 `yaobiao131/downkyicore` 架构与下载流程的基础上，重新设计一个更易扩展、适合多种运行形态的 Bilibili 下载引擎。


目前项目有 6 个子包，分别是：
1. Adapter
2. Sale
3. Core
4. Docker
5. Frontend
6. Server

其中 Core 是 bilibili 下载器的核心包。Adapter 是对核心包的一些适配代码，例如：
   (a) 使用 HTTP 下载器是如何下载的
   (b) 使用 Aria2 下载器是如何下载的
   (c) B 站的权限部分是怎么做的

这些具体的业务实现在 Adapter 中，而 Core 中主要是核心逻辑的编排。

server 是下载器的后端代码，front 部分是下载器的前端代码。

Docker 是将下载器的前后端代码一起打包为镜像文件的 Dockerfile 和相关命令。

CLI 是将该功能暴露在命令行中的一个包，但是当前处于不可用的状态。

如果想要通过源码进行本地调试或者本地启动服务使用，可以直接运行 dev:server 命令和 frontend:dev 命令，然后在本地访问前端页面即可。

如果想要在 NAS 中使用的话，可以运行 docker build 命令，把 server 和 frontend 这些包打包成镜像，然后将镜像导入 NAS。

之后的步骤，你需要参考自己的 NAS 中 Docker 的使用教程。
注意在使用 Docker 的时候，宿主机的目录和容器的下载目录要能对应得上。
镜像打包之后，会默认将所有的视频资源下载到根目录下的 download 文件夹。

所以你需要将这个 download 文件夹挂载到宿主机的某个对应目录上.

## 特别提醒
整个项目是使用 AI 从 `yaobiao131/downkyicore` 迁移过来的，由于我只会 JS，所以这个项目的主要语言也是 JS 或者 TS。