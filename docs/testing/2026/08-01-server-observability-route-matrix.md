# Server Observability Route Matrix

> 对应 plan: `docs/plans/2026-08-01-server-observability-logging-plan.md`
> 用途: durable route-coverage evidence for server logging implementation and closure

## Status Legend

- `pending` — 尚未验证
- `covered` — 已完成请求级与计划要求的分支级验证
- `blocked-protected` — 受保护区域，当前计划只盘点不实施

## Route Matrix

| Method | Path | Controller | Complexity | Policy Status | Verification Status | Evidence |
| ------ | ---- | ---------- | ---------- | ------------- | ------------------- | -------- |
| GET | /api/download/config | DownloadController | low | in-scope | pending | pending |
| POST | /api/download | DownloadController | high | in-scope | pending | pending |
| POST | /api/tasks/:id/stop | DownloadController | medium | in-scope | pending | pending |
| POST | /api/tasks/:id/resume | DownloadController | medium | in-scope | pending | pending |
| POST | /api/tasks/:id/auto-summary | DownloadController | medium | in-scope | pending | pending |
| DELETE | /api/tasks/:id | DownloadController | medium | in-scope | pending | pending |
| GET | /api/tasks | DownloadController | low | in-scope | pending | pending |
| GET | /api/tasks/:id | DownloadController | low | in-scope | pending | pending |
| POST | /api/tasks/clear | DownloadController | medium | in-scope | pending | pending |
| POST | /api/tasks/check | DownloadController | medium | in-scope | pending | pending |
| POST | /api/analysis/run | AnalysisController | high | in-scope | pending | pending |
| POST | /api/analysis/trigger | AnalysisController | high | in-scope | pending | pending |
| POST | /api/parse-link | ParseController | medium | in-scope | pending | pending |
| GET | /api/user-space/videos | ParseController | medium | in-scope | pending | pending |
| GET | /api/ugc-season/videos | ParseController | medium | in-scope | pending | pending |
| GET | /api/favorites/videos | ParseController | medium | in-scope | pending | pending |
| GET | /api/auth/qrcode | AuthController | medium | protected-auth | blocked-protected | blocked under `docs/context/ai-autonomy-policy.md` |
| GET | /api/auth/qrcode/status | AuthController | medium | protected-auth | blocked-protected | blocked under `docs/context/ai-autonomy-policy.md` |
| GET | /api/auth/user | AuthController | medium | protected-auth | blocked-protected | blocked under `docs/context/ai-autonomy-policy.md` |
| GET | /api/video/info | VideoController | low | in-scope | pending | pending |
| GET | /api/video/cover | VideoController | medium | in-scope | pending | pending |
| POST | /api/video/parse | VideoController | medium | in-scope | pending | pending |
| POST | /api/video/parse-all | VideoController | medium | in-scope | pending | pending |

## Notes

- This matrix inventories all 23 current server endpoints.
- Only the 20 non-protected endpoints are executable scope for `2026-08-01-server-observability-logging-plan` under the current autonomy policy.
- Auth endpoints remain visible here so closure cannot silently ignore them; they require explicit successor ownership or protected-area review before implementation.