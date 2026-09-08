# Plan Audit: AI 总结修复脚本改造为 API 接口

日期: 2026-09-08
类型: plan audit（independent subagent）
对象: `docs/plans/2026-09-08-summary-repair-api-plan.md`
结论: **pass-with-conditions**（条件已回填计划）

## 核验通过

- integrity-check 端点模式（analysis-task.controller.ts:93-112）与互斥原型
  （summary-integrity.service.ts:44,51-61,93-95）
- DownloadModule 导出 DownloadScheduler（download.module.ts:11）；AnalysisModule
  已 imports DownloadModule（analysis.module.ts:18）
- DownloadScheduler.createDownload（download-scheduler.ts:96-113）
- DB 方法语义：findLatestTaskByBvidAndCid :662（无 status 过滤）、
  findCompletedTaskByBvidAndCid :676、listCompletedAiSummaryTasks :937、
  resetAiSummaryTaskIntegrity :966、upsertAiSummaryTask :1101
- **autoSummary:false 足以阻断自动总结链路**：executeTask 不触发总结；
  唯一自动链路 onTaskFinished→onAnalysisTrigger→trigger 在
  analysis-trigger.service.ts:196 检查 `!task.autoSummary` 跳过

## 已回填计划的条件

1. 计划头部状态与审计引用须与磁盘事实一致（审计时实现不存在）→ 状态改
   plan-audited、审计记录真实落盘
2. 报告字段自洽：成功项统一入 repaired（带 empty 布尔），删除 repairedEmpty
   数组与"同 repaired"歧义
3. 验证须含真实启动冒烟（DI 装配错误只在运行时 bootstrap 暴露），删除
   "node --check = DI 编译期校验"的不准确表述
4. controller 同步 await service.run() 返回报告；互斥释放在 service 的
   try/finally；不得照抄 fire-and-forget 模式

## 非阻塞建议（已并入计划）

- 卡死下载任务人工出路：stop → 重触发（stopped 走入队分支）
- deferred 入队前检 FfmpegMerger；按 bvid+cid 去重
- 前置脚本版计划标注被接口取代
