import type { AiSummaryTaskRecord } from "@bilibili-downloader/server-common";

/** AI 总结任务执行耗时明细 */
export interface AiSummaryExecutionTiming {
  llmMs: number;
  screenshotMs: number;
  totalMs: number;
}

/** AI 总结任务对外视图：executionTiming 解析为对象；rawResponse 不出接口。 */
export interface AiSummaryTaskView
  extends Omit<AiSummaryTaskRecord, "executionTiming" | "rawResponse"> {
  executionTiming?: AiSummaryExecutionTiming;
}

/** AI 总结任务分页视图 */
export interface PaginatedAiSummaryTaskView {
  items: AiSummaryTaskView[];
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
}

export function parseExecutionTiming(
  raw?: string,
): AiSummaryExecutionTiming | undefined {
  if (!raw) {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return undefined;
    }
    const p = parsed as {
      llmMs?: unknown;
      screenshotMs?: unknown;
      totalMs?: unknown;
    };
    if (
      typeof p.llmMs !== "number" ||
      typeof p.screenshotMs !== "number" ||
      typeof p.totalMs !== "number"
    ) {
      return undefined;
    }
    return { llmMs: p.llmMs, screenshotMs: p.screenshotMs, totalMs: p.totalMs };
  } catch {
    return undefined;
  }
}
