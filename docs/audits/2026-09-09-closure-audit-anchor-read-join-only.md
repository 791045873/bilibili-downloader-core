# Closure Audit: 读侧路径锚点移除绝对值透传

日期: 2026-09-09
类型: closure audit（independent subagent）
对象: `docs/plans/2026-09-09-anchor-read-join-only-plan.md`
结论: **PASS**

## A. 冷回放：计划 Exit Criteria + Closure Gates 逐条核验

| 项 | 判定 | 证据 |
| --- | --- | --- |
| Exit: `/abc` 形态 DB 值读侧解析为 `join(DOWNLOAD_ROOT, "/abc")` | ✅ | `packages/server/src/paths/path-anchor.ts:52-60` 仅剩 `if (!value) return undefined;` + `return join(downloadRoot, value)`；透传分支（原 :57-59 `isAbsoluteAnchorPath` 命中返回原值）已删除；测试 `tests/paths/path-anchor.test.ts:43-48` 断言 `"/tmp/x.mp4"` → `join(root, "/tmp/x.mp4")`（= `root\tmp\x.mp4`，见 C 节实测） |
| Exit: 写侧相对化行为不变 | ✅ | diff 中 `toRelativeDownloadRootPath`（path-anchor.ts:22-41）与 `isAbsoluteAnchorPath`（:13-15）零改动；`tests/paths/path-anchor.test.ts` roundtrip 用例未动，随全量测试通过 |
| Exit: owner doc 与代码注释一致 | ✅ | app-overview.md:46/:74 新表述与实现语义一致；path-anchor.ts:1-9 头注释与 :47-51 函数注释、summary-dir.ts:29-31 注释均为"读侧恒 join，不透传绝对值" |
| Exit: `docs/logs/` 更新 | ✅ | `docs/logs/2026-09-09-anchor-read-join-only.md` 存在，内容与 diff 一致（含 P1 残余风险记录，plan audit P1 条件已落地） |
| Gate: in-scope complete / docs aligned / verification run / no downgrade / plan audit passed / text consistency / closure evidence | ✅ | 全部有文件证据；plan audit（pass-with-conditions）先于实现，M1（app-overview:74）与 m1/m2 条件均已并入计划与实现 |
| Gate: closure audit independent | ⏳ | 计划 :66 标注"进行中"——即本审计；报告落盘后可勾选 |

验证独立复跑（本审计环境）：`pnpm typecheck` ✅、`pnpm build` ✅（7 包全过）、`pnpm --filter @bilibili-downloader/server test` ✅（12 文件 / 87 用例全绿，与日志声称一致）。声称无夸大。

## B. Diff 范围核验（无越界改动）

`git status`：5 个已跟踪文件修改 + 3 个新文件（plan / plan audit / log），与声称完全一致，无杂散改动。逐文件核对：

- `packages/server/src/paths/path-anchor.ts`：仅头注释（:1-9）+ 函数注释（:47-51）+ 删除透传分支（:56-59）。写侧未动。
- `packages/server/src/analysis/summary-dir.ts`：仅 :30 注释一行。
- `tests/paths/path-anchor.test.ts`：仅 :43-48 用例改写。
- `tests/database/ai-summary-task.test.ts`：仅 :335-341 用例改写（含 `resolveSummaryOutputPath("", root)` 空值断言保留）。
- `docs/design/app-overview.md`：仅 :46、:74 两行。

## C. 测试断言 win32 语义 sanity check

用 node 独立实测 `node:path`（win32，root=`C:\base\downloads`）：

| 表达式 | 实测结果 | 与断言一致性 |
| --- | --- | --- |
| `join(root, "/tmp/x.mp4")` | `C:\base\downloads\tmp\x.mp4` | ✅ 不重置，join 语义正确（正是修复目标：`/abc` 类值拼到根下） |
| `join(root, join(root, "a.mp4"))` | `C:\base\downloads\C:\base\downloads\a.mp4` | ✅ 盘符段不重置，双 join 断言成立 |
| `join(root, "C:\\dl\\summary\\a.md")` | `C:\base\downloads\C:\dl\summary\a.md` | ✅ ai-summary-task.test.ts:338-340 新断言成立（不再透传返回原绝对值） |
| `join(root, "summary/a.md")` | `C:\base\downloads\summary\a.md` | ✅ 正常相对值归一化不受影响 |

注意：path-anchor.test.ts 的断言为 `expect(impl(...)).toBe(join(root, ...))` 形态，与实现表达式同构，属半同义反复；但它们锁定的正是"恒 join、无豁免"这一新语义（旧实现下 `"/tmp/x.mp4"` 用例会返回 `/tmp/x.mp4` 而失败），且上述实测独立确认了断言编码的行为。可接受。

## D. "透传"残留全量扫描

- `packages/server/src` + tests：仅 5 处命中，全部为"不再透传/不透传绝对值"的否定式新表述或测试名，无遗留肯定式"原样容错透传"。
- `docs/design/`：app-overview.md 剩余 4 处"透传"均与路径锚点无关——:69/:82 为 promptId 触发链路透传，:74 尾部"正文原样透传"指 markdown content 直出。无 stale 表述。
- `paths.service.ts` 头注释本为中性表述（plan audit m1 结论），未改亦无矛盾。

## E. 调用点安全 spot-check（全 10 处均 DB 值）

- download.service.ts:453 ← `findCompletedTaskByBvidAndCid`（:450，DB）✅
- analysis-trigger.service.ts:385 ← `effectiveTask.outputFile`（resolveTaskForAnalysis 全程 DB 取记录）✅
- analysis-video-resolver.ts:319 ← `finalRecord.outputFile`（:300 `getTaskById` DB 重取，:301 已校验非空，`?? rawOutputFile` 仅防御空值，join 后错误路径风险仅理论存在）✅
- summary-dir.ts:36 委托 + `?? value`：空字符串语义保留（测试 :341 验证 `""` → `""`）✅
- 其余（analysis-trigger :398/:592/:810、resolver :211、summary-repair :178/:187）与 plan audit 清单一致，均为 DB 记录字段，且消费前普遍有 fileExists 存在性检查兜底。

## 发现（严重度：M/m/F/P）

- 无 M/m/F 级发现。
- P1：path-anchor.test.ts join 断言与实现表达式同构（见 C 节），独立行为证据依赖本次审计的 node 实测；如后续增强，可改为硬编码期望值。不阻塞。
- P2：计划 :66 closure gate 待本报告落盘后勾选、:73 Closure Status Note 待补——属流程收尾动作，非缺陷。

## 结论

**PASS**：实现与计划 Exit Criteria 完全一致，diff 精确限定在计划范围，测试断言在 win32 join 语义下经独立实测成立，typecheck/build/87 用例验证独立复跑全绿，文档与注释无 stale "透传"表述，全部调用点输入为 DB 值。无 overclaim。
