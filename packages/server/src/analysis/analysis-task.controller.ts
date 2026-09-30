import {
  BadRequestException,
  ConflictException,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  NotFoundException,
  Param,
  Post,
  Query,
  Body,
} from "@nestjs/common";
import { DatabaseService } from "@bilibili-downloader/server-common";
import type { AiSummaryTaskRecord } from "@bilibili-downloader/server-common";
import { DownloadService } from "../download/download.service.js";
import { AnalysisTriggerService } from "./analysis-trigger.service.js";
import type { SummaryMeta } from "./summary-dir.js";
import {
  buildSummaryMeta,
  renderRawResponseMarkdown,
  renderSummaryFromDb,
} from "./summary-render.js";
import { ROLE_ADMIN, ROLE_USER } from "../user-auth/auth.constants.js";
import { Roles } from "../user-auth/auth.decorators.js";

@Controller("api")
export class AnalysisTaskController {
  private readonly logger = new Logger(AnalysisTaskController.name);

  constructor(
    private readonly analysisTriggerService: AnalysisTriggerService,
    private readonly databaseService: DatabaseService,
    private readonly downloadService: DownloadService,
  ) {}

  @Post("/tasks/:id/summary")
  async triggerTaskAiSummary(
    @Param("id") id: string,
    @Body() body: { promptId?: number } = {},
  ) {
    const taskId = Number.parseInt(id, 10);
    if (Number.isNaN(taskId)) {
      throw new BadRequestException("无效的任务 ID");
    }
    const promptId = parseOptionalPromptId(body?.promptId);

    const task = await this.downloadService.getTaskById(taskId);
    if (!task) {
      throw new NotFoundException("任务不存在");
    }
    if (task.status !== "success") {
      throw new ConflictException("仅已完成下载任务可触发 AI 总结");
    }
    if (!task.bvid || typeof task.cid !== "number") {
      throw new ConflictException("任务缺少 AI 总结所需的视频资源标识");
    }

    const summaryTask = await this.databaseService.getAiSummaryTaskByResource(
      task.bvid,
      task.cid,
    );
    if (
      summaryTask &&
      (summaryTask.status === "pending" || summaryTask.status === "analyzing")
    ) {
      throw new ConflictException("当前资源的 AI 总结正在进行中，请勿重复触发");
    }

    await this.databaseService.updateTaskStatus(taskId, {
      status: task.status,
      autoSummary: 1,
    });

    await this.databaseService.enqueueJob({
      kind: "analyze",
      queue: "nas",
      refType: "task",
      refId: taskId,
      dedupKey: `analyze:${task.bvid}:${task.cid}`,
      payload: { taskId, promptId },
    });

    return { message: "AI 总结触发中" };
  }

  @Post("/summary-tasks/integrity-check")
  @HttpCode(HttpStatus.OK)
  async startIntegrityCheck() {
    await this.databaseService.enqueueJob({
      kind: "integrity_check",
      queue: "nas",
      dedupKey: "integrity_check",
    });
    return { message: "完整性检查已开始" };
  }

  @Get("/summary-tasks/integrity-check/status")
  async getIntegrityCheckStatus() {
    const job =
      await this.databaseService.getLatestWorkerJobByKind("integrity_check");
    const running =
      job?.status === "queued" ||
      job?.status === "leased" ||
      job?.status === "running";
    return { running, job: job ?? null };
  }

  @Get("/summary-tasks")
  async getAiSummaryTasks(
    @Query("page") page = "1",
    @Query("pageSize") pageSize = "20",
    @Query("status") status = "all",
    @Query("search") search = "",
    @Query("updatedFrom") updatedFrom = "",
    @Query("updatedTo") updatedTo = "",
  ) {
    return this.analysisTriggerService.getAiSummaryTasksPaginated({
      ...parsePagination(page, pageSize),
      status: parseAiSummaryStatus(status),
      search: search.trim() || undefined,
      updatedFrom: parseOptionalIso(updatedFrom, "updatedFrom"),
      updatedTo: parseOptionalIso(updatedTo, "updatedTo"),
    });
  }

  @Get("/summary-tasks/:id/raw-response")
  async getAiSummaryTaskRawResponse(@Param("id") id: string) {
    const summaryTaskId = Number.parseInt(id, 10);
    if (Number.isNaN(summaryTaskId)) {
      this.logger.warn(
        `Get ai summary task raw response rejected due to invalid id: ${id}`,
      );
      throw new BadRequestException("无效的任务 ID");
    }

    const record = await this.databaseService.getAiSummaryTaskById(
      summaryTaskId,
    );
    if (!record) {
      this.logger.warn(
        `Get ai summary task raw response rejected due to not-found: ${summaryTaskId}`,
      );
      throw new NotFoundException("AI 总结任务不存在");
    }

    return { rawResponse: record.rawResponse ?? null };
  }

  @Get("/summary-tasks/:id/markdown")
  async getAiSummaryTaskMarkdown(@Param("id") id: string) {
    const summaryTaskId = Number.parseInt(id, 10);
    if (Number.isNaN(summaryTaskId)) {
      this.logger.warn(
        `Get ai summary task markdown rejected due to invalid id: ${id}`,
      );
      throw new BadRequestException("无效的任务 ID");
    }

    const record = await this.databaseService.getAiSummaryTaskById(
      summaryTaskId,
    );
    if (!record) {
      this.logger.warn(
        `Get ai summary task markdown rejected due to not-found: ${summaryTaskId}`,
      );
      throw new NotFoundException("AI 总结任务不存在");
    }

    return this.renderSummaryMarkdown(record, `id=${summaryTaskId}`);
  }

  /**
   * 按视频资源 (bvid,cid) 取完整总结文档，供 QA 来源视频"AI 总结"整页消费。
   * 不做降级：无记录/未完成/无输出/文件缺失分别返回 404/409/409/404。
   */
  // 普通 user 可读（QA 来源视频整页）；同类 /:id/markdown、/:id/raw-response 仍仅 admin
  @Roles(ROLE_ADMIN, ROLE_USER)
  @Get("/summary-tasks/by-resource/:bvid/:cid/markdown")
  async getAiSummaryTaskMarkdownByResource(
    @Param("bvid") bvid: string,
    @Param("cid") cid: string,
  ) {
    const parsedCid = Number.parseInt(cid, 10);
    if (!bvid || bvid.trim() === "" || !Number.isInteger(parsedCid) || parsedCid < 0) {
      this.logger.warn(
        `Get ai summary task markdown by resource rejected due to invalid params: bvid=${bvid} cid=${cid}`,
      );
      throw new BadRequestException("无效的视频资源标识");
    }

    const record = await this.databaseService.getAiSummaryTaskByResource(
      bvid,
      parsedCid,
    );
    if (!record) {
      this.logger.warn(
        `Get ai summary task markdown by resource rejected due to not-found: ${bvid}-${parsedCid}`,
      );
      throw new NotFoundException("该视频暂无 AI 总结");
    }

    return this.renderSummaryMarkdown(record, `${bvid}-${parsedCid}`);
  }

  /**
   * 校验完成态后从云 DB 渲染总结 markdown：优先 summary + summary_segment，
   * 无 summary 行时回退 ai_summary_task.raw_response。不读本地文件、不 join 媒体路径。
   */
  private async renderSummaryMarkdown(
    record: AiSummaryTaskRecord,
    logRef: string,
  ): Promise<{ content: string; meta: SummaryMeta }> {
    if (record.status !== "completed") {
      throw new ConflictException("仅已完成的 AI 总结可查看总结文档");
    }

    const summary = await this.databaseService.getSummaryWithSegmentsByResource(
      record.bvid,
      record.cid,
    );
    const meta = buildSummaryMeta(summary ?? null, record, record.bvid);

    if (summary) {
      this.warnOnSummaryDrift(record, summary.segments.length, logRef);
      return { content: renderSummaryFromDb(summary).content, meta };
    }

    return {
      content: renderRawResponseMarkdown(record.rawResponse, meta.title ?? "")
        .content,
      meta,
    };
  }

  /** 漂移告警（非阻塞）：summary 与 raw_response 段数不一致时以 summary 为准并记录 */
  private warnOnSummaryDrift(
    record: AiSummaryTaskRecord,
    summarySegmentCount: number,
    logRef: string,
  ): void {
    if (!record.rawResponse) {
      return;
    }
    try {
      const parsed = JSON.parse(record.rawResponse) as { summary?: unknown };
      const rawLen = Array.isArray(parsed.summary)
        ? parsed.summary.length
        : undefined;
      if (rawLen !== undefined && rawLen !== summarySegmentCount) {
        this.logger.warn(
          `Summary/raw_response drift for ${logRef}: summary segments=${summarySegmentCount} raw=${rawLen}; rendering from summary`,
        );
      }
    } catch {
      // raw_response 非合法 JSON：以 summary 为准，不阻塞
    }
  }

  @Delete("/summary-tasks/:id")
  async deleteAiSummaryTask(@Param("id") id: string) {
    const summaryTaskId = Number.parseInt(id, 10);
    if (Number.isNaN(summaryTaskId)) {
      this.logger.warn(`Delete ai summary task rejected due to invalid id: ${id}`);
      throw new BadRequestException("无效的任务 ID");
    }

    const summaryTask =
      await this.analysisTriggerService.getAiSummaryTaskById(summaryTaskId);
    if (!summaryTask) {
      this.logger.warn(
        `Delete ai summary task rejected due to not-found: ${summaryTaskId}`,
      );
      throw new NotFoundException("AI 总结任务不存在");
    }
    if (summaryTask.status === "pending" || summaryTask.status === "analyzing") {
      throw new ConflictException("进行中的 AI 总结不可删除");
    }

    await this.analysisTriggerService.deleteAiSummaryTask(summaryTaskId);
    return { message: "已删除" };
  }

  @Post("/summary-tasks/:id/retrigger")
  @HttpCode(HttpStatus.OK)
  async retriggerAiSummaryTask(@Param("id") id: string) {
    const summaryTaskId = Number.parseInt(id, 10);
    if (Number.isNaN(summaryTaskId)) {
      this.logger.warn(
        `Retrigger ai summary task rejected due to invalid id: ${id}`,
      );
      throw new BadRequestException("无效的任务 ID");
    }

    const summaryTask =
      await this.analysisTriggerService.getAiSummaryTaskById(summaryTaskId);
    if (!summaryTask) {
      this.logger.warn(
        `Retrigger ai summary task rejected due to not-found: ${summaryTaskId}`,
      );
      throw new NotFoundException("AI 总结任务不存在");
    }
    if (
      summaryTask.status === "pending" ||
      summaryTask.status === "analyzing"
    ) {
      throw new ConflictException("进行中的 AI 总结不可重新触发");
    }

    // 下载任务记录可能已被删除（删除路径独立），按资源查找当前下载任务
    const task = await this.databaseService.findLatestTaskByBvidAndCid(
      summaryTask.bvid,
      summaryTask.cid,
    );
    if (!task || typeof task.id !== "number") {
      this.logger.warn(
        `Retrigger ai summary task rejected because no download task exists for summary task ${summaryTaskId} (${summaryTask.bvid}-${summaryTask.cid})`,
      );
      throw new ConflictException("无对应的下载任务，无法重新总结");
    }
    if (task.status !== "success") {
      throw new ConflictException("仅已完成下载任务可触发 AI 总结");
    }

    await this.databaseService.updateTaskStatus(task.id, {
      status: task.status,
      autoSummary: 1,
    });

    await this.databaseService.enqueueJob({
      kind: "analyze",
      queue: "nas",
      refType: "task",
      refId: task.id,
      dedupKey: `analyze:${summaryTask.bvid}:${summaryTask.cid}`,
      payload: { taskId: task.id, promptId: summaryTask.promptId },
    });

    return { message: "AI 总结触发中" };
  }

  @Post("/summary-tasks/:id/rebuild")
  @HttpCode(HttpStatus.OK)
  async rebuildAiSummaryTask(@Param("id") id: string) {
    const summaryTaskId = Number.parseInt(id, 10);
    if (Number.isNaN(summaryTaskId)) {
      this.logger.warn(
        `Rebuild ai summary task rejected due to invalid id: ${id}`,
      );
      throw new BadRequestException("无效的任务 ID");
    }

    // 校验需要 rawResponse，使用 databaseService 完整记录（service 视图已剥离 rawResponse）
    const record = await this.databaseService.getAiSummaryTaskById(
      summaryTaskId,
    );
    if (!record) {
      this.logger.warn(
        `Rebuild ai summary task rejected due to not-found: ${summaryTaskId}`,
      );
      throw new NotFoundException("AI 总结任务不存在");
    }
    if (record.status !== "completed") {
      throw new ConflictException("仅已完成的 AI 总结可重试截图");
    }
    if (!record.rawResponse) {
      throw new ConflictException("无可用的大模型返回内容，无法重试截图");
    }
    await this.databaseService.enqueueJob({
      kind: "screenshot_retry",
      queue: "nas",
      refType: "summary_task",
      refId: summaryTaskId,
      dedupKey: `screenshot_retry:${summaryTaskId}`,
      payload: { summaryTaskId },
    });

    return { message: "重试截图已开始" };
  }

}

const AI_SUMMARY_STATUSES = [
  "all",
  "pending",
  "analyzing",
  "failed",
  "completed",
] as const;
type AiSummaryStatus = (typeof AI_SUMMARY_STATUSES)[number];

function toPositiveInt(value: string, name: string): number {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n <= 0) {
    throw new BadRequestException(`${name} 必须为正整数`);
  }
  return n;
}

function parseOptionalPromptId(value: unknown): number | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new BadRequestException("promptId 必须为正整数");
  }
  return value;
}

function parsePagination(
  pageRaw: string,
  pageSizeRaw: string,
): { page: number; pageSize: number } {
  return {
    page: toPositiveInt(pageRaw, "page"),
    pageSize: toPositiveInt(pageSizeRaw, "pageSize"),
  };
}

function parseAiSummaryStatus(value: string): AiSummaryStatus[] {
  const items = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  if (items.length === 0 || items.includes("all")) {
    return [];
  }
  for (const item of items) {
    if (!(AI_SUMMARY_STATUSES as readonly string[]).includes(item)) {
      throw new BadRequestException(
        `status 必须为 ${AI_SUMMARY_STATUSES.join(" / ")}`,
      );
    }
  }
  return items as AiSummaryStatus[];
}

function parseOptionalIso(value: string, name: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  if (Number.isNaN(Date.parse(trimmed))) {
    throw new BadRequestException(`${name} 必须为有效时间`);
  }
  return trimmed;
}
