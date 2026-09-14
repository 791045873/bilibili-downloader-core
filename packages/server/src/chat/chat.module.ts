import { Module } from "@nestjs/common";
import { AnalysisModule } from "../analysis/analysis.module.js";
import { ChatController } from "./chat.controller.js";
import { ChatPhotoService } from "./chat-photo.service.js";
import { ChatService } from "./chat.service.js";

@Module({
  imports: [AnalysisModule],
  controllers: [ChatController],
  providers: [ChatService, ChatPhotoService],
})
export class ChatModule {}
