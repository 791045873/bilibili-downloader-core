/**
 * 任务持久化存储
 *
 * 使用 JSON 文件保存下载任务历史，支持查询和恢复
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { DownloadRequest } from "@bilibili-downloader/core/domain";
import { TaskStatus } from "@bilibili-downloader/core/domain";
import { logger } from "./logger.js";

/** 持久化的任务记录 */
export interface TaskRecord {
  /** 唯一 ID */
  id: string;
  /** 原始下载请求 */
  request: DownloadRequest;
  /** 任务状态 */
  status: TaskStatus;
  /** 输出文件路径 (成功时) */
  outputFile?: string;
  /** 错误信息 (失败时) */
  errorMessage?: string;
  /** 创建时间 */
  createdAt: string;
  /** 完成时间 */
  completedAt?: string;
  /** 耗时 (毫秒) */
  durationMs?: number;
}

interface TaskStoreData {
  version: 1;
  updatedAt: string;
  tasks: TaskRecord[];
}

export class TaskStore {
  private filePath: string;
  private cache: TaskStoreData | null = null;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  async load(): Promise<TaskRecord[]> {
    try {
      const content = await readFile(this.filePath, "utf-8");
      const data: TaskStoreData = JSON.parse(content);
      this.cache = data;
      return data.tasks;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        logger.error("加载任务记录失败:", (err as Error).message);
      }
      this.cache = { version: 1, updatedAt: new Date().toISOString(), tasks: [] };
      return [];
    }
  }

  async save(record: TaskRecord): Promise<void> {
    if (!this.cache) await this.load();

    // 更新或新增
    const idx = this.cache!.tasks.findIndex((t) => t.id === record.id);
    if (idx >= 0) {
      this.cache!.tasks[idx] = record;
    } else {
      this.cache!.tasks.push(record);
    }

    this.cache!.updatedAt = new Date().toISOString();

    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(this.cache, null, 2), "utf-8");
    logger.debug("任务记录已保存:", record.id);
  }

  async findByStatus(status: TaskStatus): Promise<TaskRecord[]> {
    if (!this.cache) await this.load();
    return this.cache!.tasks.filter((t) => t.status === status);
  }

  async findRecent(limit = 10): Promise<TaskRecord[]> {
    if (!this.cache) await this.load();
    return this.cache!.tasks.slice(-limit).reverse();
  }

  async clear(): Promise<void> {
    this.cache = { version: 1, updatedAt: new Date().toISOString(), tasks: [] };
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(this.cache, null, 2), "utf-8");
  }

  async delete(id: string): Promise<void> {
    if (!this.cache) await this.load();
    this.cache!.tasks = this.cache!.tasks.filter((t) => t.id !== id);
    this.cache!.updatedAt = new Date().toISOString();
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(this.cache, null, 2), "utf-8");
  }
}