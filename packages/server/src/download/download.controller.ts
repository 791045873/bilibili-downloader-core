import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  BadRequestException,
} from "@nestjs/common";
import { DownloadScheduler } from "./download-scheduler.js";
import { DownloadService } from "./download.service.js";
import { DownloadDto } from "./download.dto.js";
import { DatabaseService } from "../database/database.service.js";

@Controller("api")
export class DownloadController {
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

  // ==================== 任务状态查询（入队去重） ====================

  @Post("/tasks/check")
  checkTasks(@Body() body: { items: { bvid: string; cid: number }[] }) {
    return this.databaseService.findTasksByBvidsAndCids(body.items ?? []);
  }
}
