import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
  UploadedFiles,
  UseInterceptors,
} from "@nestjs/common";
import { AnyFilesInterceptor } from "@nestjs/platform-express";
import { DatabaseService } from "../database/database.service.js";
import { getChatConfig } from "./chat-config.js";
import { ChatPhotoService } from "./chat-photo.service.js";
import { ChatService } from "./chat.service.js";
import type { ChatPhotoFile, ChatReplyPayload } from "./chat.types.js";

export interface SendMessageResponse {
  userMessageId: number;
  assistantMessageId: number | null;
  reply: ChatReplyPayload;
}

@Controller("api/chat")
export class ChatController {
  constructor(
    private readonly db: DatabaseService,
    private readonly photos: ChatPhotoService,
    private readonly chat: ChatService,
  ) {}

  @Post("conversations")
  @HttpCode(200)
  async createConversation() {
    const id = await this.db.createConversation();
    return { conversationId: id };
  }

  @Get("conversations")
  async listConversations() {
    return { conversations: await this.db.listConversations() };
  }

  @Get("conversations/:id/messages")
  async listMessages(@Param("id", ParseIntPipe) id: number) {
    await this.requireConversation(id);
    return { messages: await this.db.listMessages(id) };
  }

  @Post("conversations/:id/photos")
  @UseInterceptors(AnyFilesInterceptor())
  async uploadPhotos(
    @Param("id", ParseIntPipe) id: number,
    @UploadedFiles() files: ChatPhotoFile[] = [],
  ) {
    await this.requireConversation(id);
    const config = getChatConfig();
    if (files.length === 0) {
      return { photoUrls: [] as string[] };
    }
    if (files.length > config.photoMaxPerMessage) {
      throw new BadRequestException(
        `单条消息最多上传 ${config.photoMaxPerMessage} 张照片`,
      );
    }
    const photoUrls = await this.photos.savePhotos(id, files);
    return { photoUrls };
  }

  @Post("conversations/:id/messages")
  @HttpCode(200)
  async sendMessage(
    @Param("id", ParseIntPipe) id: number,
    @Body() body: { content?: string; photoUrls?: string[] },
  ): Promise<SendMessageResponse> {
    const content = (body.content ?? "").trim();
    const photoUrls = (body.photoUrls ?? []).filter(
      (url) => typeof url === "string" && url.trim() !== "",
    );
    if (content === "" && photoUrls.length === 0) {
      throw new BadRequestException("消息内容与照片不能同时为空");
    }
    await this.requireConversation(id);
    return this.chat.handleUserMessage(id, content, photoUrls);
  }

  @Delete("conversations/:id")
  async deleteConversation(@Param("id", ParseIntPipe) id: number) {
    await this.requireConversation(id);
    await this.db.deleteConversation(id);
    return { deleted: true };
  }

  private async requireConversation(id: number): Promise<void> {
    const conversation = await this.db.getConversation(id);
    if (!conversation) {
      throw new NotFoundException(`会话不存在（id=${id}）`);
    }
  }
}
