# Closure Audit: AI 总结修复脚本改造为 API 接口

日期: 2026-09-08
类型: closure audit（independent subagent）
对象: `docs/plans/2026-09-08-summary-repair-api-plan.md` /
`packages/server/src/analysis/summary-repair.service.ts` /
`analysis-task.controller.ts` 新端点
结论: **pass-with-conditions**（2 项文档收尾已回填，见文末）

## 计划审计条件落地核验（4/4）

| 条件 | 结论 | 证据 |
| --- | --- | --- |
| 报告字段自洽 | ✅ | repaired 条目含 empty 布尔（summary-repair.service.ts:29-31,196）；无 repairedEmpty 残留 |
| controller 同步 await + 互斥 try/finally | ✅ | controller :119-124 非 fire-and-forget；互斥释放 service :123-125 finally；并发 409 |
| 真实启动冒烟 | ✅ | `node --env-file-if-exists=.env dist/main.js` → `Nest application successfully started`（DI 装配通过；端口被既有实例占用属预期） |
| 计划头部状态/审计引用真实 | ✅ | implemented 状态在实现完成后置位；两份审计记录真实落盘 |

## 行为一致性核验（与计划逐条相符）

- 缺失判定与 summary-integrity.service.ts:102-124 语义一致（:129-146）
- 分支：rawResponse 空→skipped :157；非法 JSON→failed :163；缺 bvid/cid→skipped
  :167；无下载任务→skipped :173；视频缺失→findCompletedTaskByBvidAndCid 复用
  :179-184 → 仍无则收集 deferred（主流程不下载）:186-188
- 末段 deferred：去重 :276-284 → FfmpegMerger 预检 :286-292 →
  created/downloading 不入队 :297-302 → createDownload(autoSummary:false) :304-314
- rebuild 终态：resetIntegrity + upsert 与 analysis-trigger.service.ts:829-838
  一致 :248-260；不触发知识发布
- ffmpeg 不可用：全部 pending 记 failed 且不入队 :114-117

## 逻辑排查（均无缺陷）

- 互斥时序：run() finally 先于 controller 返回释放；超时重试运行期得 409，
  run 抛出→finally 释放→500，无误判 409
- TaskStatus.Created/Downloading 枚举值即 DB 字符串（TaskStatus.ts:10,12）
- cid Number/BiInt 边界：mapTaskRow :422 → 守卫 :172 → BigInt :1138 安全
- resolveSummaryDir 复刻与 trigger :624-675 逐行等价（仅少日志）
- record.id 主键非空（mapAiSummaryTaskRow :847），`record.id!` 安全

## 提示级（不阻塞）

- FfmpegMerger 预检先于状态分支：ffmpeg 故障时"下载进行中"项被记 failed
- rawResponse 为空 + ffmpeg 不可用 → failed 而非 skipped（检查顺序）

## 文档收尾（已回填）

1. `docs/context/codebase-map.md` Server 行补 summary-repair.service.ts 与端点
2. `docs/logs/2026-09-08-summary-repair-api.md` 新增（含验证输出）；旧脚本日志
   顶部标注被 API 版取代

## 待用户执行（计划明示，不阻断闭合）

真实环境两次 `curl -X POST /api/summary-tasks/repair` 验证幂等与
deferred → 下载完成 → 重触发 → repaired 路径。
