# 2026-09-30 小用户系统与写操作鉴权（auth）

> Plan Status: done
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

Status: done
Targets: `AuthController`/新增 users 控制器
- Item Types: `Add`
- Prereqs: Stage 2-3
- [x] `Add`：admin 专用 `POST /api/users`（创建，指定 username/role/初始密码）、`GET /api/users`（列表）、`POST /api/users/:id/disable`（禁用→吊销其 session）。
- [x] `Proof`：`typecheck`、`build`。
- [x] `Note`（实施记录）：`users.controller.ts`（`api/users`，无 `@Roles` → 默认仅 admin）。校验：用户名 3-32 位 `[A-Za-z0-9._-]`、密码 8-200 位、角色仅 admin/user；重复用户名 409。响应视图恒不含 `password_hash`。
- [x] `Note`（防锁死，**超出计划的安全加固**）：禁用接口拒绝"禁用自己"与"禁用最后一个可用 admin"（均 403），避免把系统锁死；禁用为幂等（已禁用再调仅吊销会话）。

Exit Criteria:
- [x] admin 可创建/列出/禁用用户；禁用即吊销会话；非 admin 403。
- [x] `docs/logs/` 记录。

### Stage 5 - 前端登录与会话态

Status: done
Targets: `packages/frontend`（登录页、会话态、路由守卫、admin-only UI、401 跳登录）
- Item Types: `Add | Fix`
- Prereqs: Stage 2-4
- [x] `Add/Fix`：登录页；应用启动查 `/api/auth/me` 建会话态；未登录跳登录；管理类页面/操作仅 admin 可见；user 仅见 QA + 总结整页；401 拦截跳登录；登出。
- [x] `Proof`：frontend `typecheck`、`build`。
- [x] `Note`（命名隔离）：登录页落 `/sign-in` + `pages/SignIn.tsx` + `stores/session.ts`，因 `/login` + `stores/auth.ts` 已被 **B站扫码登录**占用；两套会话态互不干扰。
- [x] `Note`（401 拦截实现）：`api/index.ts` 的 `request()` 统一带 `credentials: "include"`，遇 401 广播 `bdl:unauthorized`（`appMe` boot 探测用 `silentUnauthorized` 抑制）；`stores/session.ts` 监听该事件置 anonymous，App 据此跳登录页——避免在每个调用点重复处理。
- [x] `Note`（可见性实现）：`NAV_ITEMS` 加 `adminOnly` 标记做导航过滤；App 内再做**路径级门禁**（非 admin 仅 `/qa` 与 `/summary/:bvid/:cid`，其余重定向 `/qa`），即直接输入 URL 也拦得住；B站账号区块仅 admin 可见。
- [x] `Note`（超出计划的补齐）：新增 `pages/AppUsers.tsx`（`/users`，admin-only）承接 Stage 4 的用户管理接口——需求 `docs/requirements/2026-09-17-user-auth.md:32` 将“用户管理”列为 admin 能力，若无 UI 则只能靠 curl 建用户，普通用户实际无法被创建。
Exit Criteria:
- [x] 登录/登出/会话态可用；admin/user 可见性正确；401 跳登录。
- [x] `docs/logs/` 记录。

### Stage 6 - 测试、文档与闭合

Status: done
Targets: `packages/server/tests/*`、owner docs、`docs/logs/`
- Item Types: `Add | Fix | Proof`
- Prereqs: Stage 1-5
- [x] `Add`：数据层/纯函数测试——scrypt hash/verify、session 创建/吊销/过期、锁定计数、conversation 按 user 过滤与归属、admin 播种幂等、存量回填。
- [x] `Fix`：owner docs（app-overview 用户角色/权限矩阵/接口、system-baseline auth 形态）+ backlog 标 done（并补 codebase-map、feature-inventory、project-context）。
- [x] `Proof`：server `typecheck`/`build`/`test`、frontend `typecheck`/`build`；**独立子代理 closure 评审（不得 cold-replay 代替）**。
- [x] `Fix`（closure 评审 B1，部署接线）：`docker-compose.yml` 透传 `ADMIN_INITIAL_PASSWORD` / `SESSION_COOKIE_SECURE` / `SESSION_TTL_HOURS` / `LOGIN_*`，`.env.example` 写明「首次部署必填 `ADMIN_INITIAL_PASSWORD`，否则无人可登录」；cookie 的 Secure 从 `NODE_ENV === "production"`（本仓从不设置该变量，且早有"不以 NODE_ENV 作生产判据"的裁决）改为**显式开关** `SESSION_COOKIE_SECURE`。
- [x] `Fix`（closure 评审 B2，文档口径）：修正 `project-context.md` 中先于评审写下的"已过 closure 评审"表述，改为如实记录评审结论与遗留项。
- [x] `Fix`（closure 评审 S1/S2/S5/S6）：`requestRaw` 与 `request` 共用 401 处理并补 `credentials: "include"`（此前普通 user 的建会话/传照片/删会话三条路径不会跳登录）；登录失败计数表超上限惰性清扫；解析到过期会话时顺带清理；登录口令超长直接按凭据无效（限制公开端点的 scrypt 放大）。
Exit Criteria:
- [x] AC 逐条被测试或人工核对；testing 每条方向确认或裁决；owner docs 一致；closure 独立评审通过。


## Plan Audit

- Status: passed（with required fixes applied）
- Reviewer / Agent: 独立子代理评审（General，fresh-eyes；auth 保护区，非 cold-replay）
- Evidence: 2026-09-30 独立子代理评审，Verdict=PASS-WITH-REQUIRED-FIXES，对照 live 路由与安全实践。已并入：更正 B站 cookie 实为服务端 `.cookies.json` 文件（非 app_settings、非浏览器 cookie，隔离天然成立）；补 verifySchemaTables 哨兵表/列（user/user_session/conversation.user_id）；补 cookie 解析（手动 Cookie 头，无新依赖）+ session 过期/清理 + 登出清 cookie；**完整守卫映射**（默认拒绝 APP_GUARD；逐一列明 download/analysis/analysis-task/prompt/worker/video/parse/knowledge 全路由 admin-only、chat/QA 登录+归属过滤、仅 by-resource markdown 对 user 开放且 method 级覆盖）；B站扫码登录端点归 admin（与新 login/logout/me 区分）；会话越权统一 404 抗枚举；登录通用错误抗用户名枚举；createConversation/list/get 增 userId 归属。

## Closure Gates

- [x] in-scope behavior complete（Stage 1-5）
- [x] relevant docs aligned（app-overview / system-baseline / backlog / log；另补 codebase-map / feature-inventory / project-context）
- [x] verification has run（server typecheck/build/test、frontend typecheck/build）
- [x] `docs/testing/` 存在且每条方向确认或裁决
- [x] no in-scope item downgraded
- [x] plan audit passed（**独立子代理评审**）before implementation
- [x] micro-plan exception not applicable（auth 保护区 + 数据模型 + 跨端）
- [x] text consistency verified
- [x] closure audit independent（**子代理评审，不得 cold-replay 代替**）
- [x] 安全项核对：无默认密码、token 仅存 hash、HttpOnly cookie 隔离、无明文日志、登录锁定生效


## Deferred But Adjudicated

### NAS↔云服务身份最小权限 DB 角色
- Classification: `deploy-stage item`
- Why Not Blocking: 属 Phase 3 部署（保护区），本需求实现应用层 auth；DB 角色随部署阶段人工批准落地。
- Successor Required: `yes`（Phase 3 Stage D）

### 反向代理后登录封禁粒度塌缩为全局
- Classification: `deploy-stage risk`（closure 评审 S3）
- Why Not Blocking: 当前不经反代、直连 3000 端口，`req.ip` 即真实客户端；Express `trust proxy` 未开启使 `X-Forwarded-For` 无法伪造，是本阶段的正确取舍。
- Why It Must Be Revisited: 公网暴露必然走反代，届时所有客户端共享同一 `req.ip`，任意人连续失败即封禁全体登录（零成本 DoS）。需在 Phase 3 裁决：配置 `trust proxy` + 取可信跳，或改为「用户名+IP」组合计数并对全局封禁设上限。
- Successor Required: `yes`（Phase 3 Stage D）

### 迁移产物不入库，存量库迁移未获证明
- Classification: `deploy-stage item`（closure 评审 S4）
- Why Not Blocking: schema 真源是 contract + emit；本需求的 14 项改动全部 additive，fresh `db init` 已验证。
- Why It Must Be Revisited: `packages/server/migrations/` 被 .gitignore 排除，仓库内无可复现迁移脚本；而新增哨兵会让未迁移的存量库**启动直接失败**。Phase 3 部署清单须写明「先对存量库执行 `db migrate` 再滚镜像」，并重新评估 migrations 目录是否入库。
- Successor Required: `yes`（Phase 3 Stage D）

## Closure

Status Note: Stage 1-6 全部完成。数据模型 additive 落地 + admin 幂等播种与存量回填；登录/登出/me + 可吊销会话 + IP 锁定；全局 `APP_GUARD` fail-closed（默认仅 admin，仅 chat/QA 与 `by-resource` markdown 对 user 放开）；admin 用户管理接口与页面；前端 `/sign-in` + 会话态 + 角色可见性 + 路径级门禁 + 401 跳登录。验证：全仓 `typecheck`/`build` 绿，server **28 files / 216 tests** 全绿，frontend `typecheck`/`build` 绿。commit：`e317ae0`→`5646b5c` + 本次闭合提交。遗留项见上方 Deferred（均指向 Phase 3 Stage D），运行级人工确认清单见 testing 文档。

Closure Audit Evidence:
- Reviewer / Agent: 独立子代理评审（General，fresh-eyes；auth 保护区，**非 cold-replay**）
- Evidence: 2026-09-30，Verdict=**PASS-WITH-FIXES**。评审自行枚举全仓 12 个 `@Controller` / 61 个路由方法，确认仅 3 处 `@Public()`（login/logout/me）与 2 处 `@Roles(admin,user)`（chat 类级、`by-resource/:bvid/:cid/markdown` 方法级），其余 51 路由按 fail-closed 默认即 admin-only，无未覆盖或过度放开端点；确认无 SSE/流式端点、`main.ts` 无全局前缀/CORS/额外中间件、静态资源直出是必需且仅含前端产物；确认全局请求日志为白名单制（`password`/`token` 不在 `SAFE_LOG_KEYS`），口令与 token 不落日志/返回体；确认 QA 六条路径全部先过归属校验、`user_id` 为 NULL 的存量行亦拒绝（fail-closed）；确认 `trust proxy` 未开启使 `X-Forwarded-For` 无法伪造。评审并实跑验证命令复核测试与构建结果。
  - Blockers 已修：**B1** 部署路径未接线（compose/.env.example 无任何 auth 变量 → 新镜像上线后无账号可登录；`secure` 依赖仓内从不设置的 `NODE_ENV` → Secure 恒 false）；**B2** `project-context.md` 先于评审写下"已过 closure 评审"（违反 ai-autonomy-policy「不得以 AI 自撰文档清除门禁」）。
  - Should-fix 已修：**S1** `requestRaw` 绕过 401 广播与 `credentials`；**S2** 失败计数表无界增长；**S5** 过期会话清理只挂在登录路径；**S6** 登录口令长度无上限。
  - Should-fix 转 Deferred（Phase 3 Stage D）：**S3** 反代后封禁粒度塌缩；**S4** 迁移产物不入库。

