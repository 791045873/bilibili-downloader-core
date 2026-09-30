# 2026-09-30 小用户系统与写操作鉴权（auth）

> Plan Status: planned
> Last Reviewed: 2026-09-30
> Source: `docs/requirements/2026-09-17-user-auth.md`
> Related: 上游 `docs/discussions/2026-09-17-cloud-nas-responsibility-split.md`（Q11）；与 Phase 3 互为门控（auth 先行，须在公网暴露前完成）
> Audit: required（**auth 保护区**；数据模型 additive + 迁移回填 + 权限门禁；reviewer availability=none → **独立子代理评审，不得 cold-replay 代替**；plan + closure 均须独立子代理评审）
> Testing: `docs/testing/2026/09-30-user-auth-testing.md`

## Current Baseline

- 单体 `packages/server`（NestJS）当前**无鉴权**：所有 HTTP 接口开放。QA 会话 `conversation`/`message`（chat 模块）无用户归属。写类接口（download 创建/停止/删除、analysis 触发/retrigger/rebuild(screenshot_retry)/integrity-check、settings、prompt、任务/总结管理、worker-jobs 取消）均无门禁。
- 无请求上下文用户；无 session 表；无登录页（frontend）。
- B站 扫码 cookie 存于**服务端文件 `.cookies.json`（`COOKIE_FILE_PATH`，`paths.service.ts:31-33`）**，经 `authProvider.saveCookies`/`loadCookies` 读写（`download.service.ts:800,868-871`），**非浏览器 cookie**——故与新用户会话 cookie（`bdl_session`）无任何浏览器 cookie 命名/路径冲突（隔离天然成立）。
- 既有 `@Controller("api/auth")`（`auth.controller.ts`）承载 **B站扫码登录**：`GET /qrcode`、`GET /qrcode/status`（confirmLogin 写 cookie 文件）、`GET /user`（B站账号信息）——与本需求的“用户系统”是不同关注点，仅共享路径前缀（新增 login/logout/me 全路径不冲突）。
- Prisma 契约工作流（contract.prisma → `prisma:emit` → db init/migrate）；`@Global` DatabaseModule。
- 密码哈希拟用 Node 内置 `crypto.scrypt`（无新依赖，Open Question 已定）。

## Goals

- 两级角色：内置 `admin`（全部写权限）、普通 `user`（仅 QA + 按 (bvid,cid) 读 AI 总结整页）。QA 会话按用户隔离。
- 服务端可吊销 session（token 仅存 hash）+ HttpOnly Cookie（与 B站 cookie 隔离）。
- admin 由 `ADMIN_INITIAL_PASSWORD` 首次播种；缺失则告警不建默认密码。普通用户由 admin 创建，不自助注册。
- 写/管理接口 admin-only；QA 接口登录且只能访问自己的会话；未登录 401、越权 403。
- 最小登录防护：同一 IP 连续多次失败临时封禁（Node 内实现，无新依赖）。
- NAS↔云服务身份用最小权限 DB 角色（属 Phase 3 部署，本需求不实现服务令牌）。

## Non-Goals

- 公开注册 / 第三方 OAuth / 支付；通用限流；角色扩展（仅两级）；反向隧道/服务令牌。

## Security Notes（保护区）

- 密码：`scrypt`（随机 salt，存 `salt$hash` 或分列），登录用 `timingSafeEqual` 比较。
- session token：随机（`crypto.randomBytes`），只存 `token_hash`（sha256），Cookie 仅传原 token；HttpOnly + SameSite=Lax +（生产）Secure；独立 cookie 名（如 `bdl_session`）与路径。
- 无默认密码；env 缺失仅告警。禁用用户/登出即吊销 session。
- 登录失败锁定：内存计数（IP→失败次数/首次时间），阈值/窗口/封禁时长内置可配；不新增依赖。
- 不记录明文密码/ token 到日志。

## Execution Plan

### Stage 1 - 数据模型 + admin 播种 + 存量回填

Status: done
Targets: `contract.prisma`（+emit）、`database.service.ts`、启动播种钩子
- Item Types: `Add`
- Prereqs: 无
- [x] `Add`：contract 新增 `User`（id/username 唯一/passwordHash/role/createdAt/updatedAt/disabledAt?）、`UserSession`（id/tokenHash 唯一/userId/createdAt/expiresAt），`Conversation` 加 `userId?`（additive）。`prisma:emit` 产物。
- [x] `Add`：DB 仓储——用户 CRUD（create/findByUsername/list/disable）、session（create/findByTokenHash/deleteByTokenHash/deleteByUserId/purgeExpired）、`conversation.user_id` 读写与按 user 过滤。
- [x] `Add`：启动幂等播种 admin（读 `ADMIN_INITIAL_PASSWORD`；存在 admin 则不动；缺失 env 则告警不建），比照 `seedBuiltinPromptIfEmpty`（`database.service.ts:212-216`）计数守卫插入。存量 `conversation.user_id` 为空的幂等回填归首个 admin id；**无 admin（env 缺失）时回填为 no-op，保持 user_id NULL**。
- [x] `Fix`（GAP1a 哨兵）：`verifySchemaTables` 的 `EXPECTED_TABLES`（`database.service.ts:1982-1989`）增 `user`/`user_session`；`ONE_OFF_MIGRATION_COLUMNS`（`:1991,2010-2020`）增 `conversation.user_id` 存在性检查——存量库未迁移时快速失败而非首次查询才炸。
- [x] `Proof`：`typecheck`、`build`；fresh `db init` 建表；数据层测试（见 Stage 6）随后。
- [x] `Note`（实施记录）：迁移经 `migration plan --from 20260917T0754_qa_chat_soft_delete` 生成 `migrations/app/20260930T0753_worker_jobs_and_user_auth`（14 additive）；指定 from 以避免与既有 `deleted_at` 迁移重叠（本机 db ref 未随软删除推进），并一并补齐 Phase 2 未规划的 worker 两表。**`packages/server/migrations/` 被 .gitignore 排除，故为本机产物、不入库**；schema 真源为 contract + emit。未对目标库执行 `db migrate`（线上 additive 随部署应用）。
- [x] `Note`（目录命名）：新代码落 `src/user-auth/`（而非 `src/auth/`），因 `src/auth/` 已被 B站扫码登录占用；HTTP 路径仍按计划为 `api/auth/*`。

Exit Criteria:
- [x] 三处 schema 经 contract/emit 落地；admin 播种与存量回填幂等；无默认密码。
- [x] `docs/logs/` 记录。

### Stage 2 - auth 核心（登录/登出/me + session + 锁定）

Status: done
Targets: 新增 `auth/`（AuthService、AuthController）、cookie 处理
- Item Types: `Add`
- Prereqs: Stage 1
- [x] `Add`：`AuthService`——scrypt hash/verify（timingSafeEqual）、创建/校验/吊销 session、IP 登录失败锁定（内存）、当前用户解析。
- [x] `Add`：`AuthController`（`api/auth`，与既有 B站扫码控制器共存，全路径不冲突）——`POST /api/auth/login`（校验+锁定+置 HttpOnly cookie）、`POST /api/auth/logout`（吊销+清 cookie）、`GET /api/auth/me`（返回当前用户或 401）。登录失败返回**通用错误**（不区分用户名不存在/密码错，抗枚举）。
- [x] `Add`（GAP4 cookie 解析）：项目未装 `cookie-parser` 且 `main.ts` 未注册（`main.ts:15-27`）。**采用手动解析 `Cookie` 请求头**读取 `bdl_session`（无新依赖）；写 cookie 用 Express `res.cookie(name,token,{httpOnly:true,sameSite:'lax',secure:生产,path:'/',maxAge})`；登出 `res.clearCookie`。session 设 `expires_at`，校验时判过期，登录/定期 `purgeExpired`。
- [x] `Proof`：`typecheck`、`build`。
- [x] `Note`（实施记录）：落 `src/user-auth/`——`auth.constants.ts`（cookie 名 `bdl_session`、角色、AuthUser）、`cookie.util.ts`（手动解析 Cookie 头，无新依赖）、`auth.service.ts`、`user-auth.controller.ts`。锁定参数经 env 可调（`LOGIN_MAX_FAILURES`=5、`LOGIN_FAILURE_WINDOW_MINUTES`=15、`LOGIN_BLOCK_MINUTES`=15）；会话 TTL `SESSION_TTL_HOURS`=168。用户名不存在时对哑哈希做等价校验以抹平时序差异。

Exit Criteria:
- [x] 登录/登出/me 可用；session 可吊销；token 仅存 hash；同 IP 多次失败被临时封禁。
- [x] `docs/logs/` 记录。

### Stage 3 - 守卫与权限落位（后端门禁）

Status: done
Targets: `AuthGuard`/`RolesGuard`、装饰器、各控制器
- Item Types: `Add | Fix`
- Prereqs: Stage 2
- [x] `Add`：`AuthGuard`（解析 session cookie → request.user，失败 401）、`RolesGuard`+`@Roles('admin')`/`@Public()`（越权 403）。
- [x] `Add`（默认拒绝）：注册 `APP_GUARD` 全局守卫，**fail-closed**（默认需登录；`@Public()` 显式放行，`@Roles('admin')` 限管理）。
- [x] `Fix`（完整守卫映射，按 live 路由逐一）：
  - **公开 `@Public()`**：新用户 auth `POST /api/auth/login`、`POST /api/auth/logout`、`GET /api/auth/me`。
  - **admin-only**：
    - B站扫码登录 `auth.controller`：`GET /api/auth/qrcode`、`/qrcode/status`（写 cookie 文件）、`/user`。
    - download：`GET /download/config`、`POST /download`、`/tasks/:id/stop`、`/tasks/:id/resume`、`/tasks/:id/auto-summary`、`DELETE /tasks/:id`、`GET /tasks`、`GET /tasks/:id`、`POST /tasks/clear`、`POST /tasks/check`。
    - analysis：`POST /api/analysis/run`、`/trigger`、`GET/PUT /config`、`/config/test`。
    - analysis-task：`POST /tasks/:id/summary`、`/summary-tasks/integrity-check`(+`/status`)、`GET /summary-tasks`、`/summary-tasks/:id/raw-response`、`/summary-tasks/:id/markdown`、`DELETE /summary-tasks/:id`、`/summary-tasks/:id/retrigger`、`/summary-tasks/:id/rebuild`。
    - prompt：`api/analysis/prompts` 全部 CRUD。
    - worker：`GET /api/worker-jobs`、`GET /:id`、`POST /:id/cancel`。
    - video：`GET /api/video/info`、`/cover`、`POST /parse`、`/parse-all`。
    - parse：`POST /api/parse-link`、`GET /user-space/videos`、`/ugc-season/videos`、`/favorites/videos`。
    - knowledge：`GET /api/knowledge/search`（内部/管理检索；QA 走 chat 服务端调用，不经此公开端点）。
  - **user 可用（登录即可，method 级覆盖）**：
    - chat/QA：`POST /api/chat/conversations`、`GET /conversations`、`GET /conversations/:id/messages`、`POST /conversations/:id/photos`、`POST /conversations/:id/messages`、`DELETE /conversations/:id`——均**按 user_id 过滤 + 归属校验**；他人会话统一返回 **404**（抗 ID 枚举），不用 403。
    - AI 总结整页：**仅** `GET /api/summary-tasks/by-resource/:bvid/:cid/markdown`（`analysis-task.controller.ts:179`）对 user 开放；同类 `/:id/markdown`、`/:id/raw-response` 仍 admin。因该控制器为 `@Controller("api")` 混合 admin 路由，**须 method 级 `@Roles`/`@Public`+登录校验覆盖**，不可控制器级放行。
  - 未登录 401、越权 403。
- [x] `Fix`：`createConversation`/`listConversations`/`getConversation`（`database.service.ts:1877,1888-1902`）增 `userId` 参数与归属过滤；chat 控制器传入当前用户。
- [x] `Proof`：`typecheck`、`build`。
- [x] `Note`（实施偏差，**更严**）：守卫默认角色取 **admin**（而非仅"需登录"）。效果上与计划逐条映射一致（枚举的 download/analysis/analysis-task/prompt/worker/video/parse/knowledge/B站扫码 全为 admin-only），但对**将来新增端点 fail-closed**：未显式 `@Roles` 的新路由默认仅 admin，避免漏配即开放。仅 `@Public()`（login/logout/me）与 `@Roles(ROLE_ADMIN, ROLE_USER)`（chat/QA 全部 + 仅 `by-resource/:bvid/:cid/markdown`）显式放开；因此无需逐个 admin 控制器加装饰器。
- [x] `Note`：QA 会话对 **admin 亦按本人过滤**（`listConversations(user.id)`），符合"会话隔离"业务规则；存量会话已回填归 admin，admin 仍可见历史会话。他人/不存在会话统一 404。
- [x] `Note`（联动影响）：本阶段起全部 API 需登录，前端登录页在 Stage 5 落地；其间 UI 会收到 401，属预期的分阶段顺序。

Exit Criteria:
- [x] 未登录 401、越权 403；user 仅能访问自己会话；admin 全通；总结整页对 user 开放。
- [x] `docs/logs/` 记录。

### Stage 4 - admin 用户管理接口

Status: planned
Targets: `AuthController`/新增 users 控制器
- Item Types: `Add`
- Prereqs: Stage 2-3
- [ ] `Add`：admin 专用 `POST /api/users`（创建，指定 username/role/初始密码）、`GET /api/users`（列表）、`POST /api/users/:id/disable`（禁用→吊销其 session）。
- [ ] `Proof`：`typecheck`、`build`。
Exit Criteria:
- [ ] admin 可创建/列出/禁用用户；禁用即吊销会话；非 admin 403。
- [ ] `docs/logs/` 记录。

### Stage 5 - 前端登录与会话态

Status: planned
Targets: `packages/frontend`（登录页、会话态、路由守卫、admin-only UI、401 跳登录）
- Item Types: `Add | Fix`
- Prereqs: Stage 2-4
- [ ] `Add/Fix`：登录页；应用启动查 `/api/auth/me` 建会话态；未登录跳登录；管理类页面/操作仅 admin 可见；user 仅见 QA + 总结整页；401 拦截跳登录；登出。
- [ ] `Proof`：frontend `typecheck`、`build`。
Exit Criteria:
- [ ] 登录/登出/会话态可用；admin/user 可见性正确；401 跳登录。
- [ ] `docs/logs/` 记录。

### Stage 6 - 测试、文档与闭合

Status: planned
Targets: `packages/server/tests/*`、owner docs、`docs/logs/`
- Item Types: `Add | Fix | Proof`
- Prereqs: Stage 1-5
- [ ] `Add`：数据层/纯函数测试——scrypt hash/verify、session 创建/吊销/过期、锁定计数、conversation 按 user 过滤与归属、admin 播种幂等、存量回填。
- [ ] `Fix`：owner docs（app-overview 用户角色/权限矩阵/接口、system-baseline auth 形态）+ backlog 标 done。
- [ ] `Proof`：server `typecheck`/`build`/`test`、frontend `typecheck`/`build`；**独立子代理 closure 评审（不得 cold-replay 代替）**。
Exit Criteria:
- [ ] AC 逐条被测试或人工核对；testing 每条方向确认或裁决；owner docs 一致；closure 独立评审通过。

## Plan Audit

- Status: passed（with required fixes applied）
- Reviewer / Agent: 独立子代理评审（General，fresh-eyes；auth 保护区，非 cold-replay）
- Evidence: 2026-09-30 独立子代理评审，Verdict=PASS-WITH-REQUIRED-FIXES，对照 live 路由与安全实践。已并入：更正 B站 cookie 实为服务端 `.cookies.json` 文件（非 app_settings、非浏览器 cookie，隔离天然成立）；补 verifySchemaTables 哨兵表/列（user/user_session/conversation.user_id）；补 cookie 解析（手动 Cookie 头，无新依赖）+ session 过期/清理 + 登出清 cookie；**完整守卫映射**（默认拒绝 APP_GUARD；逐一列明 download/analysis/analysis-task/prompt/worker/video/parse/knowledge 全路由 admin-only、chat/QA 登录+归属过滤、仅 by-resource markdown 对 user 开放且 method 级覆盖）；B站扫码登录端点归 admin（与新 login/logout/me 区分）；会话越权统一 404 抗枚举；登录通用错误抗用户名枚举；createConversation/list/get 增 userId 归属。

## Closure Gates

- [ ] in-scope behavior complete（Stage 1-5）
- [ ] relevant docs aligned（app-overview / system-baseline / backlog / log）
- [ ] verification has run（server typecheck/build/test、frontend typecheck/build）
- [ ] `docs/testing/` 存在且每条方向确认或裁决
- [ ] no in-scope item downgraded
- [ ] plan audit passed（**独立子代理评审**）before implementation
- [ ] micro-plan exception not applicable（auth 保护区 + 数据模型 + 跨端）
- [ ] text consistency verified
- [ ] closure audit independent（**子代理评审，不得 cold-replay 代替**）
- [ ] 安全项核对：无默认密码、token 仅存 hash、HttpOnly cookie 隔离、无明文日志、登录锁定生效

## Deferred But Adjudicated

### NAS↔云服务身份最小权限 DB 角色
- Classification: `deploy-stage item`
- Why Not Blocking: 属 Phase 3 部署（保护区），本需求实现应用层 auth；DB 角色随部署阶段人工批准落地。
- Successor Required: `yes`（Phase 3 Stage D）

## Closure

Status Note: 待实施后回填。

Closure Audit Evidence:
- Reviewer / Agent: 待回填
- Evidence: 待回填
