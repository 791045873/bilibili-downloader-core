/**
 * Node.js 文件系统适配器
 */

import { mkdir, rm, access, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { FileStorePort } from "@bilibili-downloader/core/ports";
import { logger } from "../logger.js";
import { summarizePath, summarizeText } from "../safe-error-context.js";

export class NodeFileStore implements FileStorePort {
  async ensureOutputDir(outputDir: string): Promise<void> {
    await mkdir(outputDir, { recursive: true });
  }

  async createTempDir(): Promise<string> {
    const dir = join(tmpdir(), `bilibili-downloader-${randomUUID()}`);
    await mkdir(dir, { recursive: true });
    return dir;
  }

  async cleanTempDir(tempDir: string): Promise<void> {
    try {
      await rm(tempDir, { recursive: true, force: true });
    } catch (err) {
      logger.warn(
        `临时目录清理失败，继续主流程: path=${summarizePath(tempDir)}, reason=${summarizeText((err as Error).message)}`,
      );
      // 清理失败不抛出
    }
  }

  async exists(filePath: string): Promise<boolean> {
    try {
      await access(filePath);
      return true;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") {
        logger.warn(
          `文件存在性检查失败，按不存在处理: path=${summarizePath(filePath)}, code=${code ?? "unknown"}, reason=${summarizeText((err as Error).message)}`,
        );
      }
      return false;
    }
  }

  async getFileSize(filePath: string): Promise<number> {
    const s = await stat(filePath);
    return s.size;
  }
}
