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
import { DatabaseService } from "@bilibili-downloader/server-common";
import { getChatConfig } from "./chat-config.js";
import { ChatPhotoService } from "./chat-photo.service.js";
import { ChatService } from "./chat.service.js";
import type { ChatPhotoFile, ChatReplyPayload } from "./chat.types.js";
import { ROLE_ADMIN, ROLE_USER } from "../user-auth/auth.constants.js";
import type { AuthUser } from "../user-auth/auth.constants.js";
import { CurrentUser, Roles } from "../user-auth/auth.decorators.js";

export interface SendMessageResponse {
  userMessageId: number;
  assistantMessageId: number | null;
  reply: ChatReplyPayload;
}

// QA 为普通 user 的唯一可用面；会话按 user_id 隔离（含 admin 只见自己的会话）
@Roles(ROLE_ADMIN, ROLE_USER)
@Controller("api/chat")
export class ChatController {
  constructor(
    private readonly db: DatabaseService,
    private readonly photos: ChatPhotoService,
    private readonly chat: ChatService,
  ) {}

  @Post("conversations")
  @HttpCode(200)
  async createConversation(@CurrentUser() user: AuthUser) {
    const id = await this.db.createConversation(undefined, user.id);
    return { conversationId: id };
  }

  @Get("conversations")
  async listConversations(@CurrentUser() user: AuthUser) {
    return { conversations: await this.db.listConversations(user.id) };
  }

  @Get("conversations/:id/messages")
  async listMessages(
    @Param("id", ParseIntPipe) id: number,
    @CurrentUser() user: AuthUser,
  ) {
    await this.requireConversation(id, user.id);
    return { messages: await this.db.listMessages(id) };
  }

  @Post("conversations/:id/photos")
  @UseInterceptors(AnyFilesInterceptor())
  async uploadPhotos(
    @Param("id", ParseIntPipe) id: number,
    @CurrentUser() user: AuthUser,
    @UploadedFiles() files: ChatPhotoFile[] = [],
  ) {
    await this.requireConversation(id, user.id);
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
    @CurrentUser() user: AuthUser,
    @Body() body: { content?: string; photoUrls?: string[] },
  ): Promise<SendMessageResponse> {
    const content = (body.content ?? "").trim();
    const photoUrls = (body.photoUrls ?? []).filter(
      (url) => typeof url === "string" && url.trim() !== "",
    );
    if (content === "" && photoUrls.length === 0) {
      throw new BadRequestException("消息内容与照片不能同时为空");
    }
    await this.requireConversation(id, user.id);
    return this.chat.handleUserMessage(id, content, photoUrls);
  }

  @Delete("conversations/:id")
  async deleteConversation(
    @Param("id", ParseIntPipe) id: number,
    @CurrentUser() user: AuthUser,
  ) {
    await this.requireConversation(id, user.id);
    await this.db.deleteConversation(id);
    return { deleted: true };
  }

  /** 归属校验：非本人（或不存在/已删除）统一 404，避免 id 枚举 */
  private async requireConversation(id: number, userId: number): Promise<void> {
    const conversation = await this.db.getConversation(id, userId);
    if (!conversation) {
      throw new NotFoundException(`会话不存在（id=${id}）`);
    }
  }
}
