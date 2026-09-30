import { Module, Global } from "@nestjs/common";
import { DatabaseService } from "./database.service.js";
import { PrismaModule } from "./prisma.module.js";

@Global()
@Module({
  imports: [PrismaModule],
  providers: [DatabaseService],
  exports: [DatabaseService],
})
export class DatabaseModule {}