# 需求复审 — 云端/NAS 主需求与 Phase 1a（2026-09-17，第二轮）

## 1. 对象与方式

- 对象：
  - `docs/discussions/2026-09-17-cloud-nas-responsibility-split.md`（主需求，Q1–Q16 定稿后）
  - `docs/requirements/2026-09-17-cloud-read-path-db-render.md`（Phase 1a）
- 方式：两次独立子代理审计（Pass A 主需求复审；Pass B Phase 1a 审计），关键事实经主执行者用 live repo 复核。
- 前置：第一轮审计 `docs/audits/2026-09-17-document-audit-cloud-nas-responsibility-split.md`。

## 2. 主需求：第一轮发现处置

第一轮 5 项 Blocker（B1–B5）在技术事实上**均已消解**（渲染兜底、向量失效、段↔截图映射、OpenAI SDK 取代原生格式、`completed` 重定义）；新段落的关键 `file:line` 绝大多数属实。仍开放的：H2（api 角色禁止装配哪些模块未枚举）、H3（完整性检查取哪条 task）、H5（半成功恢复/rollback）、COS URL 安全方案、目录定位与 backlog 登记。

## 3. 主需求：复审新发现（已修正）

### Blocker（内部矛盾）

- **OOS 与用户系统互斥**：Out Of Scope 原写"账号体系 / 多用户 / 支付"，与 Roles/Permissions 引入小用户系统冲突 → 已改为"公开注册 / 第三方 OAuth / 支付（本期仅引入受控小用户系统）"。
- **OOS「行为不变」与多处语义变更冲突**：已改为枚举有意变更（截图源优先级、`completed` 定义、删除/重总结级联、完整性判据、Cookie 真源迁移）。
- **回填「已跳过」与 In Scope/Edge/Q9 正文冲突**：已删除 Phase 1 的 backfill 项、改写 Edge 行与 Q9（标记用户已手动完成、本期不再实施）。

### High（命名/语义）

- **job kind 三处不一致**：已统一以 Q3 为唯一真源（`download / low_res_download / analyze / retrigger / screenshot_retry / integrity_check / cos_cleanup`），In Scope Phase 2 改为引用 Q3。
- **云端 LLM 客户端二选一未定**：已统一为"新增 `openai` SDK；`QwenClient` 仅 NAS 经代理"（删除 Phase 3/API 的"`QwenClient` 双模式"）。
- **`rebuild` 与「重总结」混用**：已拆为「重试截图（原 rebuild）」与「重总结（retrigger，原地 upsert）」两条流程，API Impact 同步。
- **`/summary-files` 删除时机**：In Scope 已拆为 Phase 1a（保留挂载）/ Phase 1b（删除），与 Phase 1a 需求一致。
- **远端截图**：统一为"降级保留为最后兜底"。
- **`completed` 置位时序**：Main Flow 已改为"先写 segments 并置 completed；截图上传独立、可重试"。

### 事实错误（已修正）

- Testing 段日志路径 `docs/server/src/logging/` → `packages/server/src/logging/`。
- Data/Model 关于 parse 支持范围：原文称"仅实现 video/user-space/ugc-season/favorites"有误，实际 **6 类全实现**（含 bangumi / cheese，见各 matcher 与 `resource-parser.ts`）→ 已更正，并说明 `resource_type` 对非 video 资源有实际意义。
- Q12"兼容基址未知"：该基址已在 `docs/discussions/2026-08-18-proxy-auth-from-db.md` 记录为 `.../compatible-mode/v1` → 已引用。

### 欠定义决策（已收敛或标注）

- Q11：会话机制定为**服务端 session（HttpOnly Cookie）**；admin 环境变量缺失时"告警且不创建默认密码"；用户来源定为 admin 创建/邀请。
- Q15：Cookie 载体定为 **`app_settings`**（删除 `bili_auth` 二选一）。
- Q3：字段清单改为"已确认"，补索引/约束与终态保留期说明。
- Q5/H3：补"取该资源已完成下载任务（`findCompletedTaskByBvidAndCid`），多任务优先取文件存在者"。
- Owner-Doc Deltas：补 `app-overview.md:20-22`（角色）、`:105`（503 语义）、`:12`（Docker），以及 `packages/docker/*` 两镜像改动。
- API Impact：补下线 `POST /api/summary-tasks/:id/publish`、`POST/GET /api/knowledge/backfill`。
- 验收标准：修正"多模态 URL 直连"→"OpenAI Node SDK 直连"、`/summary-files` 标注 Phase 1b、补 Phase 1a 以子需求为准。

### 仍开放（未在本轮修正）

- **H2**：**已由用户裁决"拆成两个独立 NestJS 项目"解决**——`cloud-server` 物理上不含 ffmpeg / analysis 执行 / vision-proxy 代码；包边界见主需求 `Target Package Layout` 与 Q6。原"角色→路由白名单"不再需要。
- **H5**：迁移/回填的半成功恢复与 rollback 未写（回填已手动完成，风险降低）。
- **COS 公网/签名 URL 的可达性与安全**：**已澄清（用户）**——COS 公网可读是既有设计，截图 URL 为公网直链，无签名过期问题，不构成风险项。
- **目录定位与 backlog 登记**：**已解决（方案 3）**——主需求移入 `docs/discussions/2026-09-17-cloud-nas-responsibility-split.md`，Phase 1a 留 `docs/requirements/` 并登记 `docs/backlog/README.md`。

## 4. Phase 1a：审计发现（已修正）

- **渲染规格缺失**：已补 Rendering Spec（复用 `generateMarkdown` + `extractSummaryMeta`、正文模板、图片用 COS URL、**不渲染 timestamp**、按 `seq` 排序）。
- **`generateMarkdown` 入参不是 raw_response**：已明确新增纯函数 `renderRawResponseMarkdown` 做 JSON→`DocumentInput` 映射。
- **meta 取值链不精确**：已明确 `videoUrl` 由 bvid 合成、`model` 兜底、`createdAt` 取 `last_completed_at`/`created_at`（不用 `summary.created_at`）。
- **无既有读取方法**：已在 Data/Model 明确新增 `getSummaryWithSegmentsByResource` 只读方法（无 schema 变更）。
- **错误码变化未定**：已定 file-missing 404 移除、`summary_output` 空不再单独 409、内容不可用统一 409，并写入 AC。
- **未发布记录丢图回归**：已在 Edge/Business Rules 记录为有意行为（图片缺失可重试），并要求 owner doc 更新。
- **测试不可落地**：已改为"DB 读取方法数据层测试 + 渲染纯函数单测（fs spy 断言不读盘）"，不新增 controller E2E。
- **Edge 缺口**：已补空 summary 数组、summary/raw 漂移、null frameDescription/screenshot_url、seq 排序。
- **Goal 用词**：已从"无 NAS 文件系统的部署"改为"读取侧不再依赖本地文件"，避免部署语义歧义。

## 5. 裁决

- **主需求**：`with revisions` 中已修正项完成后，仍不宜作为单一计划；Phase 1b/2/3/4 各自另立需求。剩余 H2/H5/COS 安全/目录登记为已知非阻塞项。
- **Phase 1a**：`with revisions` 已完成修正，**可转计划**（非保护区，plan audit 可用 cold-replay）。
