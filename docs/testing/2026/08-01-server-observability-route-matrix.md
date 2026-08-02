# Server Observability Route Matrix

> 对应 plan: `docs/plans/2026-08-01-server-observability-logging-plan.md`
> 用途: durable route-coverage evidence for server logging implementation and closure

## Status Legend

- `pending` — 尚未验证
- `covered` — 已完成请求级与计划要求的分支级验证
- `covered-user-adjudication` — AI 已完成路由回放与代码侧证明，剩余环境依赖型成功判断交由用户裁定
- `blocked-protected` — 受保护区域，当前计划只盘点不实施

## Route Matrix

| Method | Path | Controller | Complexity | Policy Status | Verification Status | Evidence |
| ------ | ---- | ---------- | ---------- | ------------- | ------------------- | -------- |
| GET | /api/download/config | DownloadController | low | in-scope | covered | 2026-08-02: `:3001` 200 success；全局 request started/completed 日志已观察 |
| POST | /api/download | DownloadController | high | in-scope | covered | 2026-08-02: `:3001` 400 缺少 outputPath；` :3001 / :3000` 201 创建成功 |
| POST | /api/tasks/:id/stop | DownloadController | medium | in-scope | covered | 2026-08-02: `:3000` invalid id；`:3001` 201 stop success |
| POST | /api/tasks/:id/resume | DownloadController | medium | in-scope | covered | 2026-08-02: `:3000` invalid id；`:3001` 201 resume success |
| POST | /api/tasks/:id/auto-summary | DownloadController | medium | in-scope | covered | 2026-08-02: `:3001` 400 缺少 enabled、400 task-not-found、201 enable success |
| DELETE | /api/tasks/:id | DownloadController | medium | in-scope | covered | 2026-08-02: `:3000` invalid id；`:3001` 200 delete success |
| GET | /api/tasks | DownloadController | low | in-scope | covered | 2026-08-02: `:3001` 200 列表成功 |
| GET | /api/tasks/:id | DownloadController | low | in-scope | covered | 2026-08-02: `:3000` invalid id；`:3001` 200 success + 200 task-not-found |
| POST | /api/tasks/clear | DownloadController | medium | in-scope | covered | 2026-08-02: `:3000 / :3001` 201 success；analysis_sub_task FK 清理修复后复测通过 |
| POST | /api/tasks/check | DownloadController | medium | in-scope | covered | 2026-08-02: `:3000` empty-items warn；`:3001` 201 实际查询成功 |
| POST | /api/analysis/run | AnalysisController | high | in-scope | covered-user-adjudication | 2026-08-02: 400 invalid absolute-path 校验已回放；真实成功路径交由用户按实际 LLM 环境裁定 |
| POST | /api/analysis/trigger | AnalysisController | high | in-scope | covered | 2026-08-02: 400 invalid body、409 already-enabled、`:3001` 201 existing-task enable、`:3000` 201 create branch + low-res/empty-summary chain |
| POST | /api/parse-link | ParseController | medium | in-scope | covered | 2026-08-02: 400 empty input；201 video BV parse；201 user-space parse；`/upload/video` 变体返回 400，支持范围交由用户裁定 |
| GET | /api/user-space/videos | ParseController | medium | in-scope | covered | 2026-08-02: 400 invalid mid；200 success (`mid=316568752`) |
| GET | /api/ugc-season/videos | ParseController | medium | in-scope | covered | 2026-08-02: 400 invalid seasonId；200 success (`seasonId=1272286`) |
| GET | /api/favorites/videos | ParseController | medium | in-scope | covered | 2026-08-02: 400 invalid mediaId；200 success (`mediaId=1329019876`) |
| GET | /api/auth/qrcode | AuthController | medium | protected-auth | blocked-protected | blocked under `docs/context/ai-autonomy-policy.md` |
| GET | /api/auth/qrcode/status | AuthController | medium | protected-auth | blocked-protected | blocked under `docs/context/ai-autonomy-policy.md` |
| GET | /api/auth/user | AuthController | medium | protected-auth | blocked-protected | blocked under `docs/context/ai-autonomy-policy.md` |
| GET | /api/video/info | VideoController | low | in-scope | covered | 2026-08-02: 200 missing-input error body；200 BV success |
| GET | /api/video/cover | VideoController | medium | in-scope | covered | 2026-08-02: 400 missing url；200 JPEG proxy success |
| POST | /api/video/parse | VideoController | medium | in-scope | covered | 2026-08-02: 201 missing cid error body；201 real `bvid/cid` success |
| POST | /api/video/parse-all | VideoController | medium | in-scope | covered | 2026-08-02: 201 missing cids error body；201 real `bvid + cids` success |

## Notes

- This matrix inventories all 23 current server endpoints.
- Only the 20 non-protected endpoints are executable scope for `2026-08-01-server-observability-logging-plan` under the current autonomy policy.
- Auth endpoints remain visible here so closure cannot silently ignore them; they require explicit successor ownership or protected-area review before implementation.
- `covered-user-adjudication` is used only where the route replay and code-path observability are closed by AI work, but the remaining environment-dependent success judgment has been explicitly handed to the user.