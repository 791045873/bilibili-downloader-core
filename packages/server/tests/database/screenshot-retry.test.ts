import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  initTestDb,
  truncateAll,
  type DatabaseService,
} from "../helpers/db.js";
import {
  selectSegmentsForRetry,
  type RetrySegment,
} from "../../src/analysis/screenshot-retry.service.js";

const db: DatabaseService = await initTestDb();

afterAll(async () => {
  await db.onApplicationShutdown();
});

beforeEach(async () => {
  await truncateAll(db);
});

describe("selectSegmentsForRetry（纯函数选段）", () => {
  it("仅选 screenshot_url 为空且 timestamp 非空的段", () => {
    const segs: RetrySegment[] = [
      { seq: 0, timestampSeconds: 10, screenshotUrl: "cos://a.jpg" }, // 有截图→排除
      { seq: 1, timestampSeconds: 20, screenshotUrl: null }, // 补
      { seq: 2, timestampSeconds: null, screenshotUrl: null }, // 无 timestamp→排除
      { seq: 3, timestampSeconds: 0, screenshotUrl: "" }, // 空串 + ts=0→补
    ];
    expect(selectSegmentsForRetry(segs)).toEqual([
      { seq: 1, timestampSeconds: 20 },
      { seq: 3, timestampSeconds: 0 },
    ]);
  });

  it("全部已有截图 → 空", () => {
    const segs: RetrySegment[] = [
      { seq: 0, timestampSeconds: 1, screenshotUrl: "u" },
    ];
    expect(selectSegmentsForRetry(segs)).toEqual([]);
  });
});

describe("screenshot-retry 数据层", () => {
  async function seed() {
    await db.upsertSummaryKnowledge({
      bvid: "BV1",
      cid: 1,
      videoTitle: "t",
      rawResponse: "{}",
      segments: [
        {
          seq: 0,
          title: "a",
          content: "c",
          timestampSeconds: 12,
          screenshotUrl: "cos://a.jpg",
        },
        { seq: 1, title: "b", content: "c", timestampSeconds: 34 },
      ],
    });
  }

  it("getSummarySegmentsForScreenshotRetry 返回 summaryId + 段 timestamp/screenshot_url", async () => {
    await seed();
    const data = await db.getSummarySegmentsForScreenshotRetry("BV1", 1);
    expect(data).toBeDefined();
    expect(typeof data!.summaryId).toBe("number");
    expect(data!.segments).toEqual([
      { seq: 0, timestampSeconds: 12, screenshotUrl: "cos://a.jpg" },
      { seq: 1, timestampSeconds: 34, screenshotUrl: null },
    ]);
  });

  it("updateSegmentScreenshotUrl 精确改单段，不影响其它段", async () => {
    await seed();
    const data = (await db.getSummarySegmentsForScreenshotRetry("BV1", 1))!;
    await db.updateSegmentScreenshotUrl(data.summaryId, 1, "cos://b.jpg");
    const after = (await db.getSummarySegmentsForScreenshotRetry("BV1", 1))!;
    expect(after.segments).toEqual([
      { seq: 0, timestampSeconds: 12, screenshotUrl: "cos://a.jpg" },
      { seq: 1, timestampSeconds: 34, screenshotUrl: "cos://b.jpg" },
    ]);
  });

  it("无 summary 行 → undefined", async () => {
    expect(
      await db.getSummarySegmentsForScreenshotRetry("BVX", 9),
    ).toBeUndefined();
  });
});
