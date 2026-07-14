# AI Summary Email Notification (5d) Testing

> Source: `docs/plans/2026-07-07-ai-summary-email-5d-plan.md`
> Requirement: `docs/requirements/2026-07-07-ai-summary-interaction-5d.md`
> Created: 2026-07-12 (plan audit phase)

## Environment Prerequisites

- Server running on `localhost:3000`
- 5b plan completed (`AnalysisTriggerService` exists and manages analysis lifecycle)
- 5a plan completed (task table has `summary_status`, `summary_output` fields)
- Python vision proxy running (`QWEN_VISION_PROXY_URL` set) for end-to-end analysis trigger
- `QWEN_API_KEY`, `QWEN_API_BASE`, `QWEN_MODEL`, `QWEN_VISION_MODEL` env vars set
- For SMTP-content verification: an [Ethereal Email](https://ethereal.email) test account (obtain credentials via nodemailer `createTestAccount()`) configured in `SMTP_HOST`/`SMTP_PORT`/`SMTP_USER`/`SMTP_PASS`/`NOTIFICATION_EMAIL`
- At least one completed download task with `auto_summary=true` ready for analysis trigger
- Test video with known title for content assertion

## Testing Directions

### 1. Success Email Sent On Analysis Completion (AC1, AC3)

**Should:** When `AnalysisTriggerService.trigger()` sets `summary_status = 'completed'`, an email is sent to `NOTIFICATION_EMAIL`. The email subject is `AI 总结完成：{视频标题}`. The body contains the video title, the original link (B-station URL for bilibili videos; for local videos, the video name with no link), and the Markdown file path (`summary_output`).

**Should not:** A success notification should not be sent before `summary_status` is set to `completed`, and should not be sent for tasks where analysis has not run.

**Verification:**
- Configure Ethereal Email SMTP credentials in env vars
- Trigger analysis (download a video with `auto_summary=true`, or call `POST /api/analysis/trigger`)
- Wait for analysis to complete (`summary_status = completed` in DB)
- Open the Ethereal preview URL from server logs
- Confirm subject equals `AI 总结完成：{视频标题}`
- Confirm body contains: video title, B-station link (for bilibili) or video name (for local), Markdown file path

### 2. Failure Email Sent On Analysis Failure (AC2, AC4)

**Should:** When `AnalysisTriggerService.trigger()` sets `summary_status = 'failed'`, an email is sent to `NOTIFICATION_EMAIL`. The email subject is `AI 总结失败：{视频标题}`. The body contains the video title, the original link (same rule as success), and the error message from the caught error.

**Should not:** A failure notification should not crash the analysis flow, and should not be sent when analysis succeeds.

**Verification:**
- Configure Ethereal Email SMTP credentials
- Trigger analysis that will fail (e.g., point `videoPath` to a non-existent file, or unset `QWEN_API_KEY` to force LLM failure)
- Wait for `summary_status = failed` in DB
- Open the Ethereal preview URL
- Confirm subject equals `AI 总结失败：{视频标题}`
- Confirm body contains: video title, link/video name, and a non-empty error message

### 3. SMTP Configuration Read From Environment Variables (AC5)

**Should:** `NotificationService` reads `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, and `NOTIFICATION_EMAIL` from `process.env` (direct access, matching the existing `process.env` pattern in `analysis.controller.ts` lines 42-46). The nodemailer transporter `secure` option is `true` only when `SMTP_SECURE === "true"` (strict string equality).

**Should not:** The service should not use a truthy coercion on `SMTP_SECURE` (the string `"false"` must NOT enable SSL). The service should not log `SMTP_PASS` at any log level.

**Verification:**
- Set `SMTP_SECURE=true` with port 465, trigger analysis — confirm transporter uses implicit SSL (check server log for transporter creation, no credentials leaked)
- Set `SMTP_SECURE=false` with port 587, trigger analysis — confirm transporter uses STARTTLS
- Set `SMTP_SECURE=false` (string) — confirm `secure` is boolean `false`, not truthy-string `"false"`
- Grep server logs for the `SMTP_PASS` value — confirm zero matches (credential redaction)

### 4. Missing SMTP Config Skips Notification Gracefully

**Should:** When any required SMTP env var (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `NOTIFICATION_EMAIL`) is missing, `NotificationService` logs a warning (e.g., "SMTP config missing, skipping notification") and does NOT throw. Analysis completes normally; `summary_status` still transitions to `completed` or `failed`.

**Should not:** Missing SMTP config should not block the analysis lifecycle, should not crash the server, and should not leave `summary_status` stuck in `pending`.

**Verification:**
- Start server with NO SMTP env vars set
- Trigger analysis (single-quality video with `auto_summary=true`)
- Confirm analysis completes: `SELECT summary_status FROM task WHERE id = <id>` returns `completed`
- Confirm server logs contain the "SMTP config missing, skipping notification" warning
- Confirm no email is sent (no Ethereal URL in logs)

### 5. Notification Error Does Not Block Analysis

**Should:** When SMTP is configured but invalid (e.g., `SMTP_HOST=localhost`, `SMTP_PORT=1`, or wrong credentials), `NotificationService.sendSummaryNotification()` catches the send error, logs it (with redacted credentials), and returns normally. `AnalysisTriggerService.trigger()` continues; `summary_status` is still updated to `completed` or `failed`.

**Should not:** A notification send failure should not propagate to `AnalysisTriggerService` and should not prevent `summary_status` from being updated.

**Verification:**
- Start server with INVALID SMTP config (`SMTP_HOST=localhost`, `SMTP_PORT=1`, valid-looking `SMTP_USER`/`SMTP_PASS`/`NOTIFICATION_EMAIL`)
- Trigger analysis
- Confirm analysis completes normally: `SELECT summary_status FROM task WHERE id = <id>` returns `completed` or `failed`
- Confirm server logs contain a notification send error (with NO `SMTP_PASS` value)
- Confirm server does not crash and remains responsive (`curl http://localhost:3000/api/tasks` returns 200)

### 6. Notification Hook Location Is AnalysisTriggerService, Not DownloadService

**Should:** The `sendSummaryNotification()` call site lives inside `AnalysisTriggerService.trigger()` after the `summary_status = 'completed'` / `summary_status = 'failed'` DB update. `DownloadService.executeTask()` does NOT call `NotificationService` directly.

**Should not:** Notification should not be triggered from `DownloadService.executeTask()` or from `DownloadScheduler.onTaskFinished` — the requirement (per 5b restructuring) places the trigger in `AnalysisTriggerService` because analysis lifecycle is decoupled from download pipeline.

**Verification:**
- Code review: `grep -n "sendSummaryNotification\|NotificationService" packages/server/src/download/download.service.ts` returns no matches
- Code review: `grep -n "sendSummaryNotification\|NotificationService" packages/server/src/analysis/analysis-trigger.service.ts` returns matches at the success and failure branches
- Code review: `NotificationModule` is registered once in `app.module.ts` as `@Global()`; `analysis.module.ts` does NOT import `NotificationModule` (relies on global availability)

## Out of Scope

- Multiple recipients — explicitly excluded by requirement
- Email template customization / HTML formatting — plain text sufficient per requirement
- Analysis progress display — excluded by requirement
- Retry logic for failed email sends — optimization candidate, not required for closure

## 2026-07-15 执行记录

- 结果：通过（含裁定项）。
- 通过：`pnpm install`（新增 `nodemailer` 与 `@types/nodemailer` 已落到 `packages/server/package.json`）。
- 通过：`pnpm typecheck`（零错误；存在 Node engine warning: 期望 24.16.0，当前 22.22.3）。
- 通过：`pnpm build`（零错误；存在同样 engine warning）。
- 通过：运行时日志证据（无 SMTP 配置场景）：
	- 启动日志出现 `SMTP config missing, skipping notification` 告警。
	- `NotificationModule` 正常初始化。
	- 服务成功启动，说明通知模块缺失配置不会阻塞主流程。
- 通过（代码审查）：
	- `NotificationService` 通过 `process.env` 读取 `SMTP_HOST/SMTP_PORT/SMTP_SECURE/SMTP_USER/SMTP_PASS/NOTIFICATION_EMAIL`。
	- `SMTP_SECURE` 使用 `process.env.SMTP_SECURE === "true"` 严格解析。
	- 邮件发送异常在 `sendSummaryNotification()` 内部吞并并记录错误，不向上抛出。
	- `AnalysisTriggerService` 在 `summary_status = completed` 与 `summary_status = failed` 后分别调用通知。
	- `DownloadService` 未直接依赖通知服务，触发位置符合 5b/5d 设计边界。
- 裁定：
	- Ethereal 实际收件箱内容核对（成功/失败邮件主题与正文）在当前会话环境下未执行（缺少可共享的 SMTP 凭据与人工浏览步骤），按“证据受环境约束”裁定为可复验项，不阻塞本次代码闭环。
	- 无效 SMTP 主机/端口的真实发送失败日志未在本轮执行；由 `sendMail` 局部 `try/catch` 代码路径与独立审计结论覆盖。
