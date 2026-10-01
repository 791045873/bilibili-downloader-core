import "reflect-metadata";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { createLogMessage, FileConsoleLogger } from "@bilibili-downloader/server-common";
import { AppModule } from "./app.module.js";

const logger = new Logger("NasWorkerBootstrap");

async function bootstrap() {
  // 无对外 HTTP：仅应用上下文，worker 轮询由 WorkerService 的 onModuleInit 驱动（后续子步迁入）。
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: new FileConsoleLogger(),
  });
  app.enableShutdownHooks();
  logger.log(createLogMessage("nas-worker 已启动（应用上下文，无 HTTP）", {}));
}

bootstrap().catch((err: unknown) => {
  logger.error(
    "nas-worker 启动失败",
    err instanceof Error ? err.stack : String(err),
  );
  process.exit(1);
});
