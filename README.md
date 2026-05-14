# bilibili-downloader-core

一个以 Bilibili 下载为核心能力的下载引擎，方便嵌入至各种环境。

## 项目目标

本项目旨在在充分理解 `yaobiao131/downkyicore` 架构与下载流程的基础上，重新设计一个更易扩展、适合多种运行形态的 Bilibili 下载引擎。

目标运行形态包括：

- CLI：命令行下载工具
- Skill：可嵌入的能力调用接口
- Docker：容器化部署与批处理运行
- 后续可扩展 HTTP API / Web UI / 调度任务

## 当前阶段

当前仓库处于 **规划与分析阶段**，优先完成：

1. 对 `downkyicore` 的结构和下载实现进行分析
2. 设计新的模块化架构
3. 明确 MVP 范围
4. 规划 CLI / Skill / Docker 三种适配层

## 里程碑

### Milestone 1：原仓库分析与架构设计
- 梳理 Bilibili 资源解析流程
- 梳理下载、鉴权、合并、命名等关键模块
- 输出新架构设计与开发计划

### Milestone 2：MVP 下载能力
- 支持单视频解析与下载
- 支持音视频流选择
- 支持 ffmpeg 合并
- 提供 CLI 入口

### Milestone 3：增强能力
- 支持分P / 合集 / 番剧���资源
- 支持 Cookie / 登录态
- 支持重试、并发、限速
- 支持字幕、封面、元数据处理

### Milestone 4：多形态适配
- Skill 接口
- Docker 镜像
- 批量任务执行

## 文档

- `docs/analysis-plan.md`：原仓库分析重点与调研方法
- `docs/architecture-plan.md`：新架构设计与模块拆分
- `ROADMAP.md`：分阶段计划

## 注意事项

实现时需要特别注意：

- 下载链路应设计为可替换、可测试、可观测
- 解析逻辑与运行时入口（CLI / Skill / Docker）解耦
- 保留后续扩展到其他站点或协议的空间
- 在合法合规前提下使用本项目
