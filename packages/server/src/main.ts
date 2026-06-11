import { NestFactory } from "@nestjs/core";
import { NestExpressApplication } from "@nestjs/platform-express";
import { AppModule } from "./app.module.js";
import { existsSync } from "node:fs";
import { join } from "node:path";

const PORT = Number.parseInt(process.env.PORT ?? "3000", 10);
const publicDir = join(process.cwd(), "public");

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  if (existsSync(publicDir)) {
    app.useStaticAssets(publicDir);
  }

  await app.listen(PORT);

  console.log(`\n🚀 Bilibili 下载器后端已启动 (NestJS)`);
  console.log(`   API 地址: http://localhost:${PORT}`);
  console.log(`   输出目录: ${process.env.OUTPUT_DIR ?? "./downloads"}`);

  if (existsSync(publicDir)) {
    console.log(`   前端静态资源目录: ${publicDir}\n`);
    return;
  }

  console.log(`   当前模式: 本地开发（前端需单独运行 Vite）`);
  console.log("   前端开发地址: 请查看 Vite 启动日志（默认 http://localhost:5173）\n");
}

bootstrap().catch((err: unknown) => {
  if (
    err instanceof Error &&
    "code" in err &&
    err.code === "EADDRINUSE"
  ) {
    console.error(`端口 ${PORT} 已被占用，后端服务未能启动。`);
    console.error("如果你在本地联调，请确认是否已有旧的 server 进程仍在运行。\n");
    process.exit(1);
  }

  console.error("后端启动失败:", err);
  process.exit(1);
});
