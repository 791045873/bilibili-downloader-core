# 2026-06-15 下载目录指定与查看测试说明

- Linked Plan: `docs/plans/2026-06-15-download-directory-view-plan.md`
- Source Requirement: `docs/requirements/2026-06-15-download-directory-view.md`

## Environment / Notes

- 使用现有 Web + NestJS 本地开发环境。
- 使用代码审阅与类型检查确认 UI 状态；本轮未启动浏览器做截图验证。

## Testing Directions

### 1. 目录配置 API

- Requirement / Change: 服务端应提供只读 API 返回当前下载根目录和来源。
- Should Be Observable: 调用 `GET /api/download/config` 返回 `outputDir` 与 `source`，其中 `source` 为 `env` 或 `default`。
- Should Not Be Observable: API 缺失、返回空路径，或允许通过该接口修改下载根目录。
- Status: passed
- Evidence: `Invoke-RestMethod http://localhost:3000/api/download/config` 返回 `{"outputDir":"C:\\Users\\79104\\Desktop\\mycode\\bilibili-downloader-core\\packages\\server\\downloads","source":"default"}`。

### 2. 设置页查看下载根目录

- Requirement / Change: 用户应能在设置页查看当前服务端下载根目录和配置来源。
- Should Be Observable: 设置页展示一个服务端下载根目录路径，并区分来自环境变量或默认目录。
- Should Not Be Observable: 设置页完全没有下载目录信息，或把浏览器本机路径误认为服务端路径。
- Status: passed
- Evidence: `Settings.vue` 设置页新增下载目录区块，展示服务端下载根目录和 `环境变量` / `默认目录` 来源标记。

### 3. 设置页复制下载根目录

- Requirement / Change: 用户应能复制当前服务端下载根目录。
- Should Be Observable: 点击复制后能获得成功反馈；复制失败时页面仍保留下载目录展示和主要设置功能。
- Should Not Be Observable: 复制失败导致页面崩溃，或没有任何可理解反馈。
- Status: passed
- Evidence: `Settings.vue` 提供复制按钮，成功时显示 `已复制`；失败时显示 `复制失败，请手动选择路径文本。`，不清空目录展示且不影响其他设置功能。

### 4. 入队目录弹框语义清晰

- Requirement / Change: 入队弹框中的目录字段应明确表示下载根目录下的相对子目录。
- Should Be Observable: 弹框文案说明输入的是相对子目录，并保留原有默认值和非空校验。
- Should Not Be Observable: 弹框继续让用户以为该字段是完整下载根目录。
- Status: passed
- Evidence: `VideoDetail.vue` 弹框标题改为 `确认下载子目录`，文案说明填写的是下载根目录下的相对子目录，并保留非空校验。

### 5. 下载列表展示实际输出文件

- Requirement / Change: 下载列表应展示已返回的实际输出文件路径。
- Should Be Observable: 对有 `outputFile` 的任务，任务卡片展示输出文件位置。
- Should Not Be Observable: 已完成任务仍完全看不到文件保存位置。
- Status: passed
- Evidence: `Downloading.vue` 对有 `outputFile` 的任务展示 `输出文件：` 和实际路径文本。

### 6. 类型与构建门禁

- Requirement / Change: 新 API 与前后端类型变更不能破坏现有类型检查。
- Should Be Observable: `pnpm typecheck` 通过。
- Should Not Be Observable: TypeScript 报错或 API 类型不一致。
- Status: passed
- Evidence: `pnpm typecheck` 通过，6 个 workspace 包 typecheck 均完成。
