import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  initTestDb,
  internals,
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

describe("upsertSummaryKnowledge", () => {
  const baseArgs = {
    bvid: "BV1",
    cid: 1,
    videoTitle: "video",
    videoUrl: "https://v",
    modelName: "m",
    rawResponse: JSON.stringify({ tips: [] }),
  };

  it("首次写入 summary + segments", async () => {
    await db.upsertSummaryKnowledge({
      ...baseArgs,
      segments: [
        { seq: 1, title: "s1", content: "c1", timestampSeconds: 10, screenshotUrl: "u1" },
        { seq: 2, title: "s2", content: "c2" },
      ],
    });

    const pool = internals(db).pool;
    const summaries = await pool.query(`SELECT * FROM summary`);
    expect(summaries.rows).toHaveLength(1);
    expect(summaries.rows[0].video_title).toBe("video");
    expect(summaries.rows[0].raw_response).toEqual({ tips: [] });

    const segments = await pool.query(
      `SELECT * FROM summary_segment ORDER BY seq ASC`,
    );
    expect(segments.rows).toHaveLength(2);
    expect(segments.rows[0].title).toBe("s1");
    expect(segments.rows[0].timestamp_seconds).toBe(10);
    expect(segments.rows[0].screenshot_url).toBe("u1");
    expect(segments.rows[1].frame_description).toBeNull();
  });

  it("重复发布幂等：summary 更新、旧 segments 全量替换", async () => {
    await db.upsertSummaryKnowledge({
      ...baseArgs,
      segments: [
        { seq: 1, title: "s1", content: "c1" },
        { seq: 2, title: "s2", content: "c2" },
      ],
    });
    await db.upsertSummaryKnowledge({
      ...baseArgs,
      videoTitle: "video-2",
      segments: [{ seq: 1, title: "s1-new", content: "c1-new" }],
    });

    const pool = internals(db).pool;
    const summaries = await pool.query(`SELECT * FROM summary`);
    expect(summaries.rows).toHaveLength(1);
    expect(summaries.rows[0].video_title).toBe("video-2");

    const segments = await pool.query(`SELECT * FROM summary_segment`);
    expect(segments.rows).toHaveLength(1);
    expect(segments.rows[0].title).toBe("s1-new");
  });
});
