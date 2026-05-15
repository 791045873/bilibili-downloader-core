/**
 * 日志管理器
 *
 * 支持文件输出 + 控制台输出，异步写入
 */

import { createWriteStream, type WriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

export interface LoggerOptions {
  /** 日志文件路径，不指定则只输出到控制台 */
  filePath?: string;
  /** 最低日志级别，默认 INFO */
  level?: LogLevel;
}

export class Logger {
  private stream: WriteStream | null = null;
  private level: LogLevel;

  constructor(options: LoggerOptions = {}) {
    this.level = options.level ?? LogLevel.INFO;
    if (options.filePath) {
      this.initFile(options.filePath);
    }
  }

  private async initFile(filePath: string): Promise<void> {
    await mkdir(dirname(filePath), { recursive: true });
    this.stream = createWriteStream(filePath, { flags: "a" });
  }

  debug(message: string, ...args: unknown[]): void {
    this.log(LogLevel.DEBUG, "DEBUG", message, args);
  }

  info(message: string, ...args: unknown[]): void {
    this.log(LogLevel.INFO, "INFO", message, args);
  }

  warn(message: string, ...args: unknown[]): void {
    this.log(LogLevel.WARN, "WARN", message, args);
  }

  error(message: string, ...args: unknown[]): void {
    this.log(LogLevel.ERROR, "ERROR", message, args);
  }

  private log(level: LogLevel, tag: string, message: string, args: unknown[]): void {
    if (level < this.level) return;

    const timestamp = new Date().toISOString();
    const line = args.length > 0
      ? `[${timestamp}] [${tag}] ${message} ${args.map(a => JSON.stringify(a)).join(" ")}`
      : `[${timestamp}] [${tag}] ${message}`;

    // 控制台
    if (level >= LogLevel.WARN) {
      console.error(line);
    } else {
      console.log(line);
    }

    // 文件
    if (this.stream) {
      this.stream.write(line + "\n");
    }
  }

  close(): void {
    this.stream?.end();
  }
}

/** 默认全局 Logger 实例 */
export const logger = new Logger();