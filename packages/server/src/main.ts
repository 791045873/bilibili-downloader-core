import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { NestExpressApplication } from "@nestjs/platform-express";
import { AppModule } from "./app.module.js";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createLogMessage } from "./logging/server-log.util.js";
import { FileConsoleLogger } from "./logging/file-logger.js";

const PORT = Number.parseInt(process.env.PORT ?? "3100", 10);
const publicDir = join(process.cwd(), "public");
const logger = new Logger("Bootstrap");

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.useLogger(new FileConsoleLogger());

  if (existsSync(publicDir)) {
    app.useStaticAssets(publicDir);
  }

  await app.listen(PORT);

  logger.log(
    createLogMessage("Bilibili 下载器后端已启动 (NestJS)", {
      route: `http://localhost:${PORT}`,
      outputPath: process.env.OUTPUT_DIR ?? "./downloads",
    }),
  );

  if (existsSync(publicDir)) {
    logger.log(
      createLogMessage("前端静态资源目录已挂载", {
        outputPath: publicDir,
        sourceType: "static-assets",
      }),
    );
    return;
  }

  logger.log(
    createLogMessage("当前模式为本地开发，前端需单独运行 Vite", {
      sourceType: "frontend-dev",
      route: "http://localhost:5173",
    }),
  );
}

bootstrap().catch((err: unknown) => {
  if (err instanceof Error && "code" in err && err.code === "EADDRINUSE") {
    logger.error(
      `端口 ${PORT} 已被占用，后端服务未能启动。`,
      err instanceof Error ? err.stack : undefined,
    );
    logger.error("如果你在本地联调，请确认是否已有旧的 server 进程仍在运行。");
    process.exit(1);
  }

  logger.error("后端启动失败", err instanceof Error ? err.stack : String(err));
  process.exit(1);
});
