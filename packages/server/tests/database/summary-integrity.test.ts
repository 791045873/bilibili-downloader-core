import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  initTestDb,
  truncateAll,
  type DatabaseService,
} from "../helpers/db.js";
import { PathsService } from "../../src/paths/paths.service.js";
import { listLocalImageRefs } from "../../src/analysis/summary-dir.js";
import { SummaryIntegrityService } from "../../src/analysis/summary-integrity.service.js";

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

function seedSummary(dir: string, file: string, content: string) {
  return db.upsertAiSummaryTask({
    bvid: "BV1",
    cid: 1,
    title: "t",
    status: "completed",
    summaryOutput: `summary/${dir}/${file}`,
  });
}

describe("listLocalImageRefs", () => {
  it("仅返回相对引用；绝对/根相对/锚点/越界排除", () => {
    const md = [
      "![a](screenshots/segment-0.jpg)",
      "![b](screenshots/segment-1-2.jpg)",
      "![c](https://example.com/x.jpg)",
      "![d](/summary-files/screenshots/x.jpg)",
      "![e](#anchor)",
      "![f](../outside.jpg)",
    ].join("\n");
    expect(listLocalImageRefs(md)).toEqual([
      "screenshots/segment-0.jpg",
      "screenshots/segment-1-2.jpg",
    ]);
  });
});

describe("SummaryIntegrityService", () => {
  it("tryStart 全局互斥，run 结束后释放", async () => {
    expect(service.tryStart()).toBe(true);
    expect(service.tryStart()).toBe(false);
    expect(service.isRunning()).toBe(true);
    await service.run();
    expect(service.isRunning()).toBe(false);
    expect(service.tryStart()).toBe(true);
  });

  it("md 与截图齐全 → complete；缺失截图 → missing 含明细", async () => {
    const dir = join(paths.SUMMARY_BASE_DIR, "t-BV1-1");
    await mkdir(join(dir, "screenshots"), { recursive: true });
    const mdPath = join(dir, "t-summary.md");
    await writeFile(mdPath, "![a](screenshots/segment-0.jpg)");
    await writeFile(join(dir, "screenshots", "segment-0.jpg"), "img");
    await seedSummary("t-BV1-1", "t-summary.md", "");
    const before = (await db.getAiSummaryTaskByResource("BV1", 1))!;
    await service.run();
    const after = (await db.getAiSummaryTaskByResource("BV1", 1))!;
    expect(after.integrityStatus).toBe("complete");
    expect(after.integrityDetail).toBeNull();
    expect(after.updatedAt).toBe(before.updatedAt);

    await unlink(join(dir, "screenshots", "segment-0.jpg"));
    await service.run();
    const missing = (await db.getAiSummaryTaskByResource("BV1", 1))!;
    expect(missing.integrityStatus).toBe("missing");
    expect(missing.integrityDetail).toBe("screenshots/segment-0.jpg");
  });

  it("md 缺失 → missing（总结文档不存在或不可读）", async () => {
    await seedSummary("no-such-dir", "x-summary.md", "");
    await service.run();
    const row = (await db.getAiSummaryTaskByResource("BV1", 1))!;
    expect(row.integrityStatus).toBe("missing");
    expect(row.integrityDetail).toBe("总结文档不存在或不可读");
  });

  it("summary_output 为空 → missing（无输出文档记录）", async () => {
    await db.upsertAiSummaryTask({ bvid: "BV1", cid: 1, status: "completed" });
    await service.run();
    const row = (await db.getAiSummaryTaskByResource("BV1", 1))!;
    expect(row.integrityStatus).toBe("missing");
    expect(row.integrityDetail).toBe("无输出文档记录");
  });

  it("绝对 URL 引用不参与检查；明细超上限截断并保留总计数", async () => {
    const dir = join(paths.SUMMARY_BASE_DIR, "big-BV1-1");
    await mkdir(dir, { recursive: true });
    const lines = ["![remote](https://example.com/a.jpg)"];
    for (let i = 0; i < 45; i++) {
      lines.push(`![i](screenshots/segment-${i}.jpg)`);
    }
    await writeFile(join(dir, "b-summary.md"), lines.join("\n"));
    await db.upsertAiSummaryTask({
      bvid: "BV1",
      cid: 1,
      status: "completed",
      summaryOutput: "summary/big-BV1-1/b-summary.md",
    });
    await service.run();
    const row = (await db.getAiSummaryTaskByResource("BV1", 1))!;
    expect(row.integrityStatus).toBe("missing");
    const detailLines = row.integrityDetail!.split("\n");
    expect(detailLines).toHaveLength(41);
    expect(detailLines[40]).toBe("…共 45 项缺失");
  });
});
