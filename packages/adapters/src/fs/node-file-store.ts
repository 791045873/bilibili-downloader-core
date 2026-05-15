/**
 * Node.js 文件系统适配器
 */

import { mkdir, rm, access, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { FileStorePort } from "@bilibili-downloader/core/ports";

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
    } catch {
      // 清理失败不抛出
    }
  }

  async exists(filePath: string): Promise<boolean> {
    try {
      await access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  async getFileSize(filePath: string): Promise<number> {
    const s = await stat(filePath);
    return s.size;
  }
}