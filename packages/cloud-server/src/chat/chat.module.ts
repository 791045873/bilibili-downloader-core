import { Module } from "@nestjs/common";
import { KnowledgeModule } from "../knowledge/knowledge.module.js";
import { ChatController } from "./chat.controller.js";
import { ChatPhotoService } from "./chat-photo.service.js";
import { ChatService } from "./chat.service.js";

@Module({
  imports: [KnowledgeModule],
  controllers: [ChatController],
  providers: [ChatService, ChatPhotoService],
})
export class ChatModule {}
