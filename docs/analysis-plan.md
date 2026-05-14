# downkyicore 结构与下载实现分析

## 分析目标

本文面向 `yaobiao131/downkyicore` 的第一阶段调研，重点回答：

1. 原仓库的模块如何分层与协作
2. 一个视频下载任务从输入到完成的完整链路是什么
3. 哪些类和文件承担了关键职责
4. 原实现中哪些耦合点会阻碍后续抽出“可复用下载引擎”

## 仓库总体结构

`downkyicore` 当前本质上由两个主要工程组成：

- `DownKyi/`：Avalonia UI 应用层，负责界面、交互、任务列表、配置入口
- `DownKyi.Core/`：通用能力层，负责 B 站 API 访问、aria2 集成、ffmpeg 处理、设置、存储等基础能力

从目录职责看，当前项目已经存在“界面层 + 核心能力层”的初步分离，但下载编排并未完全下沉到 `DownKyi.Core`，而是大量停留在 `DownKyi/Services/Download` 中，因此核心下载能力实际上仍然依赖 UI 工程。

### `DownKyi.Core` 关键模块

- `BiliApi/`
  - B 站资源解析与接口调用
  - 包含视频信息、播放地址、番剧/课程等资源的 API 访问
  - `BiliUtils/ParseEntrance.cs` 负责输入内容的入口解析
- `Aria2cNet/`
  - aria2 RPC 客户端与服务端封装
  - 为外部下载器模式提供能力
- `FFMpeg/`
  - 音视频合并、拼接等后处理能力
- `FileName/`
  - 下载文件命名规则
- `Settings/`
  - 配置读取与管理
- `Storage/`
  - 存储初始化与数据库相关封装
- `Logging/`、`Utils/`
  - 日志与通用工具

### `DownKyi` 关键模块

- `ViewModels/`
  - 页面状态与用户交互入口
  - `ViewVideoDetailViewModel.cs` 是单视频详情与下载发起的关键入口
- `Services/Download/`
  - 当前实际的下载编排中心
  - 包含任务入队、下载调度、下载器适配、状态流转、数据库落盘
- `Models/`
  - 下载中、已完成等 UI / 持久化模型
- `Views/`
  - Avalonia 视图层

## 下载链路总览

当前实现可以概括为：

**用户输入资源 -> 解析资源标识 -> 拉取视频详情 -> 选择下载项 -> 生成下载任务 -> 后台调度任务 -> 解析播放流 -> 下载音视频/附属资源 -> ffmpeg 合并/拼接 -> 更新状态并落库**

## 关键下载流程分析

### 1. 应用启动与下载服务装配

关键入口：

- `DownKyi/App.axaml.cs`

应用启动时会完成以下动作：

1. 初始化容器与全局服务
2. 从本地存储恢复“下载中 / 已完成”任务
3. 根据设置选择下载实现：
   - `BuiltinDownloadService`
   - `AriaDownloadService`
   - `CustomAriaDownloadService`
4. 调用下载服务启动后台工作循环

这意味着下载器选择逻辑直接放在应用启动层，属于运行时入口与下载内核耦合的表现。

### 2. 用户输入解析与资源识别

关键入口：

- `DownKyi/ViewModels/ViewVideoDetailViewModel.cs`
- `DownKyi.Core/BiliApi/BiliUtils/ParseEntrance.cs`

用户在界面输入 BV/AV视频链接、番剧链接等内容后：

1. `ViewVideoDetailViewModel` 接收输入命令
2. 借助 `ParseEntrance` 判断输入类型
3. 提取 bvid / avid / 番剧标识等
4. 再通过视频信息服务拉取详情，生成详情页状态

这里解析入口相对集中，是后续抽象 `ResourceParser` 的较好基础。

### 3. 下载项选择与任务创建

关键入口：

- `DownKyi/Services/Download/AddToDownloadService.cs`

用户在详情页选择清晰度、编码、音频、字幕、封面等选项后：

1. `AddToDownloadService` 根据资源类型组织下载内容
2. 构造 `DownloadingItem`
3. 填充任务元数据、下载内容选项、流信息偏好、保存位置等
4. 写入全局下载列表
5. 通过 `DownloadStorageService` 落库

当前“任务构建”并不是一个纯领域对象转换过程，而是和 UI 模型、存储模型混合在一起。

### 4. 后台调度循环

关键入口：

- `DownKyi/Services/Download/DownloadService.cs`

`DownloadService` 是当前下载实现的中心类，承担了主调度职责：

1. 启动后台 `DoWork()` 循环
2. 轮询全局下载列表
3. 查找 `NotStarted` / `WaitForDownload` 状态任务
4. 使用 `SemaphoreSlim` 控制并发
5. 为每个任务触发 `SingleDownload()`

这是一种“轮询 + 状态列表驱动”的调度方式，简单直接，但对复用型引擎不够友好：

- 依赖进程内全局列表
- 强绑定 UI 状态对象
- 更像桌面应用内部任务管理器，而不是可嵌入引擎

### 5. 播放流解析

关键入口：

- `DownKyi/Services/Download/DownloadService.cs`
- `DownKyi.Core/BiliApi/VideoStream/VideoStream.cs`

进入单任务下载后，服务会先调用 `BaseParse()`：

1. 根据资源类型选择播放流接口
   - 普通视频
   - 番剧
   - 课程/其他类型
2. 从 `VideoStream` 获取播放地址
3. 将返回结果写入任务对象中的 `PlayUrl`
4. 后续从中选择视频流、音频流或 durl 分段信息

说明当前“解析播放流”虽然依赖 `DownKyi.Core`，但解析时机与任务生命周期管理都由 `DownloadService` 控制。

### 6. 音视频与附属资源下载

关键入口：

- `DownKyi/Services/Download/DownloadService.cs`
- `DownKyi/Services/Download/BuiltinDownloadService.cs`
- `DownKyi/Services/Download/AriaDownloadService.cs`
- `DownKyi/Services/Download/CustomAriaDownloadService.cs`

下载流程大致分为两类：

#### DASH 流

1. 选择目标视频流和音频流
2. 分别下载到临时文件
3. 等待后处理合并

#### durl / 分段流

1. 逐段下载视频片段
2. 必要时进行拼接

附属资源还包括：

- 封面下载
- 字幕下载与转换
- 弹幕下载与 ASS 生成
- NFO 元数据生成

其中真正的下载执行由不同下载器实现承担：

- `BuiltinDownloadService`：内置 HTTP 下载
- `AriaDownloadService`：通过 aria2 RPC 下载
- `CustomAriaDownloadService`：自定义 aria2 接入

现有抽象方式是“以继承区分下载器”，不是“以稳定接口 + 可插拔策略区分下载器”。

### 7. 合并、校验与结束处理

关键入口：

- `DownKyi/Services/Download/DownloadService.cs`
- `DownKyi.Core/FFMpeg/FFMpeg.cs`

下载完成后通常还要执行：

1. 音视频合并
2. 多段视频拼接
3. 文件存在性与结果校验
4. 任务状态切换为成功或失败
5. 从“下载中”迁移到“已完成”
6. 更新本地数据库
7. 触发下载后动作（打开目录、关闭程序等）

后处理和状态迁移同样集中在 `DownloadService` 中，导致它既是调度器、又是工作流执行器、还是状态管理器。

## 关键文件与职责映射

| 文件 | 主要职责 |
| --- | --- |
| `DownKyi/App.axaml.cs` | 应用启动、依赖装配、下载服务选择 |
| `DownKyi/ViewModels/ViewVideoDetailViewModel.cs` | 资源输入、详情展示、下载发起入口 |
| `DownKyi/Services/Download/AddToDownloadService.cs` | 将页面选择转换成下载任务 |
| `DownKyi/Services/Download/DownloadService.cs` | 主调度循环、单任务执行、状态流转、后处理 |
| `DownKyi/Services/Download/BuiltinDownloadService.cs` | 内置下载器实现 |
| `DownKyi/Services/Download/AriaDownloadService.cs` | aria2 下载器实现 |
| `DownKyi/Services/Download/CustomAriaDownloadService.cs` | 自定义 aria2 下载器实现 |
| `DownKyi/Services/Download/DownloadStorageService.cs` | 下载任务持久化 |
| `DownKyi.Core/BiliApi/BiliUtils/ParseEntrance.cs` | 输入内容识别与资源 ID 提取 |
| `DownKyi.Core/BiliApi/VideoStream/VideoStream.cs` | 获取播放流地址 |
| `DownKyi.Core/FFMpeg/FFMpeg.cs` | 合并与拼接 |

## 当前架构的主要问题

### 1. 下载编排层仍然依赖 UI 工程

虽然项目有 `DownKyi.Core`，但真正的下载工作流核心放在 `DownKyi/Services/Download` 中。  
这使得“下载引擎”无法直接抽离为 CLI、Skill、Docker 共用的独立能力。

### 2. 单个核心类职责过重

`DownloadService.cs` 同时负责：

- 调度
- 流解析
- 文件下载
- 附属资源处理
- 合并拼接
- 任务状态更新
- 失败重试
- 落库与结束动作

这会带来：

- 难以单元测试
- 难以替换具体环节
- 难以复用于不同运行形态

### 3. 任务模型混合了领域状态与 UI 状态

`DownloadingItem` 一类对象承载了：

- 资源元信息
- 下载配置
- 下载过程状态
- UI 展示状态

这会导致后续如果要做：

- CLI 输出
- HTTP API 返回
- 批处理调度

就不得不继续复用桌面 UI 风格的数据结构。

### 4. 下载器扩展方式不够稳定

目前通过派生不同的 `DownloadService` 子类切换下载器。  
这意味着下载器既影响“如何下载”，也影响“整体工作流”，边界不清晰。

更理想的方式应该是：

- 工作流编排稳定
- 下载器只负责文件传输
- ffmpeg / aria2 / builtin downloader 都作为插件式能力接入

### 5. 状态驱动依赖全局列表与轮询

当前任务调度基于内存列表与后台轮询。  
这在桌面应用可行，但对以下形态不够友好：

- CLI 一次性执行
- Docker 批任务
- 长驻服务型 API
- 分布式调度

### 6. 配置、存储、执行耦合明显

下载服务内部直接依赖全局设置、数据库服务、应用容器。  
这会使后续很难做到：

- 无状态执行
- 纯内存测试
- 外部注入存储实现
- 不同运行时独立配置

## 对新下载引擎设计的启发

基于以上分析，新的 Bilibili 下载引擎在设计上应优先满足：

1. **引擎核心从 UI 中独立**
   - 资源解析、任务编排、下载执行、后处理必须全部下沉到可复用模块
2. **以接口边界替代继承扩展**
   - 解析器、下载器、后处理器、存储适配器都应可替换
3. **任务模型拆分**
   - 区分输入请求、运行时任务、进度事件、最终产物
4. **事件化输出**
   - 让 CLI、Skill、Docker、HTTP API 都通过统一事件消费进度
5. **工作流分阶段**
   - 解析 -> 规划 -> 下载 -> 合并 -> 校验 -> 产物落盘
6. **运行时入口解耦**
   - CLI / Skill / Docker 只负责参数适配与结果展示，不负责下载细节

## 建议的下一步分析输出

在本阶段结论基础上，后续文档可进一步拆成：

1. 新引擎目标能力清单
2. 模块化架构草图
3. MVP 范围定义
4. CLI / Skill / Docker 适配层边界
5. 迁移策略：哪些能力可先复用，哪些能力需要重写

## 结论

`downkyicore` 已经具备较完整的 B 站下载功能，但它的“下载能力”仍主要服务于桌面 UI 应用。  
其核心问题不是功能不够，而是下载工作流、状态模型、配置与运行时入口之间耦合较深。

因此，新项目的首要任务不是直接复刻原实现，而是先把以下边界重新建立起来：

- 资源解析边界
- 下载编排边界
- 下载器适配边界
- 后处理边界
- 事件与状态边界
- 运行时入口边界

这也是后续重设计“更易扩展、适合多种运行形态”的下载引擎的基础。
