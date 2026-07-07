import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { DatabaseModule } from "./database/database.module.js";
import { DownloadModule } from "./download/download.module.js";
import { AnalysisModule } from "./analysis/analysis.module.js";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ["packages/server/.env", ".env"],
    }),
    DatabaseModule,
    DownloadModule,
    AnalysisModule,
  ],
})
export class AppModule {}