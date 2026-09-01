# 2026-08-21 总结知识云端化与穿搭问答服务讨论

> 状态更新（2026-08-24）：用户决定先执行本讨论目标第 1 点"数据库迁移云端"，范围为方案 A（六张表全部迁移到 PostgreSQL），在这一点上取代本文收敛的方案 B。云端数据库目标改为阿里云云数据库。详见 `docs/requirements/2026-08-24-sqlite-to-postgresql-migration.md` 与 `docs/plans/2026-08-24-sqlite-to-postgresql-migration-plan.md`。方案 B 的其余内容（知识发布管道/COS/RAG）仍有效，属后续需求。
> 状态更新（2026-09-01）：Phase 1（知识发布管道）已完成并关闭；用户确认 Embedding 模型选型为 DashScope `qwen3.7-text-embedding`（Open Question #3 解决），进入 Phase 2 需求准备。Phase 2 需求已定稿：`docs/requirements/2026-09-01-knowledge-vector-search.md`。历史回填从 Phase 4 提前并拆为独立需求（用户部署镜像后手动触发一次）：`docs/requirements/2026-09-01-knowledge-backfill.md`，实施顺序为回填 → 向量化。

## Source

- 用户 chat 讨论（2026-08-21）：数据库迁移云端、截图上传 OSS、总结文本+图片同步云端、进一步 AI 分析（向量化）、独立前端穿搭问答（RAG）
- 状态：**讨论基本收敛**；方案 B 与主要选型已确认；RAG 问答形态已定义；剩余后置项不阻塞 Phase 1。下一步：转需求文档
- 相关现状代码：
  - `packages/server/src/analysis/analysis-trigger.service.ts`（runAnalysis 完成态写入、summary_output 绝对路径）
  - `packages/server/src/analysis/analysis-engine.ts`（LLM → 截图 → generateMarkdown，raw_response 为模型 JSON 原文）
  - `packages/server/src/analysis/document-generator.ts`（md 含 YAML frontmatter + 相对图片路径）
  - `packages/server/src/analysis/prompt-template.ts`（内置提示词约束：一条技巧一个点、是什么/为什么/怎么穿、timestamp/frameDescription 格式）
  - `packages/server/src/database/database.service.ts`（SQLite，better-sqlite3 同步 API；`ai_summary_task` 表含 raw_response/model_name/summary_output）
  - `packages/server/src/analysis/analysis-task.controller.ts`（markdown 预览端点、rebuild、删除）
  - `packages/vision-proxy/qwen_vision_proxy.py`（DashScope 视觉薄代理：本地媒体文件转 DashScope 消息格式；`normalize_media_url` 对非 `file://` 的 URL 原样透传，即已支持 URL 输入；模型名由 Node 侧传入；`DASHSCOPE_BASE_URL` 硬编码内网 MaaS 端点）
- 总结内容真实样例来源：`docs/requirements/2026-07-07-document-structure-optimization.md`（"如何摆脱路人感"示例）与内置提示词约束（运行期数据不入库，仓库内无 tasks.db）

## 目标（用户原话要点）

1. 将数据库从本地迁移为云端数据库。
2. 每次分析的截图从本地上传至云端 OSS。
3. 总结文本 + 图片同步到云端，为后续进一步 AI 分析（如向量数据库）打基础。
4. 提供独立前端服务：用户询问穿搭问题，基于沉淀的知识回答。

## 已确认决策

1. **方案 B**：本地下载器（SQLite）不动，新增"知识发布管道"把总结知识发布到云端。
2. **云端数据库**：PostgreSQL + pgvector（一个服务同时解决关系存储与向量检索）。
3. **静态资源存储**：腾讯云 COS（截图、用户上传的穿搭照片）。
4. **向量化与 RAG 必须基于当前 AI 总结的实际内容特点设计**（已分析，见下文）。
5. **多轮对话 = 单个用户的追问**（同一会话连续追问；非多用户并发），必须支持。
6. **两个优先场景**：
   - 场景一（照片输入）：用户展示当前穿搭照片 → 分析后给出优化建议；
   - 场景二（文本输入）：用户直接提出穿搭期望 → 给出实现路径。
7. **引用呈现三段式**：正文文字（与风格/技巧对应）→ 图片示例（命中技巧时该技巧的展示图一并展示）→ 视频注脚（统一显示在回答最下方）。
8. **照片隐私策略后置**：用户照片直接存存储桶（公开读），不做私有桶/签名 URL 的复杂方案。
9. **照片分析与聊天生成均使用多模态大模型**：复用 DashScope 能力，但模型与具体调用形态与现有视频分析不同，**Python 侧（vision proxy）可能需要增强**（具体范围 Phase 3 需求阶段评估）。
10. **生成阶段视觉输入：默认开启，预留关闭开关**：命中截图（场景相关时含用户照片）作为视觉输入给多模态模型；提供配置项可关闭视觉输入（退化为纯文本生成 + 图片仅前端展示）。
11. **兜底策略：严格"暂无相关内容"**：无命中/低置信度时不编造，不允许 LLM 附带通用穿搭常识。
12. **会话存储：PostgreSQL**（与知识库同一库，起步同库避免多数据源）。
13. **照片上传先压缩一次**再存 COS（降低存储与多模态 token 成本；压缩参数 Phase 3 需求细化）。
14. ~~**Embedding 模型选型后置**~~（已解决，2026-09-01：选定 DashScope `qwen3.7-text-embedding`，见决策 #16）。
15. **知识发布转云端，本地逻辑先不删**：现有本地写入路径（磁盘 md/截图、本地 SQLite）保留作为备份（影子双写迁移策略，见下文）。
16. **Embedding 模型：DashScope `qwen3.7-text-embedding`**（用户确认，2026-09-01）：Qwen3.7 系列多语言统一向量模型，支持 256~2560 自定义维度（2560/2048/1536/1024 默认/768/512/256），批次大小 20，单批最大 128K Token，与现有 DashScope/LLM 通道同源。维度建议默认 1024（官方推荐通用场景性能/成本平衡点），最终维度在 Phase 2 需求文档定稿。调用走 DashScope OpenAI 兼容端点（`compatible-mode/v1`），API Key 复用/新增 `TENCENT/DASHSCOPE` 配置由需求阶段细化。

## 现状盘点

### 总结内容的三重形态

| 形态 | 内容 | 存储位置 | 备注 |
| --- | --- | --- | --- |
| 结构化 JSON（raw_response） | `{summary: [{title, content, timestamp, frameDescription}]}` | 本地 SQLite `ai_summary_task.raw_response` | **权威源**，一条技巧 = 一个 item，是 RAG 天然 chunk 单元 |
| Markdown 文档 | frontmatter + H1 标题 + 每段 `## 技巧` + 文本 + `![帧描述](screenshots/segment-N.jpg)` + 引用块 | 本地磁盘 `cwd/summaryDir/<标题>-<bvid>-<cid>/` | 渲染产物，容器内文件系统，**容器重建即丢失**（已知缺陷） |
| 截图 | `screenshots/segment-N.jpg` | 同上 | 同 md 一起丢失 |

### 关键事实

- `ai_summary_task.summary_output` 只存本地绝对路径，云端部署下语义失效。
- 本地 SQLite（`OUTPUT_DIR/tasks.db`）在 Docker 的 `/download` 卷上，容器重建不丢；但 summaryDir 在容器内，容器重建丢。
- `app_settings` 表存 `llm.apiKey`——本方案下不下云。
- 现有 `GET /api/summary-tasks/:id/markdown` 依赖读本地 md 文件，磁盘缺失时 404。
- vision proxy 现状：支持 `file://` 本地路径与公网 URL 两种输入（URL 原样透传）；模型名由 Node 侧指定；DashScope 基址硬编码内网 MaaS 端点。**"Python 侧增强"大概率有限度（基址配置化 + 可能的流式/参数透传），Phase 3 评估。**

## 方案对比

### 方案 A：整库迁移云端（未采纳）

- 描述：task / analysis_sub_task / ai_summary_task / app_settings / ai_prompt / ai_prompt_creator 全部迁到云数据库。
- 影响：better-sqlite3 同步 API → 云数据库异步 API，`DatabaseService`（约 1400 行）及所有 service 调用方全局重构；`llm.apiKey` 上云。
- 未采纳原因：改动最大、收益与"知识问答"目标不直接相关。

### 方案 B（已确认）：本地下载器不动 + 知识发布管道上云

- 描述：`ai_summary_task` 拆两个职责——任务状态（本地 SQLite 保留）与知识内容（发布到云端）。分析完成后由"知识发布管道"将 segments + 截图写入云端 PostgreSQL + pgvector 与 COS。
- 影响面：本地 SQLite 不改；新增发布模块 + 云端 schema。

## 迁移与备份策略（用户确认：本地逻辑先不删）

- 知识发布为**新增路径**，与现有本地写入（磁盘 md/截图、本地 SQLite）**并存**（影子双写）。
- 本地写入逻辑作为**备份**保留，暂不删除；云端知识库为知识消费（检索/问答）的正式源。
- 迁移风险可控（云端异常时本地数据仍在），后续确认云端稳定后再评估是否裁剪本地路径。
- 含义：Phase 1 不删任何现有代码，只新增发布模块；"仅支持上云"理解为**知识消费仅云端**（本地路径仅为备份，不承担消费职责）。

## 当前 AI 总结内容特点分析（向量化/RAG 设计依据）

基于内置提示词约束（`prompt-template.ts`）与真实样例（"如何摆脱路人感"）归纳：

### 结构特点

1. **半结构化、字段稳定**：raw_response 为 JSON，`summary[]` 每项含 `title / content / timestamp / frameDescription` 四字段；`normalizeSummaryItems` 只保留四字段均非空的项，数据质量有过滤保障。
2. **粒度均匀、语义自包含**：提示词强制"一条技巧说一个点"，每个 segment 是一个独立知识点；单视频数量约 10-20 条，由 LLM 决定。
3. **每段关联一帧证据**：timestamp（hh:mm:ss）指向最能展示该技巧的清晰帧，配套截图 + frameDescription 画面描述。
4. **内容短**：content 通常 1-3 句，是"浓缩知识点"而非长文。

### 内容特点

1. **领域垂直**：穿搭教学，术语集中（版型 / 颜色 / 配饰 / 身材 / 风格）。
2. **语言风格**：大白话、教学口吻、口语化（"想要…不是…而是…"），面向完全不懂穿搭的用户。
3. **观点型知识**：每条 = "观点 + 理由 + 做法"，结构与提示词"是什么、为什么有效、具体怎么穿"一一对应。
4. **跨视频主题重叠**：不同博主会讲同一技巧（显高、同色系、叠穿等），表述与侧重点不同——这是 RAG 聚合价值的来源，也是去重的难点。

### 对检索的影响（设计约束）

1. **chunk 粒度已合适**：不需要再切分（content 短，切分会破坏语义），也不需要合并（segment 间语义独立）。**chunk 单元 = segment 本身**。
2. **title 与 content 都重要**：title 是"技巧名"（摘要式短语），content 是展开；frameDescription 是画面描述，对文本匹配贡献有限，但对引用展示重要。
3. **存在"意图-知识点"语义鸿沟**：用户问题（"小个子怎么穿显高"）与技巧（"高腰线显腿长"）字面不同 → 必须向量检索，纯关键词不够。
4. **跨视频聚合是核心价值**：同一问题可能命中多个视频的多条技巧 → 生成阶段需 LLM 综合多条并带引用。
5. **数据量小**：起步几百到几千 chunk，pgvector 完全够用，无需复杂检索架构。

## 向量化设计（基于上述特点）

### chunk 与文本构造

- **chunk 单元**：每个 `summary_segment` 一行，一条技巧一条记录。
- **embedding 文本**：`title + content`（主知识文本）。frameDescription 默认不进 embedding（画面描述对文本匹配贡献有限），保留在元数据供引用展示；预留开关，后续可消融对比。
- 归一化：全文使用同款归一化（去空白/换行规整），与 query 端一致。

### 元数据（检索后过滤 / 展示）

`bvid, cid, video_title, video_url, timestamp_seconds, screenshot_url, model, created_at`（timestamp_seconds 由现有 `transTimestampToSeconds` 解析，供 B 站 `?t=` 跳转）。

### embedding 模型与维度（已定，2026-09-01）

- 已选定：DashScope `qwen3.7-text-embedding`（见已确认决策 #16），与现有 DashScope/LLM 通道同源。
- 可选维度：2560/2048/1536/1024（默认）/768/512/256；建议 1024（通用场景推荐），Phase 2 需求定稿。
- `summary_segment.embedding` 用 pgvector `vector(1024)`（若维度最终调整则同步改）；云端 PostgreSQL 需启用 pgvector 扩展（需求/计划阶段确认 RDS 支持与启用方式）。

### 更新与删除策略

- 重总结：按 bvid+cid 全量替换该 summary 的 segments 与向量（事务内：删旧插新）。
- 删除总结：级联删 segments + 向量；COS 文件是否级联删见 Open Questions。
- 幂等：以 (summary_id, seq) 为 upsert 键。

## RAG 问答设计（基于内容特点 + 用户定义的双场景 + 多模态）

### 场景一：照片输入（"我穿这样，怎么改进？"）

1. 用户上传当前穿搭照片（一张或多张），服务端**先压缩一次**再存 COS。
2. **照片 → 穿搭描述**：多模态大模型分析照片，产出结构化"用户穿搭描述"（体型 / 单品 / 颜色 / 风格 / 可优化点）。
3. 描述 + 用户问题 → 向量检索（检索链路与场景二统一为文本检索）。
4. 生成回答：结合"用户穿搭分析"与命中技巧，给出针对性优化建议。

### 场景二：文本输入（"我想要 X 风格，怎么实现？"）

1. 用户文字描述期望（风格 / 场景 / 体型 / 预算等）。
2. 直接向量检索。
3. 生成回答：给出实现路径（单品 / 搭配 / 技巧），引用命中技巧。

### 检索（两场景共用）

- 起步：纯向量 top-k（k≈10，候选集小）；数据量增长后评估加"BM25 全文 + 向量 RRF 融合"混合检索（穿搭术语有精确匹配场景）。
- query 预处理：与 chunk 同款归一化；多轮场景先做 **query 重写**（LLM 基于会话历史把省略问题补全为可独立检索的问题）。
- 场景一可选项（后期）：按用户体型/风格元数据过滤检索结果。

### 多模态调用形态（用户确认：照片分析与聊天生成均用多模态大模型）

- **照片分析**（场景一步骤 2）：多模态模型，输入 = 用户照片（+ 可选问题文本）。
- **聊天生成**（两场景步骤 4）：多模态模型，输入 = 文本上下文（命中技巧 title/content + 会话历史）+ **视觉输入默认开启**（命中技巧截图；场景相关轮次含用户照片），**配置开关可关闭视觉输入**（关闭后纯文本生成 + 图片仅前端展示）。
- **复用 DashScope 但模型/调用不同**：现有 vision proxy 支持 URL 透传（COS 公网 URL 可直接用）与 `file://` 本地路径；差异点在——模型不同（payload.model 由 Node 指定，可扩展）、可能的参数差异（enable_thinking / response_format / 流式）、DashScope 基址硬编码（若新模型走标准端点需配置化）。**Python 侧增强的具体范围在 Phase 3 需求阶段评估**，Node 编排与代理间保持 HTTP 契约耦合（沿用 codebase-map 红线）。
- 照片/截图已直接存 COS（公网 URL），优先走 URL 输入形态，减少本地文件依赖。

### 生成与引用（三段式回答结构）

- LLM 输出：正文文本 + `[n]` 引用标记（引用命中的技巧）。
- 服务端解析引用标记 → 拼装三段式回答对象：

```json
{
  "reply": {
    "text": "……正文文字（穿搭建议，含 [1][2] 标记）……",
    "images": [
      { "url": "COS截图URL", "caption": "frameDescription 画面说明", "tipTitle": "命中技巧标题" }
    ],
    "sources": [
      { "videoTitle": "来源视频标题", "videoUrl": "B站链接", "timestampSeconds": 150,
        "tipTitle": "技巧标题", "screenshotUrl": "COS截图URL" }
    ]
  }
}
```

- 呈现规则（用户确认）：
  - 正文文字为主体，对应风格/技巧的**图片示例内嵌展示**（命中技巧 → 该技巧截图一并展示）；
  - **视频仅作注脚/引用资源**，统一显示在回答最下方（标题 + 链接 + 可跳转原视频 `?t=` 对应时刻），不混入正文图片区。
- 系统提示词强制：
  1. 只基于给定技巧回答，按"是什么 / 为什么 / 怎么穿"组织；
  2. 综合多条命中的技巧，不编造知识库外的方法；
  3. 回答内用 [n] 标注引用；
  4. **兜底（用户确认）：无命中或置信度低时明确告知"知识库暂无相关内容"，不硬编、不附带通用常识**。

### 多轮对话（确认 = 单个用户追问）

- 会话管理：conversation / message 表（**PostgreSQL，与知识库同一库**，用户确认）。
- 每轮处理：
  1. query 重写（LLM 基于历史补全当前问题）→ 2. 检索 → 3. 生成（携带最近 N 轮历史作为对话上下文）。
- 会话内照片：会话期间可复用（后续轮次引用照片上下文）。
- 会话生命周期：创建 → 多轮消息 → 可查看历史。

### 会话与照片管理（隐私策略后置）

- 会话存储：云端 PostgreSQL（与知识库同库）。
- 用户照片：上传时**先压缩一次**，再存 COS 桶（如 `user-photos/<conversation_id>/...`），URL 直接可用；不做私有桶/签名 URL（用户确认后置隐私策略）。
- 用户照片仅用于当前会话分析与检索上下文，不进入知识库。

### 评估（无标注数据的前提）

- 准备 20-30 个典型穿搭问题作为抽检集（两场景各半，含多轮对话用例），人工评估 top-k 命中质量与回答质量，结果记录到 `docs/testing/`（沿用项目测试文档传统）。
- 指标：命中相关率、回答引用准确率、无命中兜底正确率、照片场景描述准确率。

## 知识发布管道（Phase 1 主体）

- 触发点：`AnalysisTriggerService.runAnalysis` 分析完成（异步发布，不阻塞主链路）。
- 动作：
  1. 解析 raw_response → 展开 summary_segment 行；
  2. 截图上传 COS（Key：`summary/<bvid>-<cid>/screenshots/segment-N.jpg`）；
  3. upsert 云端 summary + segments（重总结按 bvid+cid 全量替换）。
- 失败语义：本地 `completed` 但云端未同步 → `knowledge_status`（pending/synced/failed）+ 手动重试入口（复用现有 rebuild 的交互模式）。
- 与本地写入并存（影子双写）：本地路径保留作备份，云端发布失败不影响本地完成态。

## 云端知识侧数据模型（PostgreSQL + pgvector 草案）

```sql
-- 一份视频总结（对应一个 bvid+cid 的 completed 总结）
CREATE TABLE summary (
  id            BIGSERIAL PRIMARY KEY,
  bvid          TEXT NOT NULL,
  cid           BIGINT NOT NULL,
  video_title   TEXT NOT NULL,
  video_url     TEXT,
  model_name    TEXT,
  raw_response  JSONB NOT NULL,          -- 权威源，保留模型原文
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (bvid, cid)
);

-- 一条技巧 = 一个 RAG chunk
CREATE TABLE summary_segment (
  id                BIGSERIAL PRIMARY KEY,
  summary_id        BIGINT NOT NULL REFERENCES summary(id) ON DELETE CASCADE,
  seq               INT NOT NULL,
  title             TEXT NOT NULL,
  content           TEXT NOT NULL,
  timestamp_seconds INT,                 -- 由 timestamp 字符串解析，支持 B 站 ?t= 跳转
  frame_description TEXT,
  screenshot_url    TEXT,                -- COS 地址，历史数据可空
  embedding         vector,              -- 维度随所选 embedding 模型（选型后置）
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 多轮会话（草案）
CREATE TABLE conversation (
  id            BIGSERIAL PRIMARY KEY,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE message (
  id              BIGSERIAL PRIMARY KEY,
  conversation_id BIGINT NOT NULL REFERENCES conversation(id) ON DELETE CASCADE,
  role            TEXT NOT NULL,        -- user / assistant
  content         TEXT NOT NULL,        -- 文本内容
  photo_urls      TEXT[],               -- 用户上传照片（COS URL，已压缩）
  reply_images    JSONB,                -- 三段式回答的 images 段
  reply_sources   JSONB,                -- 三段式回答的 sources 段
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

## 现有功能影响面

| 现有功能 | 上云后变化 |
| --- | --- |
| `GET /api/summary-tasks/:id/markdown` | 云端部署下 md 文件可能不在本地；建议改为从 DB raw_response 实时渲染（generateMarkdown 为纯函数），顺带修复"容器重建丢总结"已知缺陷 |
| rebuild（基于 raw_response 重截图） | 依赖本地视频文件；云端无视频时不可用，需在文档注明能力边界，不阻塞知识问答 |
| 删除 / 重总结 | 需新增级联语义：云知识、向量、COS 文件处理（开放问题） |

## 阶段划分（建议）

```
Phase 0  本讨论定稿 → 转需求文档（docs/requirements/）
Phase 1  知识发布管道：raw_response → segments → COS 截图上传 → 云端知识库写入
        （本地写入保留作备份；COS 上传可独立先行）
Phase 2  向量化 + 检索 API（embedding 选型在此阶段前定；现有 server 暴露 /api/knowledge/search）
Phase 3  问答服务 + 独立前端（双场景 + 多轮 + 三段式引用 + 多模态生成，视觉输入开关、照片压缩、Python 侧增强评估均在此阶段需求中细化）
Phase 4  历史数据回填 + 删除/重总结级联治理
```

依赖：Phase 1（COS 部分）不依赖云 DB 选型，可先行；Phase 2 依赖 Phase 1；Phase 3 依赖 Phase 2。

## Open Questions（剩余）

### 后置（不阻塞 Phase 1 / Phase 2 需求撰写）

1. **删除/重总结的级联语义**：COS 截图文件是否随记录删除（保留可作引用存档，删除省成本）——Phase 4 定。
2. **Q&A 服务用户与访问方式**：公开互联网？登录/限流？规模预期？——先按无鉴权设计，后续如公开运营再评估（触碰 auth 保护区域时需 owner doc + 测试）。
3. ~~**Embedding 模型选型**~~（已解决 2026-09-01：DashScope `qwen3.7-text-embedding`，维度建议 1024，Phase 2 需求定稿）。
4. **Python 侧（vision proxy）增强范围**：基址配置化 / 流式 / 参数透传——Phase 3 需求阶段评估。
5. **照片压缩参数**：尺寸/质量目标——Phase 3 需求阶段细化。
6. **照片隐私策略**：已确认后置。
7. **会话保留时长**：暂不限制，Phase 3 视运营情况定。

## 假设（待确认，标记为假设而非决策）

- 假设云端组件走腾讯云托管服务（PostgreSQL/COS），LLM 与多模态继续走 DashScope。
- 假设"独立前端"指独立页面/独立入口，未必是独立代码仓库（先同仓库、后拆）。
- 假设历史已生成的总结（如有）需要回填，回填动作放在 Phase 4。
- 假设用户照片不进入知识库，仅服务当前会话。
- 假设 Phase 1 采用影子双写（本地保留 + 云端发布），不做本地消费路径。

## 下一步

- 本讨论 RAG 形态已收敛，剩余 Open Questions 均为后置项，**不阻塞 Phase 1 + Phase 2 需求撰写**。
- 建议：将本讨论演进为 `docs/requirements/` 需求文档，先写 Phase 1（知识发布管道）+ Phase 2（向量化检索），Phase 3（问答服务）在 Python 侧增强评估后再细化。
- 需求定稿后按项目流程出 plan 并审计（涉及数据库/部署/外部集成/用户数据，属于受保护区域）。
