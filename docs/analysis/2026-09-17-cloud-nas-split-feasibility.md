# 云端 / NAS 职责重划分可行性全局分析（2026-09-17）

## 0. 结论摘要

用户需求：视频下载与"基于已下载高清视频的截图"保留在 NAS；其余功能尽可能放到云端服务器，以便外部访问，同时控制流量与存储成本。

分三个问题回答：

1. **技术方向是否可行？—— 可行。** 没有根本性技术障碍：数据库已经在云端 PostgreSQL，公开图片已经在腾讯云 COS，路径语义已收敛为"相对 `DOWNLOAD_ROOT`"单一锚点（`packages/server/src/paths/path-anchor.ts`），ports/adapters 与 server 已解耦。NAS 完全可以作为一个"数据面 worker"与云端"控制面"通过共享云数据库协作。
2. **今天能否直接照该需求实施？—— 不能。** 当前 server 是一个把「HTTP API + 下载调度 + 本地文件管线 + AI 编排」绑死在同一个进程、且假定直接访问 NAS 卷的单体应用：调度队列在内存、降级路径是进程内同步调用、多个云侧读接口直接读 NAS 磁盘。把它拆成跨主机的控制面 / 数据面，属于一次涉及数据模型（持久化队列）、部署形态（保护区）、多模块边界的架构改造，需要先出需求 + 计划 + 独立审计 + 人工批准部署。
3. **建议路线？—— 分两步。** 第一步（小切片、可先做）把「读取侧」对 NAS 磁盘的依赖解耦到 DB/COS，让云端能独立服务对外只读与问答；第二步（大需求）再评估把下载/截图下沉为 NAS worker、其余编排上云。

本文为 `research-only` 分析，不改变任何产品行为。结论建立在当前代码（2026-09-17 工作区）与既有讨论 `docs/discussions/2026-08-21-summary-cloud-knowledge-base.md` 之上。

---

## 1. 需求拆解：功能应落在哪一侧

| 分类 | 功能 | 是否依赖本地媒体文件 |
| --- | --- | --- |
| **A. 必须留在 NAS（数据面）** | 视频流下载、音视频 FFmpeg 合并、低清分析视频下载、高清视频截图、vision-proxy 本地文件多模态读取、原始视频 / 截图存储 | 是（大体积、本地路径） |
| **B. 可无痛上云（控制面，无本地媒体依赖）** | 前端静态资源、设置 / 提示词 CRUD、视频解析（纯网络）、下载任务 CRUD / 状态、知识发布（COS + DB）、embedding / 向量检索、RAG 问答、通知 | 否 |
| **C. 有争议（同时需要云状态 + NAS 文件）** | AI 分析编排（多模态 LLM 调用）、总结 md 读取、`/summary-files` 静态图片、完整性检查、总结重建（rebuild/repair）、COS 发布读本地 md + 截图 | 是（编排本身可在云，媒体访问必须在 NAS） |

关键判断：**A 类确实只能留 NAS；B 类今天就已经是云友好的；真正的工程量在 C 类**——它们既是业务编排（想上云的部分），又直接触碰本地媒体文件（必须在 NAS 的部分）。

---

## 2. 现状架构关键事实（带证据）

| 事实 | 证据 |
| --- | --- |
| 两个容器共享同一宿主机卷 `/download`，server 与 vision-proxy 都直读它 | `packages/docker/docker-compose.yml:17-18,58-59` |
| 所有磁盘路径以 `DOWNLOAD_ROOT` 为唯一根，DB 中存相对路径，读侧恒 `join(DOWNLOAD_ROOT, value)` | `packages/server/src/paths/paths.service.ts:24-49`；`docs/design/app-overview.md:48` |
| 总结 md 与截图都在 `DOWNLOAD_ROOT/summary/` 下，并由 server 进程用 `useStaticAssets` 挂到 `/summary-files` | `packages/server/src/main.ts:24-27`；`paths.service.ts:47-49` |
| 下载调度是进程内内存态：`Set` / 数组 + 回调，重启靠 DB 对账恢复 | `packages/server/src/download/download-scheduler.ts:30-42,53-93` |
| 分析与下载在同进程用回调串联（下载完成 → 触发分析） | `packages/server/src/analysis/analysis-trigger.service.ts:86-171` |
| 截图源解析含**同步**回退下载（最长 10 分钟超时） | `packages/server/src/analysis/analysis-video-resolver.ts:270-315` |
| 截图源**优先走 B 站远端流**，失败才回退本地文件 | `analysis-video-resolver.ts:173-195` |
| LLM 分析把本地媒体路径直接传给需要本地文件能力的 vision-proxy | `packages/server/src/analysis/analysis-engine.ts:153-165` |
| COS 发布需读本地 md、上传本地截图、回写 md | `packages/server/src/knowledge/knowledge-publisher.service.ts:123-138` |
| 完整性检查 / 修复需读本地 md 与截图 | `summary-integrity.service.ts:105-119`；`summary-repair.service.ts:134-146` |
| 数据库已经是云端阿里云 RDS；用户照片已存 COS | `docs/architecture/system-baseline.md:33,64-65`；`docs/design/app-overview.md:104` |
| 既有讨论已识别"上云后 md 应改为从 raw_response 实时渲染""rebuild 云端无视频不可用" | `docs/discussions/2026-08-21-summary-cloud-knowledge-base.md:56,61-65,277-278` |
| 部署属保护区（`ask-first`） | `docs/context/ai-autonomy-policy.md:63` |

---

## 3. 需求 vs 现状：差距逐项

### 3.1 几乎零成本即可上云的部分

- **前端**：本来就是 server 同源托管的静态资源，放到云端只需把 API 指向云。
- **DB / 设置 / 提示词 / 任务 CRUD / 解析 / 知识发布 / 向量检索 / RAG / 通知**：只依赖云数据库 + COS + 外部 API，迁移到云端运行不需要触碰本地文件。
- 这部分是需求的"其余功能"主体，且已经成为云友好形态。

### 3.2 被耦合挡住、必须改造的部分

1. **缺少统一的持久化作业队列。** 高清下载已有持久化认领（`task` 行 `created → downloading` 守卫 UPDATE，`database.service.ts:586-609`），但并发槽位、低清队列（`download-scheduler.ts:30-33,220-291`）与下载完成→分析的触发回调（`analysis-trigger.service.ts:86-171`）都在进程内。跨主机后，云端下单、NAS 执行必须有统一 DB 队列或 RPC 边界；内存槽位与回调语义失效。
2. **存在同步跨进程降级。** `AnalysisVideoResolver.resolve` 会在分析链路里**同步**下载一个视频（`analysis-video-resolver.ts:270-315`）。若分析编排在云、下载在 NAS，这个同步调用无法工作，必须改成异步作业 + 状态机。
3. **云侧读接口直接读 NAS 磁盘。** `GET /api/summary-tasks/:id/markdown`、`by-resource/:bvid/:cid/markdown`、`/summary-files/*` 静态挂载、COS 发布、完整性与修复，都从 `DOWNLOAD_ROOT/summary/` 读 md / 截图（`main.ts:24-27`、`knowledge-publisher.service.ts:123-138`、`summary-integrity.service.ts:105-119`、`summary-repair.service.ts:134-146`）。云侧若没有这些文件的副本，这些接口会退化到 404。
4. **vision-proxy 与本地路径绑定。** 分析把本地媒体路径当 `video_url` 传给代理（`analysis-engine.ts:164`），代理必须在文件所在主机。云端要跑分析，要么把多模态调用留在 NAS worker，要么让云端经网络调用 NAS 的代理，要么把低清视频上传到云/COS。
5. **同一相对路径的双主机语义风险。** DB 相对路径约定以 `DOWNLOAD_ROOT` 拼接（`app-overview.md:48`）。一旦云端与 NAS 各自有 `DOWNLOAD_ROOT`，同一个相对路径在两侧会指向不同物理内容，产生"读错文件 / 判断文件存在性失真"的隐性错误。必须确立"媒体命名空间仅 NAS 拥有，云端不 join 媒体路径"。
6. **截图源取向与需求冲突。** 现实现是远端 B 站流优先（`analysis-video-resolver.ts:173-195`），而需求要求"基于已下载的高清视频截图"。若严格按需求，应改为本地高清文件优先，或在 NAS worker 内固化这一策略。

---

## 4. 候选方案对比

### 方案 A：保持 NAS 单体引擎，只把"读取侧"上云（最小改动，推荐先做）

- 云端：前端 + 对外只读 API + 问答/检索 + 知识消费；所有需要媒体的数据（总结 md 正文、公开截图）在发布时进入 DB / COS。
- NAS：保留现有 server 全部下载 / 分析 / 截图 / vision-proxy。
- 做法：md 正文落 DB（或 COS 对象），`/summary-files` 图片改用已发布的 COS URL（`knowledge-publisher` 已经在上传并回写 COS 链接）。
- 收益：立即满足"其余功能在云端、可外部访问"的大部分诉求，风险最低。
- 代价：NAS 仍需运行编排进程；未发布的总结（failed / 未同步）在云端不可读。

### 方案 B：控制面 / 数据面拆分（目标形态，工程量最大）

- 新增 `nas-worker`（下载 + 合并 + 低清下载 + 截图 + vision-proxy 同机），由云 DB 持久化队列驱动。
- 云端 `server`：解析、任务 CRUD、队列生产者、总结编排状态机、md 组装、知识发布、检索、问答、通知。
- 截图由 NAS worker 直接上传 COS；md 正文落 DB / COS；云端永不读 NAS 磁盘。
- 多模态调用留在 worker，或低清视频上传云侧。
- 触及 DB schema（队列表 / 状态迁移）、部署保护区、多模块边界，必须走需求 + 计划 + 独立审计 + 人工批准。

### 方案 C：全部留在 NAS，用反向隧道 / VPN 暴露外网（不改架构）

- 只解决"外部访问"，不满足"其余功能上云"；网络暴露面和安全成本可能高于 A。

**推荐：先 A 后 B。** A 是 B 的必要前置（先把媒体读取解耦），且本身就有独立价值。

---

## 5. 可行性判定

- **技术可行性：可行。** 云 DB 已就位、COS 已承担公开图片、路径锚点与 ports 解耦到位，NAS/云协作有可用基座；不存在必须重构语言/框架的硬障碍。
- **今天原样实施：不可行。** 第 3.2 节 6 项耦合中任一项都足以让"直接把 server 镜像搬上云"失败；且部署为保护区，数据模型（队列）需迁移，按项目规则必须先出需求 + 计划并过审计。
- **工作量级别：中到高（多会话）。** 核心新增是：持久化作业队列、媒体读取解耦（md/截图 → DB/COS）、异步状态机替换进程内同步降级、vision-proxy 放置决策、NAS 命名空间权威化。
- **风险等级：中高。** 涉及部署保护区、DB schema、跨主机一致性（重复执行 / 租约 / 幂等）、以及"同相对路径双语义"这类隐性正确性缺陷。

---

## 6. 若继续：建议分阶段路径

- **Phase 0（本文之后）**：把需求写成 `docs/requirements/`，明确 A/B/C 边界与"媒体命名空间仅 NAS"这一硬约束；对部署与 DB 改动走保护区流程。
- **Phase 1（方案 A，小切片）**：总结 md 正文入 DB/COS，云端只读接口与 `/summary-files` 改为消费 DB/COS；云端不再 join 媒体路径。验证：云端在无 NAS 卷时能正常提供总结列表 / 正文 / 问答来源整页。
- **Phase 2（拆队列）**：引入 DB 持久化作业队列与 worker 租约/幂等；下载与截图命令化，NAS worker 消费；替换同步降级为异步。
- **Phase 3（编排上云）**：分析状态机、知识发布、重建/修复的编排上云；确定多模态调用与 vision-proxy 的最终放置。
- **Phase 4**：收敛、清理影子路径、更新 `docs/design/app-overview.md` 与 `docs/architecture/system-baseline.md`。

每个 Phase 前后按项目规则做 plan audit / closure audit；部署与 DB 改动需人工批准。

---

## 7. 需要人工确认的问题（阻塞实施，不阻塞本文）

1. 云端与 NAS 的网络关系：NAS 能否稳定出站访问云 DB / COS / LLM（当前部署已满足 DB 与 COS，需确认带宽与稳定性）。
2. 媒体命名空间：是否接受"云端永远不 join 媒体路径，只消费 DB/COS"作为硬约束（这是方案 A/B 的前提）。
3. 多模态调用归属：低清视频留在 NAS 由 worker 调 LLM，还是允许上传低清到云/COS 由云端调用。
4. 截图策略：是否把"远端流优先"改为"本地已下载高清优先"以对齐需求。
5. 未发布 / 失败总结在云端是否必须可读（决定 Phase 1 的 md 落库范围）。
6. 对外访问的鉴权与限流（触发 auth 保护区，需要 owner doc + 测试）。

## 8. C 类逐项裁决（2026-09-17 用户反馈后更新）

用户明确意见：AI 分析编排 / 多模态调用、完整性检查、总结重建均留 NAS；并询问 MD 读取能否去掉、`/summary-files` 用途、COS 发布是否还需要。逐条回答如下（结论见 §8.6）。

### 8.1 AI 分析编排 + 多模态调用 → 留 NAS（确认，技术上也最自然）

`AnalysisEngine.analyze` 必须把本地媒体路径交给 vision-proxy（`analysis-engine.ts:153-165`），截图依赖本地高清文件 + ffmpeg（`analysis-engine.ts:349-355`），`AnalysisVideoResolver` 全程做本地磁盘校验并可在缺失时重下（`analysis-video-resolver.ts:64-146,209-235`）。把编排放在有文件的一侧，避免跨主机传大文件，是正确的。

### 8.2 总结 MD 读取：DB 里现在存的是什么？能否去掉？

**纠正一个前提**：DB 现在存的**不是渲染后的 md**，而是：
- `ai_summary_task.raw_response`：模型返回的原始 JSON（每段 `title/content/timestamp/frameDescription`）——是**内容源**，不是 md。
- `summary` / `summary_segment`（知识发布后才有）：云端知识表，`summary.raw_response` + 每段 `summary_segment`（含 `screenshot_url`、embedding）。
- `ai_summary_task.summary_output`：本地 md 的**相对路径**，不是内容。

**md 是派生产物**：`generateMarkdown`（`document-generator.ts:36-67`）由 raw_response + 视频元数据 + 按序号命名的截图（实际为 `${filenamePrefix}-frame-${i}.jpg`，如 `screenshots/segment-0-frame-0.jpg`，见 `ffmpeg-screenshot.ts:91`）**确定性**生成。所以：
- **云端读取侧可以不再读 NAS 的 md 文件，改为从 DB 渲染**（raw_response 或 summary+segments）。这正是既有讨论 `2026-08-21...:277` 的建议。
- **但不能把本地 md 文件整体去掉**：用户要求完整性检查 / 重建 / 修复留在 NAS，它们都以本地 md 与截图为准（`summary-integrity.service.ts:105-119`、`summary-repair.service.ts:134-146`、`analysis-task.controller.ts:252-271`）。
- 三个需要处理的细节：md frontmatter 的 `createdAt` 需用 DB 时间近似；图片地址需用 `summary_segment.screenshot_url`（COS）；未发布（`knowledge_status` 非 synced）的总结在云端没有图片可渲染。

结论：**去掉的是"云端读 NAS md 文件"这一耦合，不是 md 文件本身。**

### 8.3 `/summary-files` 是做什么的？

它是把 `DOWNLOAD_ROOT/summary/`（`paths.service.ts:47-49`）静态挂到 URL 前缀 `/summary-files`（`main.ts:24-27`、`summary-dir.ts:14`）。用途：让**浏览器能加载总结 md 里内嵌的本地截图**。`renderSummaryMarkdown` 会把 md 中的相对图片链接 `screenshots/segment-0-frame-0.jpg` 重写成 `/summary-files/<目录>/...`（`analysis-task.controller.ts:269`、`summary-dir.ts:142-171`）。

关键事实：COS 发布时会把本地 md 里的相对图片链接**原地改写成 COS 公网 URL**（`knowledge-publisher.service.ts:183-187`）。因此：
- **已发布**的总结，图片本来就已从 COS 加载，`/summary-files` 不是必需。
- 它真正兜底的是**未发布 / 发布失败**的总结，以及不配 COS 的本地环境。
- 若云端只展示已发布的总结（图片全走 COS），云端侧可以不做 `/summary-files`；否则需要 NAS 提供或云端做 COS 兜底。

### 8.4 完整性检查 + 总结重建 → 留 NAS（确认）

两者都读本地 md / 截图；rebuild 还需本地视频 + 在 NAS worker 内调 LLM + ffmpeg（`analysis-trigger.service.ts:803-840`、`summary-repair.service.ts:199-270`）。留 NAS 无争议。

### 8.5 COS 发布：还需要吗？

要区分**数据流**和**独立子系统**：
- **数据流必须保留**：COS 发布做的事是「截图上传 COS + `summary`/`summary_segment` 写入云 DB + 本地 md 改写」。云端 RAG 检索返回的 `screenshotUrl`、问答来源的截图，全部来自这里（`knowledge-search.controller`、`chat.service`）。如果云要跑问答，这条**出站**数据流就是让云端可用的桥梁，不能去掉。
- **可以大幅删除的是"独立发布子系统"**：如果 NAS 分析管线在生成总结时**直接写云 DB + 直传 COS**（把发布内联进管线，而不是先落本地再二次发布），则以下可下线：
  - `ai_summary_task.knowledge_status` / `knowledge_error` 影子状态；
  - `POST/GET /api/knowledge/backfill`（为历史本地总结回填而生）；
  - 本地 md 的 COS 链接改写步骤（改为云端渲染时用 `summary_segment.screenshot_url`）。

结论：**发布这个"动作"保留（内联），发布这个"独立子系统/回填/影子状态"可以删除。** 前提是 §8.2 的云端 DB 渲染落地。

### 8.6 对分类与结论的修正

用户裁决后，C 类**整体归到 NAS**。于是目标形态收敛为：

- **NAS**：下载 / 合并、低清、截图、AI 分析（LLM + vision-proxy）、完整性检查、重建 / 修复、媒体存储，以及向云 DB + COS 的**写**。
- **云端**：前端、读 / 查询 API、知识检索、RAG 问答、设置 / 提示词，以及下载 / 分析的**触发入队**。
- **跨主机边界只剩两条**：① 触发（云端写 DB 行，NAS 认领执行）；② 读取（云端只从 DB / COS 渲染，永不读 NAS 磁盘）。

这比第 4 节的「方案 B」小得多，因为管线不拆、只拆**边界**。而且已有可用基座：下载任务的持久化认领已存在（`claimNextCreatedTask`，`database.service.ts:586-609`，被 `download-scheduler.ts:188` 使用）。缺口是：
1. 低清 `analysis_sub_task` 没有等价的跨进程认领；
2. 分析触发目前靠**进程内回调** `onTaskFinished → onAnalysisTrigger`（`download-scheduler.ts:70-81`），跨主机需落成 DB 触发（与 `claimAiSummaryTask` 同思路）；
3. 云端读接口去磁盘化（§8.2）与图片去 `/summary-files` 化（§8.3）。

因此，在用户裁决下，**可行性进一步提高**：主要工作是「触发去进程内回调 + 读取去磁盘」，而不是重写下载 / 分析管线。

## 9. 云端单一真源与本地文件去留裁决（2026-09-17 第二轮用户反馈）

用户进一步裁决：
1. 云端读取改为从 DB 渲染后，**总结内容的唯一真源从本地数据改为云端数据**；完整性检查改为「云端总结数据 ↔ NAS 视频资源」的跨端检查。
2. `/summary-files` 只是为显示 md 内图片服务，既然查看改为 DB 渲染，**可删除，也不再挂载静态资源**。
3. 分析后把「总结内容」与「基于该内容与视频产生的截图」写入云端后，**本地不再保留 md 与原始截图**。

以下记录该裁决的架构含义、必须澄清的技术点与前置条件。

### 9.1 目标数据形态

- **总结内容真源**：云端 DB（`summary` + `summary_segment`，含文本段与 `screenshot_url`、embedding；`raw_response` 作为可重建源）。
- **截图真源**：腾讯云 COS（对象存储）。
- **视频真源**：NAS（体积原因，唯一保留在本地的原始数据）。
- **本地 md / 截图 / `summary/` 目录 / `/summary-files` 挂载**：全部下线。

### 9.2 必须澄清与修正的技术点

1. **截图不应进 DB。** “写入数据库”应理解为：**文本段与图片 URL 入库，图像字节入 COS**。PostgreSQL 只存 `summary_segment.screenshot_url`，不存二进制。
2. **单一真源的具体形态要定。** 目前 raw_response 存在两处：`ai_summary_task.raw_response`（文本）与 `summary.raw_response`（jsonb）。需明确权威表与写入顺序，避免双写漂移。建议：`summary`+`summary_segment` 为**消费真源**；`ai_summary_task` 保留任务状态与原始返回，用于重试/重建。
3. **可恢复性是删除本地文件的前提。** 只要 `raw_response` + NAS 视频在，md 与截图永远可由重建流程再生 → 删除本地副本不是不可逆数据丢失。此条必须写进需求与验收。
4. **跨网络两步写的部分失败与幂等。** 写云 DB + 传 COS 可能半成功，需要失败态 + 幂等重试（可沿用 `knowledge_status` 语义，但归属到分析管线本身）。因可重建，失败可自愈。
5. **依赖顺序。** 必须先落地“云端从 DB/COS 渲染 md”，**再**删 `/summary-files` 与停止写本地文件；否则读取端先断。
6. **历史数据一次性回填。** 存量本地截图需回填 COS（`POST /api/knowledge/backfill` 的用途），完成后方可彻底停止依赖本地文件并下线该子系统。
7. **完整性检查语义发生契约级变化。** 云端进程读不到 NAS 磁盘，检查必须由 NAS 侧执行并读云 DB；`integrity_status`/`integrity_detail`/`integrity_checked_at` 的判据要从“md/截图是否存在”改为“云端记录 ↔ NAS 视频存在性（及 COS 可达性）”。需新需求定义判定与报告格式。
8. **rebuild / repair 语义变化。** 从“重建本地 md/截图文件”改为“由 `raw_response` + NAS 视频重生截图、回写 COS 与 DB”。端点可保留，但效果与 owner doc 需更新。
9. **COS 从可选变成硬依赖。** 现在 COS 未配置时分析仍能完成、本地留副本兜底；去掉本地后，**截图全在 COS，COS 不可用即总结无图**。需明确：是否把 COS 成功设为分析完成的必要条件。
10. **清理候选（后续独立切片）**：`ai_summary_task.summary_output` 列、`PathsService.SUMMARY_BASE_DIR`、`resolveSummaryOutputPath`、`listLocalImageRefs`、`rewriteMarkdownImageUrls`、`rewriteMarkdownImages`、`summary-dir` 重写 helper、`main.ts` 静态挂载，以及 `docs/design/app-overview.md` 中 `/summary-files` 行。
11. **运行角色。** 同一代码库需支持 `worker`（NAS：下载/截图/分析/重建/检查）与 `api`（云端：读/检索/问答/触发）两种角色，建议以环境变量切换入口行为。

### 9.3 更新后的边界

- **NAS（worker）**：下载 / 合并、低清、截图、AI 分析（LLM + vision-proxy）、重建、完整性检查、视频存储；将总结内容写云 DB、截图直传 COS。
- **云端（api）**：前端、读 / 查询 API（md 由 DB 渲染）、知识检索、RAG 问答、设置 / 提示词、触发入队。
- **跨主机边界**：① 触发（云端写 DB，NAS 认领）；② 读取（云端只读 DB / COS）。
- **真源**：内容 = 云 DB；截图 = COS；视频 = NAS。

### 9.4 对可行性的影响

方向进一步收敛、实现边界更清晰，但性质已从“部署拆分”升级为**数据真源迁移 + 产品数据模型变更**，并直接触碰部署与数据（删除/迁移）保护区。仍需：需求文档 → 计划 → 独立审计 → 人工批准，且必须在“云端渲染 md”落地之后才执行本地文件下线。

另注：本裁决改变了最初“AI 分析后的原始截图存放在 NAS”的前提——截图（体积小）改存 COS，NAS 只保留大体积视频。这是有意的需求修正，应写入需求文件。

## 10. 云端与 NAS 互联互通建议（2026-09-17 讨论）

约束：云端有稳定域名 / IP；NAS 没有稳定域名 / IP（通常在家宽后 NAT，可能 CGNAT、IPv4 动态、无公网端口）。

### 10.1 关键判断：目标架构下云端根本不需要主动连 NAS

按 §9.3 的边界，跨主机只有两条：① 触发（云端写 DB，NAS 认领）；② 读取（云端只读 DB / COS）。而 NAS 侧本来就必须**出站**访问云端（现在就连云 RDS 阿里云 PostgreSQL、腾讯云 COS、DashScope）。因此：

> **只要把「控制信息走云 DB、数据走 COS」作为硬约束，NAS 全程只做出站连接，云端永远不拨入 NAS，就不需要 NAS 有稳定域名 / IP，也不需要任何内网穿透或端口映射。**

这也是当前架构的自然延伸，不引入新组件。

### 10.2 方案对比

| 方案 | 机制 | NAS 需稳定地址 | 新增组件 | 适用 |
| --- | --- | --- | --- | --- |
| **1. 纯出站 + DB 邮箱 + COS 中转（推荐）** | NAS 轮询/认领 DB 作业、写状态；截图传 COS；云端只读写 DB/COS | 否 | 无 | 现阶段全部需求 |
| 2. NAS 发起反向隧道 | NAS 出站建立长连接隧道，云端经隧道访问 NAS 服务 | 否 | WireGuard / Tailscale / frp / Cloudflare Tunnel | 将来需要云端主动调 NAS（远程运维、按需调试、备用文件直传） |
| 3. 托管消息队列 | 云 MQ（MQTT / Redis Streams）推送作业，NAS 订阅（出站长连） | 否 | MQ 服务 | 需要近实时推送、且不愿用 DB 轮询 |
| 4. DDNS + 端口映射 | NAS 暴露入站端口，配动态域名 | 是（动态） | DDNS + 端口转发 | **不推荐**：多数家宽不可达/被运营商封端口，且扩大攻击面 |

### 10.3 推荐：方案 1

实现要点：

1. **作业认领用既有模式**：下载任务已有 `claimNextCreatedTask`（`database.service.ts:586-609`）原子认领；为低清 `analysis_sub_task` 与分析触发补等价的守卫型 claim。
2. **轮询间隔与实时性的折中**：个人工具场景 3–10 秒轮询足够；若嫌慢，可让 NAS 对 DB 做长轮询或退化为方案 3，不必上隧道。
3. **worker 存活与崩溃恢复**：新增 `worker_heartbeat`（NAS 定时写、云端读，供 UI 显示在线）与**作业租约（lease）**——认领时写 `lease_expires_at`，超时未续租即可被其他实例重新认领，避免 NAS 崩溃后作业永久卡死。这一点是跨主机与单机最大的语义差异，必须实现。
4. **幂等**：轮询/重试会重复投递，下载与写库都要幂等（下载已有"文件已存在即跳过"；写库用唯一键 upsert）。
5. **安全**：NAS 只出站 ⇒ 无入站攻击面。为 worker 使用**独立最小权限 DB 角色**；密钥仍经环境变量注入，不落镜像。
6. **带宽方向有利**：视频永不离开 NAS；只有体积小的截图上传 COS（占用家庭上传带宽，成本可控）。

### 10.4 何时才需要方案 2（反代隧道）

只有当出现**云主动调 NAS** 的明确需求时再引入，例如：远程运维 NAS 服务、按需触发本地调试、或不愿经 COS 的文件直传。届时的选型排序：

- **WireGuard**：自建、轻量、NAS 作为 client 拨入云端，稳定且无第三方依赖（推荐自建时用）。
- **Tailscale / ZeroTier**：托管 mesh，接入最快，适合不想维护隧道服务端；代价是依赖第三方。
- **frp / Cloudflare Tunnel**：把 NAS 端口反向暴露到云端域名，改动小；注意最小化暴露端口并开启鉴权。

统一原则：**始终由 NAS 主动拨出，绝不做端口映射 / 公网入站。**

### 10.5 重建 / 完整性检查的触发：仍是 DB 作业，不需要云→NAS 入站

这两个动作**必须在 NAS 执行**（要读本地视频与文件），但**触发**仍然不需要云端主动连 NAS：把「重建请求」「完整性检查请求」当作**作业行写入 DB**，NAS worker 用与下载/分析完全相同的 claim / lease 机制认领执行，结果回写 DB（rebuild 的截图回 COS、segments 回 `summary`/`summary_segment`；integrity 的三列回 `ai_summary_task`）。即：

> **触发是"投递作业"，不是"调用 NAS"。** 与 §10.1 的不变量一致，无需为它们引入入站或隧道。

但当前这两个动作是**进程内实现**，跨主机必须改造：

1. `rebuild` 的并发防抖是内存 `Set`（`analysis-trigger.service.ts:59` `rebuildingIds`）；完整性检查是内存布尔（`summary-integrity.service.ts:44-49` `running`）；`GET /api/summary-tasks/integrity-check/status` 返回的是**进程内**状态。跨主机后 API 与执行方不是同一进程，这些状态必须落到 DB（作业行 + heartbeat/lease），否则 API 看不到 NAS 侧真实进度。
2. **前置校验要分层**：DB 可判定的（记录存在、`completed`、`raw_response` 非空、id 合法）留在云端 API；磁盘可判定的（视频是否存在、ffmpeg 是否可用）移到 NAS worker，结论写入作业结果。
3. 该改造顺带修掉一个既有限制：单机下的内存互斥在多实例/多 worker 时本就失效。

需要的作业语义（与 §10.3 合并）：

- **NAS 离线**：作业保持 `queued`，UI 依 heartbeat 显示「等待 NAS 上线」。
- **租约超时**：NAS 崩溃后作业可被重新认领（rebuild 非破坏且幂等、integrity 只读，重跑安全）。
- **取消**：云端写取消标志，NAS worker 检查。
- **统一作业抽象**：`download` / `low-res` / `analyze` / `retrigger` / `rebuild` / `repair` / `integrity-check` 共享 claim / lease / status，避免每种动作各造一套。

真正的例外只有一个：若你希望云端能**远程管理 NAS 服务本身**（SSH、Web 管理台、实时唤起），那才需要 §10.4 的反向隧道；总结重建与完整性检查不需要。

### 10.6 结论

现阶段直接用方案 1，NAS 无需稳定域名 / IP；把"控制走 DB、数据走 COS、NAS 仅出站"固化为架构不变量。只有未来出现云端主动调用 NAS 的硬需求时，才按 §10.4 增加一条 NAS 发起的反向隧道。

## 11. vision-proxy 角色与截图策略（2026-09-17 第三轮讨论）

### 11.1 vision-proxy 现状（先对齐事实）

- 它是一个 **DashScope 多模态薄代理**：Node 发 OpenAI 风格消息，它转成 DashScope Python SDK 的 `MultiModalConversation` 消息，调用后返回 OpenAI 风格响应（`qwen_vision_proxy.py:1-8,98-127,252-276`）。
- **必须存在的原因**：① Python SDK 支持**本地文件路径**（HTTP 端点不行）；② 模型基址是**写死的私有 MaaS 工作区端点**（`qwen_vision_proxy.py:73-76`）。
- 它同时处理 `video_url` 与 `image_url`，两者都接受 URL 或本地路径（`normalize_media_url`，`qwen_vision_proxy.py:87-95,115-123`）。
- 当前 **所有** 多模态调用都经过它：视频分析走本地视频路径；RAG 问答的照片分析与带图回答虽然已经是 COS 公网 URL，但 `QwenClient.multimodalChat` **强制要求** `visionProxyUrl`（`qwen-client.ts:143-161`；chat 侧 `chat.service.ts:289-303`）。所以代理并非只服务视频。

### 11.2 角色收敛：NAS 是「视觉代理」，云端是「多模态直连客户端」（不是代理）

用户修正（2026-09-17）：云端**不应再叫 vision-proxy**，也不该有这样一个组件。因为云端调用大模型时，图片已有 COS **公网 URL**，把 URL 直接交给模型，模型自行抓取即可，**无需上传/中转图片**。这与 NAS 代理有本质区别：

| 侧 | 组件 | 存在的唯一理由 | 输入形态 |
| --- | --- | --- | --- |
| NAS | **vision-proxy**（保留原名） | 模型读不到 NAS 文件系统，需经 DashScope Python SDK 把**本地路径**转成模型可读消息 | 本地视频/图片路径 |
| 云端 | **OpenAI Node SDK 直连客户端**（不是 proxy，不新增服务 / 容器） | 图片已在 COS 有公网 URL，模型可自行抓取；无需 DashScope | COS 公网 URL |

结论：**NAS 的代理保留且不可替代**（本地路径能力只有它有）；云端只是在既有 server 内用 URL 直连模型，不新增独立组件。二者职责不同，命名必须区分。

前置条件与已确认项：

1. **已确认（人工，2026-09-17）**：调用方式由 DashScope 改为 **OpenAI 官方 Node.js SDK**（`openai` 包）；**所用模型、调用的端点（同一私有 MaaS 工作区）、相应配置都不变**。即以同一端点的 OpenAI 兼容面（`chat.completions`）替代原 Python 代理的 `MultiModalConversation` 调用，而非更换模型或提供方。
2. **前提**：该 MaaS 端点须暴露 OpenAI 兼容的 `/chat/completions`（含 `image_url`）。OpenAI SDK 的 `baseURL` 用其兼容基址（与现有原生基址 `.../api/v1` 可能路径不同），属配置细节。
3. **代码改造**：云端引入 `openai` 依赖，替代 `QwenClient` 对 `visionProxyUrl` 的强制依赖（`qwen-client.ts:143-161`）；需处理 DashScope 专有参数 `enable_thinking`（OpenAI SDK 无此参数）与 `response_format` 差异。
4. **NAS 本地视频仍需 Python 代理**：OpenAI SDK 不接受本地文件路径（`file://` 或磁盘路径），而视频分析送的是本地视频。只要视频仍留在 NAS，就需要 vision-proxy 这条本地文件通道；除非改为上传 / 抽帧，否则 NAS 不能改用 OpenAI SDK。因此本裁决在云端可无损落地，在 NAS 视频路径上不适用。
5. **URL 可达性**：COS 必须是模型提供方可匿名抓取的公网 URL（与 `TENCENT_COS_PUBLIC_URL_PREFIX` 语义一致），注意签名 URL 的过期问题；否则模型抓不到图。
6. 保留 `assertNoBase64MediaUrls` 约束（`qwen-client.ts:110-125`）：云端同样只用 URL，不传 Base64。

### 11.3 截图策略：本地已下载、高清优先

用户裁决：截图源改为「本地已下载的高清视频优先」。

现状与目标的差异：

- 实际主链路**已经**在触发时传入本地高清路径：`runAnalysis` 在本地高清文件存在时设置 `screenshotVideoPath`（`analysis-trigger.service.ts:422-425`），`AnalysisEngine` 有该值就直接用它截图（`analysis-engine.ts:276-282`）。
- 但 `AnalysisVideoResolver.resolve` 的兜底顺序是**远端 B 站流优先**，其次才是本地已完成下载（quality≥80），最后同步重下（`analysis-video-resolver.ts:173-249,270-315`）。
- 目标应明确为：**本地已下载高清 → （缺失时）在 NAS 下载高清 → 截图**。远端流截图路径降级为可选最后兜底或直接移除（需决策）。

两个必须区分的视频源，不要混为一谈：

| 用途 | 目标源 | 原因 |
| --- | --- | --- |
| 送 LLM 做总结分析 | **低清**优先（现状 `.analysis-llm/`） | 省 token 与带宽 |
| 截图 | **本地高清**优先（本次裁决） | 画面清晰度 |

配套影响：

- 本地高清缺失时，下载必须变成 **NAS 作业 + 异步等待**，替换现在的同步 10 分钟下载路径（与 §3.2.2 一致）。
- `AnalysisVideoResolver` 的远端分支可显著简化；若保留，必须仅作最后兜底并记录原因。
- 该策略把"截图依赖本地视频"固化为不变量，与"截图保留在 NAS"的需求一致。

## 12. 参考

- `docs/discussions/2026-08-21-summary-cloud-knowledge-base.md`（既有上云讨论与已知影响面）
- `docs/architecture/system-baseline.md`、`docs/architecture/module-boundaries.md`
- `docs/design/app-overview.md`、`docs/context/project-context.md`
- `docs/context/ai-autonomy-policy.md`（部署保护区）、`docs/context/source-of-truth-and-precedence.md`
