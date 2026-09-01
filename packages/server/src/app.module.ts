import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { APP_INTERCEPTOR } from "@nestjs/core";
import { DatabaseModule } from "./database/database.module.js";
import { PrismaModule } from "./database/prisma.module.js";
import { DownloadModule } from "./download/download.module.js";
import { AnalysisModule } from "./analysis/analysis.module.js";
import { ParseModule } from "./parse/parse.module.js";
import { NotificationModule } from "./notification/notification.module.js";
import { RequestLoggingInterceptor } from "./logging/request-logging.interceptor.js";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ["packages/server/.env", ".env"],
    }),
    DatabaseModule,
    PrismaModule,
    DownloadModule,
    AnalysisModule,
    ParseModule,
    NotificationModule,
  ],
  providers: [
    {
      provide: APP_INTERCEPTOR,
      useClass: RequestLoggingInterceptor,
    },
  ],
})
export class AppModule {}
