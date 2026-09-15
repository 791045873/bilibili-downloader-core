# 需求：QA 回答来源视频增加"AI 总结"整页链接

> 来源：用户 2026-09-15 直接请求（"当前的 qa 问答界面，agent 的回复中有来源视频的内容，为每一条来源视频增加额外的 ai 总结链接，点击该链接可跳转到新页面，查看该视频的完整的 ai 总结"）+ 现状扫描结论
> Owner Doc：`docs/design/app-overview.md`（穿搭问答（Web）章节）
> 相关既有实现：`docs/requirements/2026-09-09-rag-chat-service.md`（QA 页功能基线）、`docs/requirements/2026-08-17-ai-summary-view-markdown.md`（总结 Markdown 查看基线）
> 范围确认（2026-09-15，用户）：
> - 来源去重：**按 source 条目去重**（沿用现状，每条来源条目独立展示，不按视频合并）
> - 总结口径：**产品语义上的 AI 总结**，即 `ai_summary_task.summary_output` 指向的完整总结 Markdown（与 AI 总结任务页弹窗同一份内容）
> - 页面形态：**整页路由**（不是弹窗/抽屉）
> - 缺失处理：**不做降级**，点击后若无对应总结资源，详情页直接报错

## Goal

QA 问答助手回答的"来源视频"区内，每一条来源条目在保留现有"来源视频标题 + B 站 `?t=` 时刻跳转链接 + 技巧标题"的基础上，新增一个"AI 总结"链接；点击后跳转到独立的整页路由，展示该来源视频对应的完整 AI 总结 Markdown（含文字与截图）。

## In Scope

### 后端来源数据透传

- 知识检索 `searchKnowledgeSegments`（`packages/server/src/database/database.service.ts`）的返回结果补充 `bvid`、`cid`（来源表 `summary` 已持有这两列）。
- `ChatHit`（`packages/server/src/chat/chat.types.ts`）补充 `bvid`、`cid`。
- 三段式来源对象 `ChatReplySource` 前后端类型补充 `bvid`、`cid`；`buildReplyPayload`（`packages/server/src/chat/chat.service.ts`）在每条来源注脚中填充。新增字段随 `message.reply_sources` (jsonb) 持久化。

### 后端按视频资源取完整总结

- 新增只读接口 `GET /api/summary-tasks/by-resource/:bvid/:cid/markdown`，复用现有按 id 的 `GET /api/summary-tasks/:id/markdown` 行为：先按 `(bvid,cid)` 定位 `ai_summary_task`，再返回 `{ content, meta }`（`content` 为剥离 frontmatter 的正文、相对图片链接重写为 `/summary-files/…`；`meta` 含 `title/videoUrl/model/createdAt`）。
- 失败语义（不做降级、不做兜底总结）：
  - `bvid` 非法/为空或 `cid` 非正整数 → 400。
  - 无 `(bvid,cid)` 对应的 AI 总结记录 → 404。
  - 记录存在但 `status !== "completed"` → 409。
  - 记录 `summary_output` 为空 → 409。
  - `summary_output` 指向的 md 文件在当前环境缺失 → 404。

### 前端来源条目新增链接

- `ChatReplySource` 前端类型补充 `bvid`、`cid`（按兼容性置为可选，见 Edge Cases）。
- `QaChat.tsx` 来源区每条来源条目在现有内容后追加"AI 总结"链接；链接在条目能取到 `bvid` 且 `cid` 时渲染。
- 链接为应用内路由跳转（同标签页整页导航），目标路由携带 `bvid` 与 `cid`。

### 前端整页总结详情

- 新增路由 `summary/:bvid/:cid`（懒加载新页面组件），从 QA 页点击"AI 总结"进入。
- 页面加载并渲染完整总结 Markdown：顶部元数据条（B 站原视频链接/模型/生成时间，存在时展示）+ 正文（含截图插图，插图经 `/summary-files` 静态前缀加载，点击可看大图）。
- 加载中显示加载态；请求失败时显示错误信息（不做降级、不回退到其它内容），页面保持可返回 QA 页。
- 页面复用现有 Markdown 渲染样式（`md-preview`）与 `antd` `Image` 预览能力，形态与 AI 总结任务页弹窗正文一致。

## Out Of Scope

- 不改动检索/生成/三段式的业务语义、提示词、模型调用与命中阈值。
- 不改动来源条目现有去重键（仍为 `videoUrl|timestampSeconds|title`），不按视频合并来源条目。
- 不为"缺少总结"提供兜底内容、摘要生成或引导跳转到 AI 总结任务列表页。
- 不改动 AI 总结任务页（`/summary-tasks`）现有列表与弹窗行为。
- 不改动数据库 schema、Prisma contract 或迁移。
- 不改动鉴权/权限、部署配置。
- 不覆盖历史消息中 `reply_sources` 缺失 `bvid/cid` 的补写。

## Main User Flows

### 从 QA 回答进入某来源视频的完整总结

1. 用户在 `/qa` 提问并获得助手回答。
2. 回答底部"来源视频"区展示若干来源条目，每条含 B 站链接、技巧标题与新增的"AI 总结"链接。
3. 用户点击某条来源的"AI 总结" → 跳转到整页总结详情路由。
4. 页面展示该视频完整 AI 总结 Markdown（元数据条 + 正文 + 截图）。
5. 用户可返回 QA 页（浏览器后退或页面返回入口）。

### 来源视频没有可用总结

1. 用户点击"AI 总结"。
2. 详情页请求返回 404/409/文件缺失等错误 → 页面显示错误信息，不展示任何兜底总结内容。

## Business Rules

- **来源条目粒度**：每条来源条目独立展示与链接，不再按视频聚合；同一视频的多个技巧会各自出现一条来源与一个"AI 总结"链接（与现状一致）。
- **总结口径**：详情页内容等同 `GET /api/summary-tasks/by-resource/:bvid/:cid/markdown` 的返回，即该视频 `ai_summary_task` 的完整总结 Markdown；不采用知识库 `summary.raw_response` 另行渲染。
- **资源定位**：以 `(bvid,cid)` 唯一定位总结记录（`ai_summary_task` 对该组合有唯一约束）。
- **无降级**：总结不存在、未完成、无输出文档或 md 文件缺失时，详情页只呈现错误，不提供替代内容或自动跳转。
- **链接渲染条件**：来源条目含 `bvid` 且 `cid` 为正整数时渲染"AI 总结"链接；缺失标识的来源条目（如改造前已持久化的历史消息）不渲染该链接。
- **兼容性**：新字段随新消息持久化；历史 `reply_sources` jsonb 不含 `bvid/cid` 时，前端不渲染链接且不报错。
- **无后端契约破坏**：来源对象只做字段新增，现有字段与三段式结构不变；既有 `/api/summary-tasks/:id/markdown` 行为不变。
- **导航方式**：应用内路由跳转（同标签页整页），非新标签页打开。

## Roles / Permissions

- 单用户工具，无角色/权限系统；本次不触碰鉴权（属保护区域，未涉及）。

## Edge Cases

- 同一视频多个技巧：每条来源条目各自渲染"AI 总结"链接，指向同一目标；行为可接受且符合"按 source 条目去重"确认。
- 来源 `videoUrl` 为空但仍取到 `bvid/cid`：B 站链接不渲染，但"AI 总结"链接仍可用（这正是透传 `bvid/cid` 而非从 URL 反推的原因）。
- 历史消息来源不含 `bvid/cid`：不渲染"AI 总结"链接，页面其余部分不变。
- 总结记录被删除 / 从未发布：详情页 404 报错。
- 总结处于 `pending`/`analyzing`：详情页 409 报错（提示未完成）。
- 总结已完成但 md 文件缺失（磁盘清理等）：详情页 404 报错。
- `bvid` 含非预期字符或 `cid` 非数字：详情页以参数/404/400 错误呈现，不崩溃。
- 直接访问/刷新详情页 URL：页面独立完成加载与错误呈现，不依赖从 QA 页带入的临时状态。
- 窄屏（QA 页已做移动端适配）下详情页可读、可滚动，图片不横向溢出。

## Open Questions

无（范围四项已由用户 2026-09-15 确认；其余作为已记录假设，见 Business Rules / Edge Cases）。

## Acceptance Criteria

- [ ] 新的 QA 助手回答中，每条含 `bvid/cid` 的来源条目都展示"AI 总结"链接；现有 B 站链接、时刻、技巧标题保持可用。
- [ ] 点击"AI 总结"跳转到整页路由（URL 携带 `bvid`/`cid`），页面展示该视频完整总结 Markdown（元数据条 + 正文 + 截图）。
- [ ] 详情页请求失败（无记录/未完成/无输出/文件缺失）时显示错误信息，不展示任何兜底或替代总结。
- [ ] 同一视频多条来源条目各自渲染链接，行为一致（按 source 条目去重）。
- [ ] 历史消息（来源不含 `bvid/cid`）不渲染"AI 总结"链接且不报错。
- [ ] 现有 QA 功能（文本/照片问答、多轮、三段式渲染、B 站来源 `?t=` 跳转、空/载/错态）不回归；`/summary-tasks` 页与 `/api/summary-tasks/:id/markdown` 不回归。
- [ ] 详情页可独立刷新/直达；窄屏可读不溢出。
- [ ] `pnpm typecheck`、`pnpm build` 通过；无数据库/Prisma 改动。
