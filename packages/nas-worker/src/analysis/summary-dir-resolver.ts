import { Logger } from "@nestjs/common";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import type { TaskRecord } from "@bilibili-downloader/server-common";
import { createLogMessage } from "@bilibili-downloader/server-common";
import { sanitizeFileName } from "../download/file-naming.js";

const logger = new Logger("SummaryDirResolver");

/**
 * 解析某任务的 summary 目录（base 为 PathsService.SUMMARY_BASE_DIR）。
 * 命名：{标题}-{bvid}-{cid}（标题完整不截断，非法字符清洗）。
 * 同资源已存在 summary 目录则复用（标题变化不产生孤儿目录），优先精确匹配候选名。
 */
export function resolveSummaryDir(base: string, task: TaskRecord): string {
  const bvid = task.bvid;
  const cid = task.cid;
  if (!bvid || typeof cid !== "number") {
    return join(base, "analysis");
  }

  const titleBase = (task.title ?? "").trim();
  const titlePart = titleBase ? sanitizeFileName(titleBase) : "";
  const candidateName = titlePart
    ? `${titlePart}-${bvid}-${cid}`
    : `${bvid}-${cid}`;
  const suffix = `-${bvid}-${cid}`;

  let existingDir: string | undefined;
  try {
    existingDir = readdirSync(base, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort((a, b) => {
        const aExact = a === candidateName ? -1 : 0;
        const bExact = b === candidateName ? -1 : 0;
        return aExact - bExact || a.localeCompare(b);
      })
      .find(
        (n) => n === candidateName || n.endsWith(suffix) || n === `${bvid}-${cid}`,
      );
  } catch {
    // summaryDir 尚不存在，忽略
  }

  if (existingDir && existingDir !== candidateName) {
    logger.log(
      createLogMessage(
        "Analysis reusing existing summary directory for resource",
        { bvid, cid, existingDir, candidateName },
      ),
    );
  }
  return join(base, existingDir ?? candidateName);
}
