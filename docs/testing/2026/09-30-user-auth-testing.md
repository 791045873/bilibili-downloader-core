# 09-30 小用户系统与写鉴权（auth）Testing

> 需求：`docs/requirements/2026-09-17-user-auth.md`
> 计划：`docs/plans/2026-09-30-user-auth-plan.md`
> 定位：需求级观察态（应呈现/不应呈现），非测试脚本。

## 检查应覆盖的状态

### T1 数据模型与回填
- `user`/`user_session`/`conversation.user_id` 经 contract/emit/migration 落地；存量会话回填归 admin（幂等）。

### T2 admin 播种
- `ADMIN_INITIAL_PASSWORD` 存在→首次创建 admin；已存在→不动；缺失→告警且不建默认密码。

### T3 登录/会话
- login/logout/me 可用；会话经 HttpOnly Cookie（与 B站 cookie 命名/路径隔离）；token 仅存 hash；登出/禁用使会话失效；过期→401。

### T4 权限矩阵
- 写/管理接口仅 admin；普通 user 仅 QA 且只能访问自己的会话（他人 404/403）；按 (bvid,cid) 读 AI 总结整页对 user 开放；未登录 401、越权 403。

### T5 登录防护
- 同一 IP 连续多次登录失败后临时封禁一段时间（阈值/时长内置）。

### T6 前端
- 登录页/会话态；未登录跳登录；管理类仅 admin 可见；user 仅见 QA+总结整页；401 跳登录。

### T7 安全项
- 无默认密码；密码 scrypt + timingSafeEqual；token hash 存储；HttpOnly/SameSite cookie；日志不含明文密码/token。

### T8 无回归
- server typecheck/build/test 绿；frontend typecheck/build 绿；既有功能加鉴权后行为不变（admin 视角）。

## 验证命令
- `pnpm --filter @bilibili-downloader/server test`（测试容器，`TEST_DATABASE_URL`）
- `pnpm --filter @bilibili-downloader/server typecheck` / `build`
- `pnpm --filter @bilibili-downloader/frontend typecheck` / `build`

## 结论

> 回填时间：2026-09-30。测试库：`pgvector/pgvector:pg17`（`bdl-test-pg`，55432）。server **28 files / 216 tests 全绿**；全仓 `typecheck`、`build` 绿。

- **T1 数据模型与回填｜通过（自动化）**：`user`/`user_session`/`conversation.user_id` 经 contract + `prisma:emit` 落地，fresh `db init` 建表成功；`tests/database/user-auth.test.ts` 覆盖仓储往返、唯一约束、按 user 过滤、`backfillConversationUserId` 幂等（二次为 0）；`tests/user-auth/user-seed.test.ts` 覆盖启动回填（有 admin 才回填、无 admin 为 no-op）。
  - 裁决：迁移目录 `migrations/app/20260930T0753_worker_jobs_and_user_auth` 为**本机产物**（`packages/server/migrations/` 被 .gitignore 排除），未对任何存量库执行 `db migrate`；schema 真源是 contract + emit，additive 迁移随部署应用。
- **T2 admin 播种｜通过（自动化）**：`tests/user-auth/user-seed.test.ts`——env 存在且无 admin → 创建且口令为 env 值的 scrypt 摘要；env 缺失 → **不创建任何账号**（告警路径，无默认口令）；admin 已存在 → 幂等，即使 env 变更也不改口令/角色。
- **T3 登录/会话｜通过（自动化）**：`auth-service.test.ts` 覆盖登录成功（DB 仅存 token 摘要）、token 解析、过期会话视为未登录并被清理、登出吊销、用户禁用后会话立即失效、`cookieOptions` 为 HttpOnly + SameSite=Lax + path=/、**Secure 由 `SESSION_COOKIE_SECURE` 显式开关控制（默认关）**；cookie 名 `bdl_session` 与 B站 `.cookies.json`（服务端文件）天然隔离。
  - 未自动化：真实浏览器里的 Set-Cookie / 过期时间行为——属运行级确认，见下方待人工项。
- **T4 权限矩阵｜通过（自动化 + 逐路由核对）**：`auth-guard.test.ts` 覆盖 `@Public` 放行、无会话/无效 token → 401、**默认仅 admin**（普通 user → 403）、`@Roles(admin,user)` 放开 user、角色白名单严格匹配；`users-controller.test.ts` 覆盖 admin 管理面；`user-auth.test.ts` 覆盖 `getConversation(id, 他人)` 视为不存在（**404 抗枚举**）。全仓仅 2 处显式放开（`chat.controller` 类级、`analysis-task.controller` 的 `by-resource/:bvid/:cid/markdown` 方法级），其余路由按 fail-closed 默认即 admin-only，已逐一核对。
- **T5 登录防护｜通过（自动化）**：`auth-service.test.ts`——同 IP 连续失败达阈值后封禁（此后即使口令正确仍拒绝）、登录成功清零该 IP 计数、失败计数表超上限时清扫且不影响活跃 IP 的封禁判定、超长口令直接按凭据无效；控制器对封禁返回 **429 + `Retry-After`**，凭据无效统一 **401 通用文案**（抗用户名枚举）。
  - 裁决（已知局限）：失败计数是**进程内内存**，不跨实例、重启即清零；且 `trust proxy` 未开启（`X-Forwarded-For` 无法伪造，这是对的）意味着**反代后所有客户端塌缩为同一 IP、封禁粒度变全局**。两者已记入 `docs/architecture/system-baseline.md` 并作为 Deferred 项转 Phase 3 Stage D 裁决。
- **T6 前端｜部分通过（静态）**：frontend `typecheck`/`build` 绿；门禁为**渲染前早退**并覆盖三态（unknown → Spin、anonymous → 跳 `/sign-in`、已登录访问 `/sign-in` → 按角色回落）；非 admin 做**路径级**门禁（仅 `/qa` 与 `/summary/:bvid/:cid`），直接输入 URL 同样被拦；401 拦截集中在 `api/index.ts` 广播 + `stores/session.ts` 监听，单点实现。
  - 未自动化：浏览器端逐屏交互（登录、退出、user 视角导航、会话过期后自动跳转）——前端无测试框架，属运行级确认，见下方待人工项。
  - closure 评审发现并已修：`requestRaw`（建会话 / 传照片 / 删会话三条 QA 写路径）此前不带 `credentials` 也不广播 401，会话失效时只弹错误文案而不跳登录；现与 `request` 共用同一 401 处理。
- **T7 安全项｜通过（自动化 + 代码核对）**：无默认口令（T2）；`password.test.ts` 证明随机 salt + 同口令两次哈希不同 + 非法存储格式返回 false 而不抛错，比较用 `timingSafeEqual`；DB 仅存 sha256 `token_hash`（T3）；cookie HttpOnly/SameSite=Lax/`SESSION_COOKIE_SECURE` 时 Secure；用户视图恒不含 `password_hash`；日志经 `createLogMessage` 仅记 id/username/角色/失败次数，且全局请求日志为白名单制（`password`/`token` 不在 `SAFE_LOG_KEYS`），无明文口令或 token。
  - 额外加固（超出需求）：禁用接口拒绝「禁用自己」与「禁用最后一个可用 admin」，避免把系统锁死（`users-controller.test.ts` 覆盖）。
- **T8 无回归｜通过**：全仓 `typecheck`、`build` 绿；server 28 files / 216 tests 全绿（含加鉴权前既有的全部用例，均以 admin 语义通过）。

### 独立 closure 评审（auth 保护区，非 cold-replay）

- Verdict **PASS-WITH-FIXES**（2026-09-30，General 子代理，fresh-eyes）。评审自行枚举全仓 12 个 `@Controller` / 61 个路由方法，确认仅 3 处 `@Public()` 与 2 处 `@Roles(admin,user)`、其余按 fail-closed 默认即 admin-only，无未覆盖端点；并实跑验证命令复核结果。
- 2 项 Blocker 已修：部署路径未接线（compose/`.env.example` 无任何 auth 变量 → 上线后无账号可登录；cookie Secure 依赖仓内从不设置的 `NODE_ENV` → 恒 false，已改显式开关）；`project-context.md` 先于评审写下"已过 closure 评审"的表述。
- 4 项 Should-fix 已修：`requestRaw` 401 漏网、失败计数表无界增长、过期会话清理只挂登录路径、登录口令长度无上限。
- 2 项转 Deferred（Phase 3 Stage D）：反代后封禁粒度塌缩、迁移产物不入库。逐条见 plan 的 Closure 段。

### 待人工运行级确认（不阻塞闭合）

- 以 `ADMIN_INITIAL_PASSWORD` 起一次真实服务：admin 登录 → 建一个 `user` → 用该 user 登录，确认仅见「穿搭问答」且能打开 `/summary/:bvid/:cid`、访问其它 URL 被弹回 `/qa`。
- 删除浏览器 cookie 或等会话过期后操作任一接口，确认 401 后自动跳登录页。
- 确认 B站扫码登录（admin 视角）在加鉴权后行为不变。

