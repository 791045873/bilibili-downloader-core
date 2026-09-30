import { ConsoleLogger, LogLevel } from "@nestjs/common";
import { mkdirSync } from "node:fs";
import { createStream, RotatingFileStream } from "rotating-file-stream";

const LOG_DIR = process.env.LOG_DIR;
const LOG_MAX_FILES = Number.parseInt(process.env.LOG_MAX_FILES ?? "7", 10);

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function formatDate(time: number | Date): string {
  const date = time instanceof Date ? time : new Date(time);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function createLogStream(logDir: string): RotatingFileStream | undefined {
  try {
    mkdirSync(logDir, { recursive: true });
    return createStream(
      (time: number | Date) => `server-${formatDate(time ?? Date.now())}.log`,
      {
        path: logDir,
        interval: "1d",
        maxFiles: Math.max(1, LOG_MAX_FILES),
      },
    );
  } catch {
    return undefined;
  }
}

const fileStream = LOG_DIR ? createLogStream(LOG_DIR) : undefined;

function writeLine(level: string, text: string, stack?: string): void {
  if (!fileStream) {
    return;
  }
  const timestamp = new Date().toISOString();
  fileStream.write(`[${timestamp}] [${level}] ${text}${stack ? `\n${stack}` : ""}\n`);
}

function formatMessage(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  const serialized = JSON.stringify(value, undefined, 2);
  return serialized ?? String(value);
}

export class FileConsoleLogger extends ConsoleLogger {
  constructor(context?: string, options?: { logLevels?: LogLevel[] }) {
    super(context ?? "");
    if (options?.logLevels) {
      this.setLogLevels(options.logLevels);
    }
  }

  override log(message: unknown, ...optionalParams: unknown[]): void {
    super.log(message, ...(optionalParams as any[]));
    this.writeToFile("LOG", [message, ...optionalParams]);
  }

  override error(message: unknown, ...optionalParams: unknown[]): void {
    super.error(message, ...(optionalParams as any[]));
    this.writeToFile("ERROR", [message, ...optionalParams], true);
  }

  override warn(message: unknown, ...optionalParams: unknown[]): void {
    super.warn(message, ...(optionalParams as any[]));
    this.writeToFile("WARN", [message, ...optionalParams]);
  }

  override debug(message: unknown, ...optionalParams: unknown[]): void {
    super.debug(message, ...(optionalParams as any[]));
    this.writeToFile("DEBUG", [message, ...optionalParams]);
  }

  override verbose(message: unknown, ...optionalParams: unknown[]): void {
    super.verbose(message, ...(optionalParams as any[]));
    this.writeToFile("VERBOSE", [message, ...optionalParams]);
  }

  override fatal(message: unknown, ...optionalParams: unknown[]): void {
    super.fatal(message, ...(optionalParams as any[]));
    this.writeToFile("FATAL", [message, ...optionalParams], true);
  }

  private writeToFile(
    level: string,
    args: unknown[],
    withStack = false,
  ): void {
    if (!fileStream) {
      return;
    }
    if (!this.isLevelEnabled(level.toLowerCase() as LogLevel)) {
      return;
    }

    let messages: unknown[];
    let context: string | undefined;
    let stack: string | undefined;

    if (withStack) {
      const parsed = this.getContextAndStackAndMessagesToPrint(args);
      messages = parsed.messages;
      context = parsed.context;
      stack = parsed.stack;
    } else {
      const parsed = this.getContextAndMessagesToPrint(args);
      messages = parsed.messages;
      context = parsed.context;
    }

    const text = messages.map(formatMessage).join(" ");
    const contextSuffix = context ? ` [${context}]` : "";
    writeLine(level, `${text}${contextSuffix}`, stack);
  }
}
