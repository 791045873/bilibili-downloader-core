import { Module } from "@nestjs/common";
import { KnowledgeSearchController } from "./knowledge-search.controller.js";
import { EmbeddingService } from "./embedding.service.js";
import { CosStoreService } from "./cos-store.service.js";

/**
 * cloud 独立 knowledge 模块：向量检索 HTTP 面 + embedding/COS 薄 wrapper。
 *
 * 独立于 AnalysisModule，供 ChatModule 复用 EmbeddingService / CosStoreService
 * （拆分前 ChatModule 经 `imports: [AnalysisModule]` 取得，会把 nas 侧 provider 拖进 cloud）。
 */
@Module({
  controllers: [KnowledgeSearchController],
  providers: [EmbeddingService, CosStoreService],
  exports: [EmbeddingService, CosStoreService],
})
export class KnowledgeModule {}
