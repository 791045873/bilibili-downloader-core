import { Module } from "@nestjs/common";
import { ParseController } from "./parse.controller.js";
import { ParseService } from "./parse.service.js";

@Module({
  controllers: [ParseController],
  providers: [ParseService],
})
export class ParseModule {}
