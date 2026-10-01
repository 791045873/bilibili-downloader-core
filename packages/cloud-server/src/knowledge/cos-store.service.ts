/**
 * 腾讯云对象存储（COS）Nest wrapper
 *
 * 读取 .env 的 TENCENT_COS_SECRET_ID/KEY/REGION/BUCKET（Bucket 需 BucketName-APPID 格式）
 * 并委托 `@bilibili-downloader/adapters` 的 `CosClient`（Phase 3 Stage B-5 下沉，cloud/nas 共用）。
 * 缺配置时 isConfigured() 返回 false，调用方据此跳过发布。
 */

import { Injectable, Logger } from "@nestjs/common";
import { CosClient, resolvePublicUrlPrefix } from "@bilibili-downloader/adapters/cos";
import { createLogMessage } from "@bilibili-downloader/server-common";

@Injectable()
export class CosStoreService {
  private readonly logger = new Logger(CosStoreService.name);
  private readonly client: CosClient;

  constructor() {
    const config = {
      secretId: process.env.TENCENT_COS_SECRET_ID,
      secretKey: process.env.TENCENT_COS_SECRET_KEY,
      bucket: process.env.TENCENT_COS_BUCKET,
      region: process.env.TENCENT_COS_REGION,
      publicUrlPrefix: process.env.TENCENT_COS_PUBLIC_URL_PREFIX,
    };
    this.client = new CosClient(config);
    if (this.client.isConfigured()) {
      this.logger.log(
        createLogMessage("COS store configured", {
          bucket: config.bucket,
          region: config.region,
          publicUrlPrefix: resolvePublicUrlPrefix(config),
        }),
      );
    } else {
      this.logger.warn(
        createLogMessage(
          "COS store not configured; knowledge publish to COS is disabled",
          {
            hasSecretId: Boolean(config.secretId),
            hasSecretKey: Boolean(config.secretKey),
            hasBucket: Boolean(config.bucket),
            hasRegion: Boolean(config.region),
          },
        ),
      );
    }
  }

  isConfigured(): boolean {
    return this.client.isConfigured();
  }

  /** 上传本地文件到 COS，返回公网 URL。 */
  upload(localPath: string, key: string): Promise<string> {
    return this.client.upload(localPath, key);
  }

  /** 上传内存 Buffer 到 COS，返回公网 URL（问答用户照片等无本地落盘场景）。 */
  uploadBuffer(buffer: Buffer, key: string, contentType: string): Promise<string> {
    return this.client.uploadBuffer(buffer, key, contentType);
  }

  /** 生成对象公网 URL（需 bucket 公网读） */
  publicUrl(key: string): string {
    return this.client.publicUrl(key);
  }
}
