import { NestFactory } from "@nestjs/core";
import { NestExpressApplication } from "@nestjs/platform-express";
import { AppModule } from "./app.module.js";
import { existsSync } from "node:fs";
import { join } from "node:path";

const PORT = Number.parseInt(process.env.PORT ?? "3000", 10);

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // 生产环境 (Docker) 下托管前端静态文件
  // 前端构建产物在 Docker 镜像中位于 /app/public
  const publicDir = join(process.cwd(), "public");
  if (existsSync(publicDir)) {
    app.useStaticAssets(publicDir);
    console.log(`   📁 静态文件目录: ${publicDir}`);
  }

  await app.listen(PORT);
  console.log(`\n🚀 Bilibili 下载器已启动 (NestJS)`);
  console.log(`   Web 界面: http://localhost:${PORT}`);
  console.log(`   输出目录: ${process.env.OUTPUT_DIR ?? "./downloads"}\n`);
}

bootstrap().catch((err) => {
  console.error("启动失败:", err);
  process.exit(1);
});