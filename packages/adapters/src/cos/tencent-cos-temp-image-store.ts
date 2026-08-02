/**
 * 腾讯云 COS 临时图片存储
 *
 * 用于把本地截图短暂暴露为可被远端多模态模型访问的签名 URL。
 */

import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import COS from "cos-nodejs-sdk-v5";
import { logger } from "../logger.js";
import { summarizeText } from "../safe-error-context.js";

export interface TencentCosConfig {
  secretId: string;
  secretKey: string;
  bucket: string;
  region: string;
  tempPrefix?: string;
  signedUrlExpiresSeconds?: number;
}

export interface UploadTempImagesParams {
  files: string[];
  keyPrefix: string;
}

export interface UploadedTempImage {
  localPath: string;
  key: string;
  url: string;
}

export interface TempImageStore {
  uploadImages(params: UploadTempImagesParams): Promise<UploadedTempImage[]>;
  deleteObjects(keys: string[]): Promise<void>;
}

export class TencentCosTempImageStore implements TempImageStore {
  private readonly client: COS;
  private readonly bucket: string;
  private readonly region: string;
  private readonly tempPrefix: string;
  private readonly signedUrlExpiresSeconds: number;

  constructor(config: TencentCosConfig) {
    this.client = new COS({
      SecretId: config.secretId,
      SecretKey: config.secretKey,
    });
    this.bucket = config.bucket;
    this.region = config.region;
    this.tempPrefix = normalizePrefix(
      config.tempPrefix ?? "bilibili-downloader-temp/analysis",
    );
    this.signedUrlExpiresSeconds = config.signedUrlExpiresSeconds ?? 3600;
  }

  async uploadImages(
    params: UploadTempImagesParams,
  ): Promise<UploadedTempImage[]> {
    const uploaded: UploadedTempImage[] = [];

    try {
      for (const file of params.files) {
        const key = `${this.tempPrefix}/${normalizePrefix(params.keyPrefix)}/${basename(file)}`;
        const body = await readFile(file);

        await this.client.putObject({
          Bucket: this.bucket,
          Region: this.region,
          Key: key,
          Body: body,
          ContentType: "image/jpeg",
        });

        uploaded.push({
          localPath: file,
          key,
          url: await this.getSignedUrl(key),
        });
      }

      return uploaded;
    } catch (err) {
      await this.deleteObjects(uploaded.map((item) => item.key)).catch(
        (cleanupErr) => {
          logger.warn(
            `COS 临时对象回滚失败，可能遗留远端临时文件: leaked=${uploaded.length}, reason=${summarizeText((cleanupErr as Error).message)}`,
          );
        },
      );
      throw err;
    }
  }

  async deleteObjects(keys: string[]): Promise<void> {
    if (keys.length === 0) return;

    for (let i = 0; i < keys.length; i += 1000) {
      const batch = keys.slice(i, i + 1000);
      await this.client.deleteMultipleObject({
        Bucket: this.bucket,
        Region: this.region,
        Objects: batch.map((key) => ({ Key: key })),
        Quiet: true,
      });
    }
  }

  private getSignedUrl(key: string): Promise<string> {
    return new Promise((resolve, reject) => {
      this.client.getObjectUrl(
        {
          Bucket: this.bucket,
          Region: this.region,
          Key: key,
          Sign: true,
          Expires: this.signedUrlExpiresSeconds,
        },
        (err, data) => {
          if (err) {
            reject(err);
            return;
          }
          resolve(data.Url);
        },
      );
    });
  }
}

function normalizePrefix(prefix: string): string {
  return prefix.replace(/^\/+|\/+$/g, "");
}
