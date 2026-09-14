/**
 * 问答用户照片：校验 → 压缩 → 上传 COS 专属目录（user-photos/）。
 * 照片仅服务当前会话（分析上下文 + 视觉输入），不进入知识库；
 * COS 文件随专属前缀目录统一后续清理（见需求 Business Rules）。
 */

import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { CosStoreService } from "../knowledge/cos-store.service.js";
import { createLogMessage } from "../logging/server-log.util.js";
import { getChatConfig } from "./chat-config.js";
import type { ChatPhotoFile } from "./chat.types.js";

const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);
const COS_USER_PHOTOS_PREFIX = "user-photos";

@Injectable()
export class ChatPhotoService {
  private readonly logger = new Logger(ChatPhotoService.name);

  constructor(private readonly cos: CosStoreService) {}

  /**
   * 保存单条消息的照片（已在 controller 层校验数量）：
   * 压缩一次（最长边 PHOTO_MAX_EDGE / JPEG 质量 PHOTO_JPEG_QUALITY，EXIF 方向修正）
   * → COS user-photos/<conversationId>/<uuid>.jpg → 返回公网 URL 列表。
   */
  async savePhotos(
    conversationId: number,
    files: ChatPhotoFile[],
  ): Promise<string[]> {
    if (!this.cos.isConfigured()) {
      throw new ServiceUnavailableException(
        "COS 未配置，无法上传问答照片（需设置 TENCENT_COS_*）",
      );
    }
    const config = getChatConfig();
    const urls: string[] = [];
    for (const file of files) {
      urls.push(await this.saveOne(conversationId, file, config));
    }
    return urls;
  }

  private async saveOne(
    conversationId: number,
    file: ChatPhotoFile,
    config: ReturnType<typeof getChatConfig>,
  ): Promise<string> {
    if (!file.buffer || file.size === 0) {
      throw new BadRequestException("照片内容为空");
    }
    if (!ALLOWED_MIME.has(file.mimetype)) {
      throw new BadRequestException(
        `不支持的照片格式：${file.mimetype}（仅支持 jpeg/png/webp）`,
      );
    }
    const maxBytes = config.photoMaxUploadMb * 1024 * 1024;
    if (file.size > maxBytes) {
      throw new BadRequestException(
        `照片超过大小上限（${config.photoMaxUploadMb}MB）`,
      );
    }

    let compressed: Buffer;
    try {
      compressed = await sharp(file.buffer)
        .rotate()
        .resize({
          width: config.photoMaxEdge,
          height: config.photoMaxEdge,
          fit: "inside",
          withoutEnlargement: true,
        })
        .jpeg({ quality: config.photoJpegQuality })
        .toBuffer();
    } catch (error) {
      throw new BadRequestException(
        `照片解析/压缩失败: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    const key = `${COS_USER_PHOTOS_PREFIX}/${conversationId}/${randomUUID()}.jpg`;
    try {
      const url = await this.cos.uploadBuffer(compressed, key, "image/jpeg");
      this.logger.log(
        createLogMessage("Saved chat user photo to COS", {
          conversationId,
          key,
          originalBytes: file.size,
          compressedBytes: compressed.length,
        }),
      );
      return url;
    } catch (error) {
      throw new ServiceUnavailableException(
        `照片上传 COS 失败: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
