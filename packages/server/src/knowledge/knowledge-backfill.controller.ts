import {
  Controller,
  Get,
  Post,
  ConflictException,
} from "@nestjs/common";
import { KnowledgeBackfillService } from "./knowledge-backfill.service.js";

@Controller("api/knowledge/backfill")
export class KnowledgeBackfillController {
  constructor(private readonly backfill: KnowledgeBackfillService) {}

  @Post()
  async startBackfill() {
    const result = await this.backfill.start();
    if (!result.started) {
      throw new ConflictException("知识回填任务正在运行中");
    }
    if (result.total === 0) {
      return { total: 0 };
    }
    return { message: "知识回填已启动", total: result.total };
  }

  @Get()
  getBackfillStatus() {
    return this.backfill.getStatus();
  }
}
