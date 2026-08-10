# 2026-08-10 下载文件名模板与命名收敛（P2）测试方向

> Plan: `docs/plans/2026-08-10-download-file-name-template-plan.md`
> Source: `docs/discussions/2026-08-10-download-file-naming.md`
> 本文件只描述需求级可观察状态，不包含实现细节或脚本。

## Testing Directions

### TD-P2-1：空模板回退默认命名

- 应为真：未配置 `fileNameTemplate` 时，输出文件名与 P0 默认一致（`{title}-{bvid}-{cid}-q{quality}.mp4`），唯一性保证不丢失。
- 不应为真：模板为空时生成空/异常文件名，或唯一性后缀丢失导致同标题冲突回归。

### TD-P2-2：配置模板后按模板渲染

- 应为真：配置如 `{title} [{bvid}]` 后，下载文件按占位符渲染命名，`{title}` 取前端提交的展示标题。
- 不应为真：占位符未被替换、或 `{title}` 被替换为服务端回源标题而丢失"剧集名 - Px 分P标题"信息。

### TD-P2-3：非法/未知占位符不破坏下载

- 应为真：模板含未知占位符或用户误输入时，下载仍成功且文件名可预期（未知占位符按既定规则处理并记录），不会抛出未处理错误。
- 不应为真：模板错误导致任务失败或生成包含原始非法字符的文件名。

### TD-P2-4：outputPath 目录语义不变

- 应为真：`outputPath` 仍作为下载根目录下的独立相对子目录，模板只影响文件名部分，二者不互相污染。
- 不应为真：模板占位符、文件名内容影响目录结构，或 outputPath 被改写。

### TD-P2-5：模板配置入口可用（设置页全局默认）

- 应为真：设置页可配置全局默认模板（持久化到前端本地），保存后新建下载任务按该模板命名；未配置时使用默认命名。入队弹框无单任务覆盖入口。
- 不应为真：设置项缺失、配置不生效，或出现未计划的单任务覆盖入口。

### TD-P2-6：模板在任务创建时捕获并持久化

- 应为真：任务创建时写入的 `fileNameTemplate` 在任务执行时生效；任务创建后修改全局模板不影响该任务（历史任务沿用创建时模板）。
- 不应为真：执行时使用当前全局设置导致已创建任务的文件名漂移，或 DB 未持久化导致重启后模板丢失。

### TD-P2-7：低清分析下载不应用用户模板

- 应为真：`executeLowResDownload`（分析用低清视频）保持固定命名，不受用户模板影响，避免分析任务依赖的文件名被用户配置破坏。
- 不应为真：用户模板污染分析低清文件名，导致截图源/分析流程文件定位失败。

## Verification

- `pnpm typecheck`、`pnpm build` 通过。
- 逻辑级验证（本会话）：用 `pnpm build` 编译产物直接调用 `buildOutputFileName` 验证渲染；DB 迁移用内存 SQLite 冒烟（幂等 ALTER + 读写）。

## Status

- TD-P2-1: passed（编译产物验证：空/缺省模板均回退 `{title}-{bvid}-{cid}-q{quality}.mp4`）
- TD-P2-2: passed（编译产物验证：`{title} [{bvid}]` 正确渲染；`{title}` 使用任务标题即前端展示标题，代码检查确认）
- TD-P2-3: passed（编译产物验证：未知占位符 `{foo}` 保留字面量、空 codec 渲染为空串，不抛错）
- TD-P2-4: passed（代码检查：命名模块只返回文件名，`outputPath` 目录拼接在 `executeTask` 保持不变）
- TD-P2-5: passed（代码检查：Settings.vue 输入 + settings store + 两个视图 `createDownload` 透传；运行级 UI 交互留用户手动）
- TD-P2-6: passed（代码检查 + 内存 SQLite 冒烟：创建时 `fileNameTemplate` 落库，执行时读取；修改全局设置不影响已创建任务）
- TD-P2-7: passed（代码检查：`executeLowResDownload` 调用命名模块时不传 template，恒用默认命名）

> 运行级说明：真实下载渲染文件名与设置页交互需在运行中的 server + 前端环境手动确认。本会话以编译产物逻辑验证 + 代码检查 + 内存 DB 冒烟作为证据，运行级确认留给用户手动执行（记录于计划 Closure 与日志）。
