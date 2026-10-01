import { Injectable } from "@nestjs/common";
import {
  DEFAULT_EMBEDDING_BASE_URL,
  DEFAULT_EMBEDDING_DIMENSIONS,
  DEFAULT_EMBEDDING_MODEL,
  EmbeddingApiError,
  EmbeddingClient,
  EmbeddingConfigError,
  EMBEDDING_BATCH_LIMIT,
  normalizeEmbeddingText,
} from "@bilibili-downloader/adapters/embedding";
import { DatabaseService } from "@bilibili-downloader/server-common";

@Injectable()
export class EmbeddingService {
  constructor(private readonly db: DatabaseService) {}

  /** 当前配置的 embedding 模型名（同步 env，供复用比对与检索过滤） */
  currentModel(): string {
    return process.env.EMBEDDING_MODEL ?? DEFAULT_EMBEDDING_MODEL;
  }

  /**
   * 批量生成向量（自动分批 ≤20）。缺 API Key 时抛 EmbeddingConfigError，
   * 调用方映射为 knowledge_status=failed（写入流）或 503（检索流）。
   */
  async embedTexts(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const stored = await this.db.getSettings(["llm.apiKey"]);
    const apiKey = stored["llm.apiKey"];
    if (!apiKey) {
      throw new EmbeddingConfigError(
        "缺少 embedding 配置：请在设置页配置 LLM API Key（llm.apiKey）",
      );
    }
    const dimensions = Number(
      process.env.EMBEDDING_DIMENSIONS ?? DEFAULT_EMBEDDING_DIMENSIONS,
    );
    if (dimensions !== DEFAULT_EMBEDDING_DIMENSIONS) {
      throw new EmbeddingConfigError(
        `EMBEDDING_DIMENSIONS 仅支持 ${DEFAULT_EMBEDDING_DIMENSIONS}（列维度固定）；变更需迁移 + 存量重算（Phase 4）`,
      );
    }
    const client = new EmbeddingClient({
      apiKey,
      baseUrl: process.env.EMBEDDING_BASE_URL ?? DEFAULT_EMBEDDING_BASE_URL,
      model: this.currentModel(),
      dimensions,
    });
    const results: number[][] = [];
    for (let i = 0; i < texts.length; i += EMBEDDING_BATCH_LIMIT) {
      const chunk = texts.slice(i, i + EMBEDDING_BATCH_LIMIT);
      results.push(...(await client.embed(chunk)));
    }
    return results;
  }

  async embedQuery(text: string): Promise<number[]> {
    const [vector] = await this.embedTexts([text]);
    return vector;
  }
}

// 向量复用键相关常量/归一化/错误类型下沉 adapters（单一真源，防 cloud/nas 漂移）；
// 此处 re-export 保持既有调用点的 import 路径不变。
export {
  EmbeddingApiError,
  EmbeddingConfigError,
  normalizeEmbeddingText,
  DEFAULT_EMBEDDING_MODEL,
  DEFAULT_EMBEDDING_DIMENSIONS,
};
