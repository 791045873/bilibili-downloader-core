# AI 总结邮件通知 — 需求文档（5d）

> 拆分自 `2026-07-07-ai-summary-interaction.md`
> 依赖 `2026-07-07-ai-summary-interaction-5b.md`（分析触发完成后发送通知）

## Goal

AI 总结完成或失败时，发送邮件通知到指定邮箱。

## Background

AI 分析是长时间操作，用户无法看到实时进度。分析完成后通过邮件通知用户。

## In Scope

### 1. 触发时机

- AI 总结完成时发送通知邮件
- AI 总结失败时也发送通知邮件

### 2. 配置

环境变量：

```env
SMTP_HOST=smtp.example.com
SMTP_PORT=465
SMTP_USER=sender@example.com
SMTP_PASS=password
NOTIFICATION_EMAIL=recipient@example.com
```

### 3. 邮件内容

按最简方式编写：

**成功时：**
- 标题：`AI 总结完成：{视频标题}`
- 正文：视频标题 + 视频原始链接（如果是 B 站视频，附 B 站链接；如果是本地视频，不附链接，但附上视频名称）+ Markdown 文件路径

**失败时：**
- 标题：`AI 总结失败：{视频标题}`
- 正文：视频标题 + 视频原始链接（同上规则）+ 错误信息

## Out of Scope

- 不实现多个收件人
- 不实现邮件模板自定义
- 不实现分析进度展示

## Affected Files

| 文件 | 改动 |
|---|---|
| `packages/server/src/notification/` | 新增邮件通知模块（service + module） |
| `packages/server/src/app.module.ts` | 注册通知模块 |
| `packages/server/src/download/download.service.ts` | 分析完成/失败后调用通知服务 |

## Acceptance Criteria

1. 分析完成后发送邮件通知到 `NOTIFICATION_EMAIL` 指定的邮箱
2. 分析失败时也发送邮件通知
3. 成功邮件包含视频标题、原始链接（B 站视频附 B 站链接，本地视频附视频名称）、Markdown 文件路径
4. 失败邮件包含视频标题、原始链接、错误信息
5. SMTP 配置通过环境变量读取
6. `pnpm typecheck` 和 `pnpm build` 通过
