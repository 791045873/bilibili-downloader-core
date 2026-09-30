/**
 * 知识发布管道（Phase 1b 起内联，publishInline）：把一份完成的 AI 总结写入云端知识库
 * （summary/summary_segment + COS 截图）。
 *
 * 流程：
 *   1. 按结构化 segments[].screenshotFiles 上传截图至 COS（best-effort，失败留空 screenshot_url）；
 *   2. 事务内 upsert 云端 summary + summary_segment（内容入库=完成门槛，失败向上抛由调用方置 failed）；
 *   3. 生成/复用段向量（best-effort，失败不阻塞完成）。
 *
 * 幂等：云端按 (bvid,cid) 删旧插新；文本未变复用向量。不读本地 md、不写 knowledge_status。
 */

import { Injectable, Logger } from "@nestjs/common";
import { basename } from "node:path";
import { DatabaseService } from "@bilibili-downloader/server-common";
import { CosStoreService } from "./cos-store.service.js";
import { EmbeddingService, normalizeEmbeddingText } from "./embedding.service.js";
import { createLogMessage } from "@bilibili-downloader/server-common";
import {
  parseTimestampCandidates,
  pickTimestampSeconds,
} from "../analysis/timestamp.js";

@Injectable()
export class KnowledgePublisherService {
  private readonly logger = new Logger(KnowledgePublisherService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly cosStore: CosStoreService,
    private readonly embedding: EmbeddingService,
  ) {}

  /**
   * 内联发布（Phase 1b）：直接吃结构化 segments（不读本地 md），内容入库为唯一"完成"门槛。
   * - 内容 upsert 失败：向上抛，由调用方置 failed（保留模型 JSON）。
   * - COS 截图上传与向量生成为入库后 best-effort：失败仅留空、记录日志，绝不影响完成。
   * - 不写 knowledge_status（内联后无影子发布态）。
   */
  async publishInline(input: {
    bvid: string;
    cid: number;
    videoTitle: string;
    videoUrl?: string;
    modelName?: string;
    rawResponse: string;
    segments: Array<{
      title: string;
      content: string;
      timestamp: string;
      frameDescription: string;
      screenshotFiles: string[];
    }>;
  }): Promise<void> {
    const { bvid, cid } = input;
    const cosReady = this.cosStore.isConfigured();

    const segments = await Promise.all(
      input.segments.map(async (seg, index) => {
        let screenshotUrl: string | undefined;
        const local = seg.screenshotFiles[0];
        if (cosReady && local) {
          try {
            const key = `summary/${bvid}-${cid}/screenshots/${basename(local)}`;
            screenshotUrl = await this.cosStore.upload(local, key);
          } catch (err) {
            this.logger.warn(
              createLogMessage("Inline screenshot upload failed (non-blocking)", {
                bvid,
                cid,
                seq: index,
                error: err instanceof Error ? err.message : String(err),
              }),
            );
          }
        }
        return {
          seq: index,
          title: seg.title,
          content: seg.content,
          timestampSeconds: pickTimestampSeconds(
            parseTimestampCandidates(seg.timestamp),
          ),
          frameDescription: seg.frameDescription,
          screenshotUrl,
        };
      }),
    );

    const previousSegments = await this.db.getSummarySegmentsForEmbedding(
      bvid,
      cid,
    );

    const summaryId = await this.db.upsertSummaryKnowledge({
      bvid,
      cid,
      videoTitle: input.videoTitle,
      videoUrl: input.videoUrl,
      modelName: input.modelName,
      rawResponse: input.rawResponse,
      segments,
    });

    try {
      await this.writeSegmentEmbeddings(summaryId, segments, previousSegments);
    } catch (err) {
      this.logger.warn(
        createLogMessage("Inline embedding generation failed (non-blocking)", {
          bvid,
          cid,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    }

    this.logger.log(
      createLogMessage("Summary knowledge published inline", {
        bvid,
        cid,
        segmentCount: segments.length,
        screenshotCount: segments.filter((s) => s.screenshotUrl).length,
      }),
    );
  }

  /**
   * 两段写第二段：复用未变更向量 → 补算缺失向量 → raw 回写。
   * 缺 embedding 配置/调用失败时抛错，由 publishInline 以 best-effort 捕获（不阻塞完成，向量留空）。
   */
  private async writeSegmentEmbeddings(
    summaryId: number,
    segments: Array<{
      seq: number;
      title: string;
      content: string;
    }>,
    previousSegments: Array<{
      seq: number;
      title: string;
      content: string;
      embedding: number[] | null;
      embeddingModel: string | null;
    }>,
  ): Promise<void> {
    if (segments.length === 0) {
      return;
    }
    const reuseByNormalizedText = new Map<string, number[]>();
    for (const prev of previousSegments) {
      if (prev.embedding && prev.embeddingModel === this.embedding.currentModel()) {
        reuseByNormalizedText.set(
          normalizeEmbeddingText(prev.title, prev.content),
          prev.embedding,
        );
      }
    }
    const vectors: Array<number[] | null> = [];
    const pending: Array<{ text: string; index: number }> = [];
    for (const segment of segments) {
      const text = normalizeEmbeddingText(segment.title, segment.content);
      const reused = reuseByNormalizedText.get(text);
      if (reused) {
        vectors.push(reused);
      } else {
        pending.push({ text, index: vectors.length });
        vectors.push(null);
      }
    }
    if (pending.length > 0) {
      const computed = await this.embedding.embedTexts(
        pending.map((p) => p.text),
      );
      computed.forEach((vector, i) => {
        vectors[pending[i].index] = vector;
      });
    }
    const writes = segments
      .map((segment, index) => ({ seq: segment.seq, embedding: vectors[index] }))
      .filter((item): item is { seq: number; embedding: number[] } => item.embedding !== null);
    await this.db.updateSummarySegmentEmbeddings(
      summaryId,
      writes,
      this.embedding.currentModel(),
    );
  }
}
