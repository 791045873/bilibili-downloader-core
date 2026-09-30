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
- 状态：待实施后回填每条方向的通过/裁决结论。auth 保护区须经独立子代理评审（不得 cold-replay 代替）。
