import {
  BadRequestException,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Query,
} from "@nestjs/common";
import {
  EmbeddingApiError,
  EmbeddingConfigError,
  EmbeddingService,
  normalizeEmbeddingText,
} from "./embedding.service.js";
import { DatabaseService } from "../database/database.service.js";

@Controller("api/knowledge")
export class KnowledgeSearchController {
  constructor(
    private readonly embedding: EmbeddingService,
    private readonly db: DatabaseService,
  ) {}

  @Get("search")
  async search(
    @Query("q") q: string | undefined,
    @Query("k") k: string | undefined,
  ) {
    if (!q || q.trim().length === 0) {
      throw new BadRequestException("q 不能为空");
    }
    const limit = k === undefined ? 10 : Number(k);
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
      throw new BadRequestException("k 必须为 1–50 的整数");
    }
    let queryVector: number[];
    try {
      queryVector = await this.embedding.embedQuery(normalizeEmbeddingText(q));
    } catch (err) {
      throw this.toServiceUnavailable(err);
    }
    try {
      return await this.db.searchKnowledgeSegments(
        queryVector,
        this.embedding.currentModel(),
        limit,
      );
    } catch (err) {
      throw new HttpException(
        `向量检索失败: ${err instanceof Error ? err.message : String(err)}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /** 缺 embedding 配置与 embedding 调用失败均映射为 503（不降级为关键词搜索） */
  private toServiceUnavailable(err: unknown): HttpException {
    const message = err instanceof Error ? err.message : String(err);
    const status =
      err instanceof EmbeddingConfigError || err instanceof EmbeddingApiError
        ? HttpStatus.SERVICE_UNAVAILABLE
        : HttpStatus.INTERNAL_SERVER_ERROR;
    return new HttpException(`向量检索暂不可用: ${message}`, status);
  }
}
