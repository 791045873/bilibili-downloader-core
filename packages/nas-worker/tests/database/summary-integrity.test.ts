import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  initTestDb,
  truncateAll,
  type DatabaseService,
} from "../helpers/db.js";
import { PathsService } from "../../src/paths/paths.service.js";
import type { TaskRecord } from "@bilibili-downloader/server-common";
import {
  SummaryIntegrityService,
  judgeIntegrity,
} from "../../src/analysis/summary-integrity.service.js";

const workDir = await mkdtemp(join(tmpdir(), "summary-integrity-"));
process.env.OUTPUT_DIR = workDir;

const db: DatabaseService = await initTestDb();
const paths = new PathsService();
const service = new SummaryIntegrityService(db, paths);

afterAll(async () => {
  await db.onApplicationShutdown();
  await rm(workDir, { recursive: true, force: true });
});

beforeEach(async () => {
  await truncateAll(db);
});

describe("judgeIntegrity（纯函数分级）", () => {
  it("内容缺失（无 summary）→ missing", () => {
    const r = judgeIntegrity({
      hasSummary: false,
      segmentCount: 0,
      screenshotMissingSeqs: [],
      videoMissing: true,
    });
    expect(r.status).toBe("missing");
    expect(r.detail.contentMissing).toEqual(["summary"]);
  });

  it("有 summary 但零段 → missing（segments）", () => {
    const r = judgeIntegrity({
      hasSummary: true,
      segmentCount: 0,
      screenshotMissingSeqs: [],
      videoMissing: false,
    });
    expect(r.status).toBe("missing");
    expect(r.detail.contentMissing).toEqual(["segments"]);
  });

  it("仅截图缺失 → partial 且列出 seq", () => {
    const r = judgeIntegrity({
      hasSummary: true,
      segmentCount: 3,
      screenshotMissingSeqs: [1, 2],
      videoMissing: false,
    });
    expect(r.status).toBe("partial");
    expect(r.detail.screenshotMissing).toEqual([1, 2]);
    expect(r.detail.contentMissing).toEqual([]);
  });

  it("仅视频缺失 → complete + videoMissing 告警（不降级）", () => {
    const r = judgeIntegrity({
      hasSummary: true,
      segmentCount: 2,
      screenshotMissingSeqs: [],
      videoMissing: true,
    });
    expect(r.status).toBe("complete");
    expect(r.detail.videoMissing).toEqual(["video"]);
  });

  it("全备 → complete，明细全空", () => {
    const r = judgeIntegrity({
      hasSummary: true,
      segmentCount: 2,
      screenshotMissingSeqs: [],
      videoMissing: false,
    });
    expect(r.status).toBe("complete");
    expect(r.detail).toEqual({
      contentMissing: [],
      screenshotMissing: [],
      videoMissing: [],
    });
  });
});

describe("SummaryIntegrityService（云端三类判据）", () => {
  async function seedCompleted(bvid: string, cid: number) {
    await db.upsertAiSummaryTask({ bvid, cid, status: "completed" });
  }

  it("无 summary 行 → missing，contentMissing=[summary]", async () => {
    await seedCompleted("BV1", 1);
    await service.run();
    const row = (await db.getAiSummaryTaskByResource("BV1", 1))!;
    expect(row.integrityStatus).toBe("missing");
    expect(JSON.parse(row.integrityDetail!)).toEqual({
      contentMissing: ["summary"],
      screenshotMissing: [],
      videoMissing: ["video"],
    });
  });

  it("截图部分空 → partial 且列出 seq（视频缺失仅告警）", async () => {
    await seedCompleted("BV1", 1);
    await db.upsertSummaryKnowledge({
      bvid: "BV1",
      cid: 1,
      videoTitle: "t",
      rawResponse: "{}",
      segments: [
        { seq: 0, title: "a", content: "c", screenshotUrl: "cos://a.jpg" },
        { seq: 1, title: "b", content: "c" },
      ],
    });
    await service.run();
    const row = (await db.getAiSummaryTaskByResource("BV1", 1))!;
    expect(row.integrityStatus).toBe("partial");
    const detail = JSON.parse(row.integrityDetail!);
    expect(detail.screenshotMissing).toEqual([1]);
    expect(detail.contentMissing).toEqual([]);
    expect(detail.videoMissing).toEqual(["video"]);
  });

  it("内容/截图完备但视频缺失 → complete + videoMissing 告警", async () => {
    await seedCompleted("BV1", 1);
    await db.upsertSummaryKnowledge({
      bvid: "BV1",
      cid: 1,
      videoTitle: "t",
      rawResponse: "{}",
      segments: [
        { seq: 0, title: "a", content: "c", screenshotUrl: "cos://a.jpg" },
      ],
    });
    await service.run();
    const row = (await db.getAiSummaryTaskByResource("BV1", 1))!;
    expect(row.integrityStatus).toBe("complete");
    expect(JSON.parse(row.integrityDetail!).videoMissing).toEqual(["video"]);
  });

  it("三类齐备（含 NAS 视频存在）→ complete，明细全空", async () => {
    await seedCompleted("BV1", 1);
    await db.upsertSummaryKnowledge({
      bvid: "BV1",
      cid: 1,
      videoTitle: "t",
      rawResponse: "{}",
      segments: [
        { seq: 0, title: "a", content: "c", screenshotUrl: "cos://a.jpg" },
      ],
    });
    await db.insertTask({
      status: "success",
      bvid: "BV1",
      cid: 1,
      outputFile: "vid.mp4",
    } as TaskRecord);
    await mkdir(paths.DOWNLOAD_ROOT, { recursive: true });
    await writeFile(join(paths.DOWNLOAD_ROOT, "vid.mp4"), "video-bytes");
    await service.run();
    const row = (await db.getAiSummaryTaskByResource("BV1", 1))!;
    expect(row.integrityStatus).toBe("complete");
    expect(JSON.parse(row.integrityDetail!)).toEqual({
      contentMissing: [],
      screenshotMissing: [],
      videoMissing: [],
    });
  });

  it("只写 integrity_* 三列，不触碰 updated_at", async () => {
    await seedCompleted("BV1", 1);
    const before = (await db.getAiSummaryTaskByResource("BV1", 1))!;
    await service.run();
    const after = (await db.getAiSummaryTaskByResource("BV1", 1))!;
    expect(after.updatedAt).toBe(before.updatedAt);
    expect(after.integrityCheckedAt).not.toBeNull();
  });
});
