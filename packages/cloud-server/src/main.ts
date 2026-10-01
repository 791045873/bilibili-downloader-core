import "reflect-metadata";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { NestExpressApplication } from "@nestjs/platform-express";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createLogMessage, FileConsoleLogger } from "@bilibili-downloader/server-common";
import { AppModule } from "./app.module.js";

const PORT = Number.parseInt(process.env.PORT ?? "3100", 10);
const publicDir = join(process.cwd(), "public");
const logger = new Logger("CloudBootstrap");

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.useLogger(new FileConsoleLogger());

  // 前端静态产物（非媒体目录）；不 join 任何 DOWNLOAD_ROOT 媒体路径。
  if (existsSync(publicDir)) {
    app.useStaticAssets(publicDir);
  }

  await app.listen(PORT);
  logger.log(
    createLogMessage("cloud-server 已启动 (NestJS)", {
      route: `http://localhost:${PORT}`,
    }),
  );
}

bootstrap().catch((err: unknown) => {
  logger.error(
    "cloud-server 启动失败",
    err instanceof Error ? err.stack : String(err),
  );
  process.exit(1);
});
