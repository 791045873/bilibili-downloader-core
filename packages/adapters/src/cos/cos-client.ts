/**
 * 腾讯云对象存储（COS）客户端 — 框架无关适配器
 *
 * 从 server 的 CosStoreService 下沉而来（Phase 3 Stage B-5），使 cloud-server（问答照片）
 * 与 nas-worker（截图/知识发布）两侧共用同一客户端，而非各自复制。配置经构造器注入
 * （本层不读 env，由上层 Nest wrapper 读取并传入）。缺配置时 isConfigured() 为 false，
 * 调用方据此跳过上传。
 */
import COS from "cos-nodejs-sdk-v5";
import { readFile } from "node:fs/promises";
import { extname } from "node:path";

export interface CosClientConfig {
  secretId?: string;
  secretKey?: string;
  bucket?: string;
  region?: string;
  /** 自定义公网 URL 前缀；缺省时按 bucket+region 推导 */
  publicUrlPrefix?: string;
}

export class CosClient {
  private readonly cos: COS | undefined;
  private readonly bucket: string | undefined;
  private readonly region: string | undefined;
  private readonly urlPrefix: string | undefined;

  constructor(config: CosClientConfig) {
    this.bucket = config.bucket;
    this.region = config.region;
    this.urlPrefix = resolvePublicUrlPrefix(config);

    if (!config.secretId || !config.secretKey || !this.bucket || !this.region) {
      return;
    }
    this.cos = new COS({
      SecretId: config.secretId,
      SecretKey: config.secretKey,
    });
  }

  isConfigured(): boolean {
    return this.cos !== undefined;
  }

  /** 上传本地文件到 COS，返回公网 URL。 */
  async upload(localPath: string, key: string): Promise<string> {
    const body = await readFile(localPath);
    await this.putObject(key, body, contentTypeFor(localPath));
    return this.publicUrl(key);
  }

  /** 上传内存 Buffer 到 COS，返回公网 URL（无本地落盘场景）。 */
  async uploadBuffer(
    buffer: Buffer,
    key: string,
    contentType: string,
  ): Promise<string> {
    await this.putObject(key, buffer, contentType);
    return this.publicUrl(key);
  }

  /** 生成对象公网 URL（需 bucket 公网读） */
  publicUrl(key: string): string {
    if (!this.urlPrefix) {
      throw new Error("COS 未配置，无法生成 URL");
    }
    return `${this.urlPrefix}/${key}`;
  }

  private async putObject(
    key: string,
    body: Buffer,
    contentType: string,
  ): Promise<void> {
    if (!this.cos || !this.bucket || !this.region) {
      throw new Error("COS 未配置，无法上传");
    }
    await new Promise<void>((resolve, reject) => {
      this.cos!.putObject(
        {
          Bucket: this.bucket!,
          Region: this.region!,
          Key: key,
          Body: body,
          ContentType: contentType,
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
  }
}

/** 公网 URL 前缀推导：自定义优先，否则 bucket+region 组合（易漂移项，集中一处） */
export function resolvePublicUrlPrefix(
  config: CosClientConfig,
): string | undefined {
  return (
    config.publicUrlPrefix ||
    (config.bucket && config.region
      ? `https://${config.bucket}.cos.${config.region}.myqcloud.com`
      : undefined)
  );
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
