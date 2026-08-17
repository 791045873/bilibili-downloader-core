# Testing - AI 总结列表查看总结文档（Markdown 预览）（2026-08-17）

需求：`docs/requirements/2026-08-17-ai-summary-view-markdown.md`
计划：`docs/plans/2026-08-17-ai-summary-view-markdown-plan.md`

## 验证方式

项目无单元测试设施，采用 typecheck/build + 一次性脚本冒烟（临时目录隔离，不入库）+ 人工运行级确认。冒烟沿用既有模式（`$TEMP/opencode/*/smoke.ps1` 一次性脚本）。

## 自动化验证结果（已填 2026-08-17）

- `pnpm typecheck`：通过（全 workspace）。
- `pnpm build`：通过（全 workspace）。
- API/静态冒烟（一次性脚本 `$TEMP/opencode/bili-mdview-smoke/run-smoke.ps1`，另起 server + 临时 OUTPUT_DIR/cwd 隔离，不入库）：25 项全部通过。
- `pnpm docker:build`：通过（镜像 `bilibili-downloader:latest` 构建成功，lockfile 已含新前端依赖）；容器运行级冒烟（`$TEMP/opencode/bili-mdview-smoke/run-docker-smoke.ps1`）6 项全部通过。

### 冒烟逐项结果（API/静态）

| # | 方向 | 结果 |
| --- | --- | --- |
| 1 | 静态挂载 | PASS：`/summary-files/<目录>/screenshots/segment-0.jpg` 返回 200，内容一致。 |
| 2 | 契约错误码 | PASS：非法 id → 400；不存在 → 404；`failed` → 409；`completed` 但无 `summary_output` → 409。 |
| 3 | 文件缺失 | PASS：磁盘 md 已删 → 404。 |
| 4 | 图片重写-成功 | PASS：`![关键画面](screenshots/segment-0.jpg)` → `/summary-files/%E8%A7%86…/screenshots/segment-0.jpg`。 |
| 5 | 图片重写-`./` 前缀 | PASS：`./screenshots/x.jpg` → 正确重写。 |
| 6 | 图片重写-绝对链接保留 | PASS：`https://…`、`//…`、`data:…` 原样保留。 |
| 7 | 图片重写-根相对/锚点保留 | PASS：`/images/r.png`、`#anchor` 原样保留。 |
| 8 | 图片重写-`../` 穿越 | PASS：`../../etc/passwd` 原样保留，未被映射为公网 URL。 |
| 9 | 非图片链接不被改写 | PASS：正文 `[文本](https://…)` 等其他链接不加静态前缀。 |
| 10 | 非 ASCII 目录/文件名 | PASS：中文标题目录重写后的 URL 经编码后静态图片可访问。 |
| 11 | 元数据提取 | PASS：`meta.title/videoUrl/model/createdAt` 与 frontmatter 4 键逐一对应（引号/转义正确还原）。 |
| 12 | frontmatter 剥离 | PASS：`content` 不以 `---` 开头、不含 `video_url:`/`created_at:` 原始行；正文 H1 `# 视频标题` 保留。 |
| 13 | 无 frontmatter 容错 | PASS：无 frontmatter 的 md → `meta` 为空对象、正文原样透传（不含 `---`）。 |

### 冒烟逐项结果（Docker 运行级）

| # | 方向 | 结果 |
| --- | --- | --- |
| 1 | 容器应用就绪 | PASS：`GET /api/summary-tasks` 200。 |
| 2 | 种子数据 | PASS：容器内插入 `completed` 记录成功。 |
| 3 | 容器内 markdown 端点 | PASS：返回重写后的 md 内容；无 frontmatter 文档 → `meta` 为空。 |
| 4 | 容器内静态图片 | PASS：重写后的 `/summary-files/…` URL 返回 200（图片字节一致）。 |
| 5 | 容器内前端 | PASS：`GET /` 200（`/summary-files` 挂载未破坏既有 public 静态资源）。 |

## 人工运行级确认（留给用户）

- 前端"AI 总结任务"页：`completed` 记录操作列出现"查看总结"；点击弹窗顶部显示元数据条（B站原视频链接可打开 / 模型 / 生成时间），下方渲染正文（标题/段落/引用/插图均正常显示）。
- 插图在浏览器 Network 面板中以 `/summary-files/…` 请求并返回 200；点击缩略图可查看大图（缩放/旋转）。
- 全屏切换：标题栏"全屏/退出全屏"按钮生效，内容区随视口自适应。
- 图片文件删除后：弹窗显示错误提示，页面不崩溃。
- `pending`/`analyzing`/`failed` 记录"查看总结"按钮禁用。
- Docker：构建镜像并运行后，对一条含截图的 `completed` 总结执行同样的预览验证（端点层已由容器冒烟覆盖，UI 层留人工确认）。

## 需裁定/关注项

- 前端弹窗渲染样式（标题字号、引用、图片宽度自适应）按"可读、图片不溢出"裁定：`.md-preview` 样式已加上（图片 `max-w-full`、引用左线、标题层级）——裁定通过（typecheck/build 已验证，视觉细节留人工确认）。
- YAML frontmatter：不再以原文行形式显示，改为服务端剥离 + 前端元数据条渲染（用户确认方向）——裁定通过。
- 元数据条布局与文案（"B站原视频"、`模型：`、`生成于`）按简洁可读裁定；`created_at` 识别失败时直接展示原文值兜底。