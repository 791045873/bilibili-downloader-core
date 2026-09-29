import {
  BadRequestException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Query,
} from "@nestjs/common";
import { DatabaseService } from "../database/database.service.js";

/**
 * worker_job 作业状态查询与取消接口（供前端轮询）。
 * 注：与项目其余接口一致，当前无鉴权（本地/内网使用）。
 */
@Controller("api/worker-jobs")
export class WorkerController {
  constructor(private readonly db: DatabaseService) {}

  @Get()
  async list(
    @Query("queue") queue?: string,
    @Query("kind") kind?: string,
    @Query("status") status?: string,
    @Query("limit") limit?: string,
  ) {
    const items = await this.db.listWorkerJobs({
      queue,
      kind,
      status,
      limit: limit ? Number.parseInt(limit, 10) : undefined,
    });
    return { items };
  }

  @Get(":id")
  async getOne(@Param("id") id: string) {
    const jobId = Number.parseInt(id, 10);
    if (Number.isNaN(jobId)) {
      throw new BadRequestException("无效的作业 ID");
    }
    const job = await this.db.getWorkerJobById(jobId);
    if (!job) {
      throw new NotFoundException("作业不存在");
    }
    return job;
  }

  @Post(":id/cancel")
  @HttpCode(HttpStatus.OK)
  async cancel(@Param("id") id: string) {
    const jobId = Number.parseInt(id, 10);
    if (Number.isNaN(jobId)) {
      throw new BadRequestException("无效的作业 ID");
    }
    const job = await this.db.cancelWorkerJob(jobId);
    if (!job) {
      throw new NotFoundException("作业不存在");
    }
    return {
      id: job.id,
      status: job.status,
      cancelRequested: job.cancelRequested,
    };
  }
}
