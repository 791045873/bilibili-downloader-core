import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  initTestDb,
  truncateAll,
  type DatabaseService,
} from "../helpers/db.js";

const db: DatabaseService = await initTestDb();

afterAll(async () => {
  await db.onApplicationShutdown();
});

beforeEach(async () => {
  await truncateAll(db);
});

describe("getSummaryWithSegmentsByResource", () => {
  it("返回 summary 头字段 + 按 seq 升序的全渲染字段 segment", async () => {
    await db.upsertSummaryKnowledge({
      bvid: "BV1",
      cid: 100,
      videoTitle: "视频标题",
      videoUrl: "https://v",
      modelName: "m1",
      rawResponse: JSON.stringify({ summary: [] }),
      segments: [
        {
          seq: 2,
          title: "段二",
          content: "文二",
          frameDescription: "画面二",
          screenshotUrl: "https://cos/2.jpg",
        },
        {
          seq: 1,
          title: "段一",
          content: "文一",
        },
      ],
    });

    const result = await db.getSummaryWithSegmentsByResource("BV1", 100);
    expect(result).toBeDefined();
    expect(result?.videoTitle).toBe("视频标题");
    expect(result?.videoUrl).toBe("https://v");
    expect(result?.modelName).toBe("m1");
    expect(result?.createdAt).toBeInstanceOf(Date);

    const segs = result?.segments ?? [];
    expect(segs.map((s) => s.seq)).toEqual([1, 2]);
    expect(segs[0]).toMatchObject({
      seq: 1,
      title: "段一",
      content: "文一",
      frameDescription: null,
      screenshotUrl: null,
    });
    expect(segs[1]).toMatchObject({
      seq: 2,
      title: "段二",
      frameDescription: "画面二",
      screenshotUrl: "https://cos/2.jpg",
    });
  });

  it("无 summary 行 → 返回 undefined", async () => {
    const result = await db.getSummaryWithSegmentsByResource("BVnone", 999);
    expect(result).toBeUndefined();
  });

  it("summary 存在但无 segment → segments 为空数组", async () => {
    await db.upsertSummaryKnowledge({
      bvid: "BV2",
      cid: 200,
      videoTitle: "空段视频",
      rawResponse: JSON.stringify({ summary: [] }),
      segments: [],
    });
    const result = await db.getSummaryWithSegmentsByResource("BV2", 200);
    expect(result?.videoTitle).toBe("空段视频");
    expect(result?.segments).toEqual([]);
  });
});
