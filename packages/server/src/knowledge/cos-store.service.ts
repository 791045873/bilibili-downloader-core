/**
 * 腾讯云对象存储（COS）薄封装
 *
 * 职责：配置读取、对象上传、公网 URL 生成。
 * 仅依赖 .env 的 TENCENT_COS_SECRET_ID/KEY/REGION/BUCKET（与官方 SDK 文档核对：Bucket 需 BucketName-APPID 格式）。
 * 缺配置时不实例化客户端，isConfigured() 返回 false，调用方据此跳过发布。
 */

import { Injectable, Logger } from "@nestjs/common";
import COS from "cos-nodejs-sdk-v5";
import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { createLogMessage } from "../logging/server-log.util.js";

@Injectable()
export class CosStoreService {
  private readonly logger = new Logger(CosStoreService.name);
  private readonly cos: COS | undefined;
  private readonly bucket: string | undefined;
  private readonly region: string | undefined;
  private readonly publicUrlPrefix: string | undefined;

  constructor() {
    const secretId = process.env.TENCENT_COS_SECRET_ID;
    const secretKey = process.env.TENCENT_COS_SECRET_KEY;
    this.bucket = process.env.TENCENT_COS_BUCKET;
    this.region = process.env.TENCENT_COS_REGION;

    const customPrefix = process.env.TENCENT_COS_PUBLIC_URL_PREFIX;
    this.publicUrlPrefix =
      customPrefix ||
      (this.bucket && this.region
        ? `https://${this.bucket}.cos.${this.region}.myqcloud.com`
        : undefined);

    if (!secretId || !secretKey || !this.bucket || !this.region) {
      this.logger.warn(
        createLogMessage(
          "COS store not configured; knowledge publish to COS is disabled",
          {
            hasSecretId: Boolean(secretId),
            hasSecretKey: Boolean(secretKey),
            hasBucket: Boolean(this.bucket),
            hasRegion: Boolean(this.region),
          },
        ),
      );
      return;
    }

    this.cos = new COS({ SecretId: secretId, SecretKey: secretKey });
    this.logger.log(
      createLogMessage("COS store configured", {
        bucket: this.bucket,
        region: this.region,
        publicUrlPrefix: this.publicUrlPrefix,
      }),
    );
  }

  isConfigured(): boolean {
    return this.cos !== undefined;
  }

  /**
   * 上传本地文件到 COS，返回公网 URL。
   * @param localPath 本地文件绝对路径
   * @param key 对象键（如 summary/<bvid>-<cid>/screenshots/segment-0.jpg）
   */
  async upload(localPath: string, key: string): Promise<string> {
    if (!this.cos || !this.bucket || !this.region) {
      throw new Error("COS 未配置，无法上传");
    }
    const body = await readFile(localPath);
    await new Promise<void>((resolve, reject) => {
      this.cos!.putObject(
        {
          Bucket: this.bucket!,
          Region: this.region!,
          Key: key,
          Body: body,
          ContentType: contentTypeFor(localPath),
        },
        (err: unknown) => {
          if (err) {
            const message =
              typeof err === "object" && err && "message" in err
                ? String((err as { message?: unknown }).message)
                : String(err);
            reject(new Error(`COS 上传失败（${key}）: ${message}`));
          } else {
            resolve();
          }
        },
      );
    });
    return this.publicUrl(key);
  }

  /** 生成对象公网 URL（需 bucket 公网读） */
  publicUrl(key: string): string {
    if (!this.publicUrlPrefix) {
      throw new Error("COS 未配置，无法生成 URL");
    }
    return `${this.publicUrlPrefix}/${key}`;
  }
}

function contentTypeFor(localPath: string): string {
  switch (extname(localPath).toLowerCase()) {
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".png":
      return "image/png";
    case ".webp":
      return "image/webp";
    default:
      return "application/octet-stream";
  }
}
