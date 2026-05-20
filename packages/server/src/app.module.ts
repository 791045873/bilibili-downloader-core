import { Module } from "@nestjs/common";
import { DatabaseModule } from "./database/database.module.js";
import { DownloadModule } from "./download/download.module.js";

@Module({
  imports: [DatabaseModule, DownloadModule],
})
export class AppModule {}