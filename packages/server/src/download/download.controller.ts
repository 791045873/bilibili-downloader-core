import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  BadRequestException,
  Logger,
} from "@nestjs/common";
import { DownloadScheduler } from "./download-scheduler.js";
import { DownloadService } from "./download.service.js";
import { DownloadDto } from "./download.dto.js";
import { DatabaseService } from "../database/database.service.js";
import type { TaskStatusGroup } from "../database/database.service.js";
import { createLogMessage } from "../logging/server-log.util.js";

@Controller("api")
export class DownloadController {
  private readonly logger = new Logger(DownloadController.name);

  constructor(
    private readonly scheduler: DownloadScheduler,
    private readonly downloadService: DownloadService,
    private readonly databaseService: DatabaseService,
  ) {}

  // ==================== 任务生命周期 ====================

  @Get("/download/config")
  getDownloadConfig() {
    return this.downloadService.getDownloadConfig();
  }

  @Post("/download")
  createDownload(@Body() dto: DownloadDto) {
    if (!dto.bvid || !dto.cid || !dto.title) {
      throw new BadRequestException("缺少 bvid / cid / title 参数");
    }
    if (!dto.outputPath || !dto.outputPath.trim()) {
      throw new BadRequestException("outputPath 不能为空");
    }
    return this.scheduler.createDownload(dto);
  }

  @Post("/tasks/:id/stop")
  stopTask(@Param("id") id: string) {
    const numId = Number.parseInt(id, 10);
    if (Number.isNaN(numId)) {
      this.logger.warn(
        createLogMessage("Stop task rejected due to invalid task id", {
          id,
        }),
      );
      return { error: "无效的任务 ID" };
    }
    return this.scheduler.stopTask(numId);
  }

  @Post("/tasks/:id/resume")
  resumeTask(@Param("id") id: string) {
    const numId = Number.parseInt(id, 10);
    if (Number.isNaN(numId)) {
      this.logger.warn(
        createLogMessage("Resume task rejected due to invalid task id", {
          id,
        }),
      );
      return { error: "无效的任务 ID" };
    }
    return this.scheduler.resumeTask(numId);
  }

  @Post("/tasks/:id/auto-summary")
  setAutoSummary(@Param("id") id: string, @Body() body: { enabled?: boolean }) {
    const numId = Number.parseInt(id, 10);
    if (Number.isNaN(numId)) {
      this.logger.warn(
        createLogMessage("Set auto summary rejected due to invalid task id", {
          id,
        }),
      );
      throw new BadRequestException("无效的任务 ID");
    }
    if (typeof body?.enabled !== "boolean") {
      this.logger.warn(
        createLogMessage(
          "Set auto summary rejected due to invalid enabled flag",
          { taskId: numId },
        ),
      );
      throw new BadRequestException("enabled 必须为布尔值");
    }

    const task = this.downloadService.getTaskById(numId);
    if (!task) {
      this.logger.warn(
        createLogMessage(
          "Set auto summary rejected because task was not found",
          {
            taskId: numId,
          },
        ),
      );
      throw new BadRequestException("任务不存在");
    }

    this.databaseService.updateTaskStatus(numId, {
      status: task.status,
      autoSummary: body.enabled ? 1 : 0,
    });
    return { message: "auto_summary 已更新" };
  }

  @Delete("/tasks/:id")
  deleteTask(@Param("id") id: string) {
    const numId = Number.parseInt(id, 10);
    if (Number.isNaN(numId)) {
      this.logger.warn(
        createLogMessage("Delete task rejected due to invalid task id", {
          id,
        }),
      );
      return { error: "无效的任务 ID" };
    }
    return this.scheduler.deleteTask(numId);
  }

  // ==================== 查询 ====================

  @Get("/tasks")
  getTasks(
    @Query("page") page = "1",
    @Query("pageSize") pageSize = "20",
    @Query("statusGroup") statusGroup = "all",
  ) {
    return this.downloadService.getTasksPaginated({
      ...parsePagination(page, pageSize),
      statusGroup: parseTaskStatusGroup(statusGroup),
    });
  }

  @Get("/tasks/:id")
  getTask(@Param("id") id: string) {
    const numId = Number.parseInt(id, 10);
    if (Number.isNaN(numId)) {
      this.logger.warn(
        createLogMessage("Get task rejected due to invalid task id", {
          id,
        }),
      );
      return { error: "无效的任务 ID" };
    }
    const task = this.downloadService.getTaskById(numId);
    if (!task) {
      this.logger.warn(
        createLogMessage("Get task returned task-not-found", {
          taskId: numId,
        }),
      );
      return { error: "任务不存在" };
    }
    return task;
  }

  @Post("/tasks/clear")
  clearTasks() {
    return this.downloadService.clearTasks();
  }

  // ==================== 任务状态查询（入队去重） ====================

  @Post("/tasks/check")
  checkTasks(@Body() body: { items: { bvid: string; cid: number }[] }) {
    const items = Array.isArray(body?.items) ? body.items : [];
    if (items.length === 0) {
      this.logger.warn(
        createLogMessage("Bulk task check called with empty items", {
          itemCount: 0,
        }),
      );
    }
    return this.databaseService.findTasksByBvidsAndCids(items);
  }
}

function toPositiveInt(value: string, name: string): number {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n <= 0) {
    throw new BadRequestException(`${name} 必须为正整数`);
  }
  return n;
}

function parsePagination(
  pageRaw: string,
  pageSizeRaw: string,
): { page: number; pageSize: number } {
  const page = toPositiveInt(pageRaw, "page");
  const pageSize = toPositiveInt(pageSizeRaw, "pageSize");
  return { page, pageSize };
}

function parseTaskStatusGroup(value: string): TaskStatusGroup {
  const allowed: TaskStatusGroup[] = [
    "all",
    "active",
    "created",
    "downloading",
    "success",
    "failed",
    "stopped",
  ];
  if (allowed.includes(value as TaskStatusGroup)) {
    return value as TaskStatusGroup;
  }
  throw new BadRequestException(
    `statusGroup 必须为 ${allowed.join(" / ")}`,
  );
}
