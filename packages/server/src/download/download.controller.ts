import { Controller, Get, Post, Delete, Body, Param } from "@nestjs/common";
import { DownloadScheduler } from "./download-scheduler.js";
import { DownloadService } from "./download.service.js";
import { DownloadDto } from "./download.dto.js";

@Controller("api")
export class DownloadController {
  constructor(
    private readonly scheduler: DownloadScheduler,
    private readonly downloadService: DownloadService,
  ) {}

  // ==================== 任务生命周期 ====================

  @Post("/download")
  createDownload(@Body() dto: DownloadDto) {
    if (!dto.bvid || !dto.cid || !dto.title) {
      return { error: "缺少 bvid / cid / title 参数" };
    }
    return this.scheduler.createDownload(dto);
  }

  @Post("/tasks/:id/stop")
  stopTask(@Param("id") id: string) {
    const numId = Number.parseInt(id, 10);
    if (Number.isNaN(numId)) return { error: "无效的任务 ID" };
    return this.scheduler.stopTask(numId);
  }

  @Post("/tasks/:id/resume")
  resumeTask(@Param("id") id: string) {
    const numId = Number.parseInt(id, 10);
    if (Number.isNaN(numId)) return { error: "无效的任务 ID" };
    return this.scheduler.resumeTask(numId);
  }

  @Delete("/tasks/:id")
  deleteTask(@Param("id") id: string) {
    const numId = Number.parseInt(id, 10);
    if (Number.isNaN(numId)) return { error: "无效的任务 ID" };
    return this.scheduler.deleteTask(numId);
  }

  // ==================== 查询 ====================

  @Get("/tasks")
  getTasks() {
    return this.downloadService.getTasks();
  }

  @Get("/tasks/:id")
  getTask(@Param("id") id: string) {
    const numId = Number.parseInt(id, 10);
    if (Number.isNaN(numId)) return { error: "无效的任务 ID" };
    const task = this.downloadService.getTaskById(numId);
    if (!task) return { error: "任务不存在" };
    return task;
  }

  @Post("/tasks/clear")
  clearTasks() {
    return this.downloadService.clearTasks();
  }
}