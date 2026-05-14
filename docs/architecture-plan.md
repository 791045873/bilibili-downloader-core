# Bilibili 下载引擎 MVP 范围与模块架构设计

## 背景与目标

基于第一步对 `yaobiao131/downkyicore` 的分析，本阶段先明确可交付的 MVP 边界，再给出可扩展的模块架构。  
设计原则：

- 引擎核心独立于运行形态（CLI / Skill / Docker）
- 下载链路可替换、可测试、可观测
- 解析、编排、传输、后处理、存储解耦

---

## 一、MVP 功能范围定义

### 1.1 MVP 目标

在最小可用范围内交付“单视频可稳定下载”的端到端能力，并提供 CLI 入口，作为后续 Skill / Docker 的统一底座。

### 1.2 范围内（In Scope）

#### A. 资源输入与解析

- 支持输入 `BV`、`AV`、视频 URL
- 解析为统一资源标识（如 `bvid` + `cid`）
- 基础合法性校验与错误提示

#### B. 单视频下载链路

- 获取视频详情与播放流信息
- 支持音视频流选择（至少清晰度与编码的基础选择能力）
- 下载音频流与视频流到临时目录
- 调用 ffmpeg 合并为最终 mp4

#### C. 下载任务执行能力

- 单任务执行（优先保证稳定性）
- 基础重试（网络请求与文件下载）
- 基础进度事件（开始、下载中、合并中、完成、失败）

#### D. 输出与文件管理

- 可配置输出目录
- 统一命名策略（MVP 先支持默认模板）
- 临时文件清理策略（成功后清理，失败保留可配置）

#### E. CLI 运行形态

- 提供命令行入口触发下载任务
- 支持最小必要参数（输入、输出目录、清晰度/编码偏好）
- 输出结构化日志与最终结果摘要

### 1.3 范围外（Out of Scope）

以下能力明确不进入本次 MVP：

- 分 P/合集/番剧/课程等复杂资源批量下载
- 登录态与 Cookie 管理
- 字幕、弹幕、封面、NFO 等附属资源处理
- 多下载器并存（如 aria2 插件化接入可放在下一阶段）
- Web UI / HTTP API / 调度中心
- 限速、复杂并发调度、任务持久化队列

### 1.4 MVP 验收标准

- 给定一个有效 BV 或视频 URL，CLI 可完成端到端下载与合并
- 输出文件可播放，且文件名与目录符合预期
- 失败场景可返回明确错误类别与阶段信息
- 引擎核心不依赖 CLI 层类型，可被其他运行形态复用

---

## 二、新模块架构设计

## 2.1 分层结构

建议采用“核心域 + 适配器 + 运行时入口”三层：

1. **Core（核心域层）**
   - 仅包含下载领域模型、用例编排、领域接口
   - 不依赖具体网络库、命令行框架、数据库

2. **Adapters（基础设施适配层）**
   - 提供 Core 所需接口的具体实现
   - 如 Bilibili API、HTTP 下载器、ffmpeg、文件系统、日志

3. **Runtimes（运行时入口层）**
   - CLI / Skill / Docker 的参数解析与结果输出
   - 仅编排用例调用，不承载下载细节

## 2.2 核心模块划分

### A. `engine.domain`

职责：

- 定义领域对象：`DownloadRequest`、`DownloadPlan`、`DownloadArtifact`、`DownloadError`
- 定义任务状态机：`Created -> Resolving -> Downloading -> Merging -> Completed/Failed`
- 定义领域事件：`TaskStarted`、`StreamSelected`、`ProgressChanged`、`TaskCompleted`、`TaskFailed`

### B. `engine.usecases`

职责：

- 实现 MVP 主用例：`DownloadSingleVideoUseCase`
- 编排标准阶段：
  1) 解析输入  
  2) 获取资源元信息  
  3) 选择流  
  4) 下载媒体  
  5) 合并产物  
  6) 输出结果
- 统一异常映射与错误码

### C. `engine.ports`

职责：

- 声明可替换接口（Ports）：
  - `ResourceParserPort`
  - `VideoMetadataProviderPort`
  - `StreamProviderPort`
  - `MediaDownloaderPort`
  - `MediaMergerPort`
  - `FileStorePort`
  - `EventPublisherPort`

### D. `engine.adapters.bilibili`

职责：

- 实现 B 站资源解析、详情查询、播放流查询
- 将外部 API 返回转换为 Core 可消费模型

### E. `engine.adapters.transport`

职责：

- 实现媒体下载（MVP 可先提供内置 HTTP 下载器）
- 处理重试、超时、断点续传能力（MVP 先实现基础重试）

### F. `engine.adapters.ffmpeg`

职责：

- 实现音视频合并接口
- 输出合并过程日志与错误映射

### G. `engine.adapters.fs`

职责：

- 输出目录管理、临时目录管理、原子落盘与清理策略

### H. `runtime.cli`

职责：

- 命令参数到 `DownloadRequest` 的转换
- 订阅领域事件并渲染终端输出
- 将 `DownloadResult` 转换为进程退出码

## 2.3 端到端调用关系

`runtime.cli`  
-> `DownloadSingleVideoUseCase`  
-> `ResourceParserPort` / `VideoMetadataProviderPort` / `StreamProviderPort`  
-> `MediaDownloaderPort`  
-> `MediaMergerPort`  
-> `FileStorePort`  
-> `DownloadResult`

事件流由 `EventPublisherPort` 对外广播，CLI/Skill/Docker 均可复用同一事件语义。

## 2.4 扩展点预留

在不破坏 MVP 核心的前提下预留以下扩展：

- 新资源类型解析器（番剧/合集）
- 新下载器实现（aria2）
- 新运行时入口（Skill / Docker / HTTP API）
- 新后处理器（字幕、封面、元数据）
- 新存储后端（本地 DB / 远程任务队列）

---

## 三、MVP 到下一阶段的演进路径

1. **先打通单视频闭环**  
   以 CLI 为唯一入口，验证 Core+Adapter 边界是否稳定。

2. **再增加运行形态**  
   优先复用同一 UseCase，新增 Skill 与 Docker 包装层。

3. **最后扩展资源与下载能力**  
   逐步加入番剧/合集、登录态、附属资源、并发与调度。

---

## 四、交付清单（本阶段）

- MVP 范围定义（本文第一部分）
- 模块架构与职责边界（本文第二部分）
- 统一演进路径（本文第三部分）

该文档作为后续实现阶段的蓝图，下一步可据此拆分具体开发任务与里程碑。
