import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { ChatPhotoService } from "../../src/chat/chat-photo.service.js";
import { getChatConfig } from "../../src/chat/chat-config.js";
import type { ChatPhotoFile } from "../../src/chat/chat.types.js";

function makePhotoService(): {
  service: ChatPhotoService;
  uploaded: Buffer[];
} {
  const uploaded: Buffer[] = [];
  const service = new ChatPhotoService({
    isConfigured: () => true,
    uploadBuffer: async (buffer: Buffer) => {
      uploaded.push(buffer);
      return "https://cos.example.com/user-photos/1/x.jpg";
    },
  } as never);
  return { service, uploaded };
}

async function makeJpeg(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 200, g: 80, b: 80 } },
  })
    .jpeg()
    .toBuffer();
}

function file(buffer: Buffer, mimetype = "image/jpeg"): ChatPhotoFile {
  return { buffer, size: buffer.length, mimetype, originalname: "photo.jpg" };
}

describe("ChatPhotoService", () => {
  it("大图压缩到最长边限制内且输出 JPEG", async () => {
    const { service, uploaded } = makePhotoService();
    const original = await makeJpeg(2400, 3200);

    const urls = await service.savePhotos(1, [file(original)]);

    expect(urls).toHaveLength(1);
    expect(uploaded).toHaveLength(1);
    const meta = await sharp(uploaded[0]).metadata();
    const maxEdge = getChatConfig().photoMaxEdge;
    expect(Math.max(meta.width ?? 0, meta.height ?? 0)).toBeLessThanOrEqual(maxEdge);
    expect(meta.format).toBe("jpeg");
  });

  it("小图不放大", async () => {
    const { service, uploaded } = makePhotoService();
    const original = await makeJpeg(800, 600);

    await service.savePhotos(1, [file(original)]);

    const meta = await sharp(uploaded[0]).metadata();
    expect(meta.width).toBe(800);
    expect(meta.height).toBe(600);
  });

  it("不支持的照片格式抛 400 语义", async () => {
    const { service } = makePhotoService();
    const gif = await sharp({
      create: { width: 10, height: 10, channels: 3, background: "red" },
    })
      .gif()
      .toBuffer();
    await expect(
      service.savePhotos(1, [file(gif, "image/gif")]),
    ).rejects.toThrow(/不支持的照片格式/);
  });

  it("空照片内容抛 400 语义", async () => {
    const { service } = makePhotoService();
    await expect(
      service.savePhotos(1, [
        { buffer: Buffer.alloc(0), size: 0, mimetype: "image/jpeg" },
      ]),
    ).rejects.toThrow(/内容为空/);
  });

  it("损坏图片数据抛 400 语义（解析失败）", async () => {
    const { service } = makePhotoService();
    const broken = Buffer.from("not-an-image");
    await expect(service.savePhotos(1, [file(broken)])).rejects.toThrow(
      /压缩失败/,
    );
  });
});
