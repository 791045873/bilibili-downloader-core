# Testing - AI 总结自定义提示词（2026-08-17）

需求：`docs/requirements/2026-08-17-ai-summary-custom-prompt.md`
计划：`docs/plans/2026-08-17-ai-summary-custom-prompt-plan.md`

## 验证方式

项目无单元测试设施，采用 typecheck/build + API/DB 冒烟验证（临时 OUTPUT_DIR + 一次性脚本，不入库）+ 人工运行级确认。冒烟沿用既有模式（`$TEMP/opencode/*/smoke.cjs` 一次性脚本）。

## 自动化验证结果（已填 2026-08-17）

- `pnpm typecheck`：通过（全 workspace）。
- `pnpm build`：通过（全 workspace）。
- API/DB 冒烟：一次性脚本（`$TEMP/opencode/prompt-smoke/smoke-prompt.cjs`，临时 OUTPUT_DIR 隔离，不入库）53 项全部通过。

### 冒烟逐项结果

| # | 方向 | 结果 |
| --- | --- | --- |
| 1 | 建表与播种 | PASS：空库启动后 `ai_prompt` 恰含 1 条内置（is_system=1, is_default=1, 内容与硬编码逐字一致）；`ai_prompt_creator` 空表存在。 |
| 2 | 迁移幂等 | PASS：同 DB 重启不重复播种、不报错。 |
| 3 | 提示词列表 | PASS：`GET /api/analysis/prompts` 返回内置（isSystem=true, isDefault=true）。 |
| 4 | 创建 | PASS：创建成功 201；name 空 → 400。 |
| 5 | 编辑 | PASS：自定义成功；内置 → 409；非法 id → 400；不存在 → 404。 |
| 6 | 删除 | PASS：自定义成功；内置 → 409；不存在 → 404。 |
| 7 | 设默认 | PASS：设为默认后该记录 isDefault=1、其他 false。 |
| 8 | 默认回落 | PASS：删除默认自定义后默认自动回到内置。 |
| 9 | 格式片段 | PASS：返回非空 snippet 且与服务端字符串一致。 |
| 10 | 创作者绑定 | PASS：绑定、查询、解绑、非法 mid 400、重复绑定覆盖、重复解绑幂等。 |
| 11 | task.prompt_id | PASS：`POST /api/download` 带 promptId 成功 201，task 表 prompt_id 写入。 |
| 12 | summary-task prompt_id | PASS：触发带 promptId → `ai_summary_task.prompt_id` 写入。 |
| 13 | 优先级 | PASS：显式生效；显式指向已删除 → 回落 task.prompt_id；task.prompt_id → 生效；task.prompt_id 已删除 → 系统默认；删除系统默认 → 默认回落内置。创作者绑定层（需 B 站 mid 解析）仅验证"解析失败跳过该层"路径，绑定命中路径依赖真实网络，属人工运行级确认。 |
| 14 | retrigger 复用 | PASS：按记录 prompt_id 复用（认领后 prompt_id 保持）。 |
| 15 | 错误码 | PASS：各端点非法 id 400 / 不存在 404 / 系统内置 409 均符合契约。 |
| 16 | `/analysis/run` 默认解析 | PASS：未传 promptId 时日志断言 systemPrompt 使用系统默认提示词内容（解析出的 promptId 与非空内容均记录）。 |

## API/DB 冒烟方向（临时 OUTPUT_DIR，隔离真实数据）

| # | 方向 | 通过标准 |
| --- | --- | --- |
| 1 | 建表与播种 | 空 OUTPUT_DIR 启动后 `ai_prompt` 恰含 1 条内置提示词（is_system=1, is_default=1, 内容与硬编码一致）；`ai_prompt_creator` 空表存在。 |
| 2 | 迁移幂等 | 同 DB 重启不重复播种、不报错。 |
| 3 | 提示词列表 | `GET /api/analysis/prompts` 返回内置提示词（isSystem=true, isDefault=true）。 |
| 4 | 创建 | `POST /api/analysis/prompts` 成功；name/content 空 → 400。 |
| 5 | 编辑 | `PUT` 自定义提示词成功；`PUT` 内置提示词 → 409；非法 id → 400；不存在 → 404。 |
| 6 | 删除 | `DELETE` 自定义提示词成功；`DELETE` 内置 → 409；不存在 → 404。 |
| 7 | 设默认 | `PUT /:id/default` 后该记录 isDefault=true、其他 false；旧默认同时被清除。 |
| 8 | 默认回落 | 设某自定义为默认后删除它 → 默认自动回到内置提示词。 |
| 9 | 格式片段 | `GET /api/analysis/prompts/format-snippet` 返回非空 snippet。 |
| 10 | 创作者绑定 | `PUT /api/analysis/prompts/creator` 绑定；`GET ?mid=` 返回绑定；`DELETE ?mid=` 解绑；重复绑定覆盖。 |
| 11 | task.prompt_id | `POST /api/download` 带 promptId → task 表 `prompt_id` 写入。 |
| 12 | summary-task prompt_id | 触发（`POST /api/tasks/:id/summary` 带 promptId）→ `ai_summary_task.prompt_id` 写入。 |
| 13 | 优先级 | 无显式/无 task/无绑定 → 用系统默认；有绑定 → 用绑定；显式 → 用显式；显式指向已删除提示词 → 回落下一层。 |
| 14 | retrigger 复用 | `POST /api/summary-tasks/:id/retrigger` 复用记录 prompt_id（认领后 prompt_id 保持）。 |
| 15 | 错误码 | 各端点非法 id 400 / 不存在 404 / 系统内置 409 均符合契约。 |
| 16 | `/analysis/run` 默认解析 | 未传 promptId 时 systemPrompt 使用系统默认提示词内容（冒烟可用日志断言 prompt 解析结果）。 |

## 人工运行级确认（留给用户）

- 前端"AI 提示词"页：新建/编辑/删除/设默认/一键插入格式片段；内置项只读（编辑/删除按钮禁用）。
- 下载任务页：对已完成任务点"立刻/重新 AI 总结"，弹窗默认选中系统默认（该视频创作者有绑定则选中绑定）；勾选"设为默认/应用到创作者"生效；确认后任务进入总结流程。
- 批量：解析结果列表勾选多个视频"加入待下载"，弹框中为该批选择提示词，确认后下载完成自动总结使用该提示词。
- 创作者绑定生效：某创作者视频手动选提示词并绑定后，该创作者新视频（未显式选择）自动用绑定提示词。
- 提示词不含格式片段时，分析结果可能非 JSON 而失败（预期行为，仅日志）。