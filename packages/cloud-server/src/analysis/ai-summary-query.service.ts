import { Injectable } from "@nestjs/common";
import { DatabaseService } from "@bilibili-downloader/server-common";
import {
  parseExecutionTiming,
  type AiSummaryTaskView,
  type PaginatedAiSummaryTaskView,
} from "./ai-summary-task.view.js";

/**
 * AI 总结任务查询服务（cloud 读查询面）。
 *
 * 从云 DB 读分页/详情并剥离 rawResponse、解析 executionTiming；删除为纯 DB 操作。
 * 不触发、不执行分析（执行面在 nas-worker）。
 */
@Injectable()
export class AiSummaryQueryService {
  constructor(private readonly db: DatabaseService) {}

  async getAiSummaryTasksPaginated(params: {
    page: number;
    pageSize: number;
    status?: string[];
    search?: string;
    updatedFrom?: string;
    updatedTo?: string;
  }): Promise<PaginatedAiSummaryTaskView> {
    const result = await this.db.listAiSummaryTasksPaginated({
      page: params.page,
      pageSize: params.pageSize,
      filter: {
        status: params.status,
        search: params.search,
        updatedFrom: params.updatedFrom,
        updatedTo: params.updatedTo,
      },
    });
    return {
      ...result,
      items: result.items.map(({ rawResponse: _raw, ...rest }) => ({
        ...rest,
        executionTiming: parseExecutionTiming(rest.executionTiming),
      })),
    };
  }

  async getAiSummaryTaskById(
    id: number,
  ): Promise<AiSummaryTaskView | undefined> {
    const record = await this.db.getAiSummaryTaskById(id);
    if (!record) {
      return undefined;
    }
    const { rawResponse: _raw, ...rest } = record;
    return {
      ...rest,
      executionTiming: parseExecutionTiming(rest.executionTiming),
    };
  }

  async deleteAiSummaryTask(id: number): Promise<boolean> {
    return this.db.deleteAiSummaryTask(id);
  }
}
