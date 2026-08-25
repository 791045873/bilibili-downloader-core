/**
 * 知识发布管道：把一份完成的 AI 总结发布到云端知识库（COS 截图 + summary/summary_segment）。
 *
 * 流程：
 *   1. 读取 md，提取其中图片引用（相对路径与已存在的 COS 绝对 URL）；
 *   2. 对本地仍存在的相对路径截图，上传 COS 并得到公网 URL；
 *   3. 解析 raw_response → summary segments，为每段确定 screenshot_url（本地重传或沿用既有 COS URL）；
 *   4. 事务内 upsert 云端 summary + summary_segment；
 *   5. 重写本地 md 相对图片链接为 COS 公网 URL；
 *   6. 更新 ai_summary_task.knowledge_status（pending → synced/failed）。
 *
 * 幂等：云端按 (bvid,cid) 删旧插新；重试已发布总结时，md 已含 COS 绝对 URL，沿用不重传。
 */

import { Injectable, Logger } from "@nestjs/common";
import { access, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { DatabaseService } from "../database/database.service.js";
import { CosStoreService } from "./cos-store.service.js";
import { createLogMessage } from "../logging/server-log.util.js";
import { rewriteMarkdownImages } from "../analysis/summary-dir.js";
import {
  parseTimestampCandidates,
  pickTimestampSeconds,
} from "../analysis/timestamp.js";

export interface KnowledgePublishInput {
  bvid: string;
  cid: number;
  videoTitle: string;
  videoUrl?: string;
  modelName?: string;
  /** 模型返回 JSON 原文 */
  rawResponse: string;
  /** 本地 summary md 绝对路径（用于定位截图目录与重写图片链接） */
  summaryPath: string;
}

const IMAGE_RE = /!\[([^\]]*)\]\(\s*([^)\s]+)(?:\s+"[^"]*")?\s*\)/g;

function isRelativeUrl(url: string): boolean {
  if (url.startsWith("/") || url.startsWith("#")) {
    return false;
  }
  return !/^[a-z][a-z0-9+.-]*:/i.test(url);
}

async function pathExists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

@Injectable()
export class KnowledgePublisherService {
  private readonly logger = new Logger(KnowledgePublisherService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly cosStore: CosStoreService,
  ) {}

  async publish(input: KnowledgePublishInput): Promise<void> {
    const { bvid, cid } = input;
    if (!this.cosStore.isConfigured()) {
      await this.db.updateSummaryKnowledgeStatus(
        bvid,
        cid,
        "failed",
        "COS 未配置，知识发布跳过",
      );
      return;
    }

    let items: Array<{
      title: string;
      content: string;
      timestamp: string;
      frameDescription: string;
    }> = [];
    try {
      const parsed = JSON.parse(input.rawResponse) as {
        summary?: Array<{
          title?: unknown;
          content?: unknown;
          timestamp?: unknown;
          frameDescription?: unknown;
        }>;
      };
      items = (parsed?.summary ?? []).filter(
        (it): it is {
          title: string;
          content: string;
          timestamp: string;
          frameDescription: string;
        } =>
          typeof it.title === "string" &&
          it.title.trim().length > 0 &&
          typeof it.content === "string" &&
          it.content.trim().length > 0 &&
          typeof it.timestamp === "string" &&
          it.timestamp.trim().length > 0 &&
          typeof it.frameDescription === "string" &&
          it.frameDescription.trim().length > 0,
      );
    } catch {
      await this.db.updateSummaryKnowledgeStatus(
        bvid,
        cid,
        "failed",
        "raw_response 不是有效 JSON，无法发布",
      );
      return;
    }

    await this.db.updateSummaryKnowledgeStatus(bvid, cid, "pending");
    try {
      const md = await readFile(input.summaryPath, "utf-8");
      const imageUrls = extractImageUrls(md);

      // 上传本地仍存在的相对路径截图，建立 相对路径 → COS URL
      const urlByRelPath: Record<string, string> = {};
      for (const raw of imageUrls) {
        const url = raw.trim();
        if (!isRelativeUrl(url)) {
          continue;
        }
        const localPath = resolve(dirname(input.summaryPath), url);
        if (!(await pathExists(localPath))) {
          continue;
        }
        const key = `summary/${bvid}-${cid}/screenshots/${basename(localPath)}`;
        urlByRelPath[url] = await this.cosStore.upload(localPath, key);
      }

      // 为每段确定 screenshot_url：优先已上传的 COS URL；已存在绝对 URL（重试已发布）则沿用
      const segments = items.map((item, index) => {
        const image = imageUrls.find((raw) =>
          basename(raw.trim()).startsWith(`segment-${index}.`) ||
          basename(raw.trim()).startsWith(`segment-${index}-`),
        );
        let screenshotUrl: string | undefined;
        if (image) {
          const raw = image.trim();
          screenshotUrl = isRelativeUrl(raw) ? urlByRelPath[raw] : raw;
        }
        return {
          seq: index,
          title: item.title,
          content: item.content,
          timestampSeconds: pickTimestampSeconds(
            parseTimestampCandidates(item.timestamp),
          ),
          frameDescription: item.frameDescription,
          screenshotUrl,
        };
      });

      await this.db.upsertSummaryKnowledge({
        bvid,
        cid,
        videoTitle: input.videoTitle,
        videoUrl: input.videoUrl,
        modelName: input.modelName,
        rawResponse: input.rawResponse,
        segments,
      });

      // 重写本地 md：相对图片链接 → COS 公网 URL（绝对 URL 原样保留）
      const rewritten = rewriteMarkdownImages(md, urlByRelPath);
      if (rewritten !== md) {
        await writeFile(input.summaryPath, rewritten, "utf-8");
      }

      await this.db.updateSummaryKnowledgeStatus(bvid, cid, "synced");
      this.logger.log(
        createLogMessage("Summary knowledge published", {
          bvid,
          cid,
          segmentCount: segments.length,
          uploadedImageCount: Object.keys(urlByRelPath).length,
        }),
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.db.updateSummaryKnowledgeStatus(bvid, cid, "failed", message);
      this.logger.error(
        createLogMessage("Summary knowledge publish failed", {
          bvid,
          cid,
          error: message,
        }),
      );
      throw err;
    }
  }
}

function extractImageUrls(md: string): string[] {
  const urls: string[] = [];
  let match: RegExpExecArray | null;
  IMAGE_RE.lastIndex = 0;
  while ((match = IMAGE_RE.exec(md)) !== null) {
    urls.push(match[2]);
  }
  return urls;
}
