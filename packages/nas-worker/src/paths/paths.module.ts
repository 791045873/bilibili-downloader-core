import { Global, Module } from "@nestjs/common";
import { PathsService } from "./paths.service.js";

@Global()
@Module({
  providers: [PathsService],
  exports: [PathsService],
})
export class PathsModule {}
