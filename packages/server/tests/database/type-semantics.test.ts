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

describe("类型语义（pg type parser 契约）", () => {
  it("int8 → number，timestamptz → ISO 8601 UTC 字符串", async () => {
    const id = await db.insertTask({
      status: "success",
      bvid: "BV1",
      cid: 9999999999,
      fileSize: 12345678901,
      durationMs: 9876543210,
    } as any);
    const row = await db.getTaskById(id)!;
    expect(typeof row!.id).toBe("number");
    expect(row!.cid).toBe(9999999999);
    expect(typeof row!.fileSize).toBe("number");
    expect(typeof row!.durationMs).toBe("number");
    expect(row!.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/);
  });

  it("ai_prompt_creator.mid（int8）→ number", async () => {
    await db.upsertCreatorBinding(12345678901, 1);
    const binding = await db.getCreatorBindingByMid(12345678901);
    expect(typeof binding!.mid).toBe("number");
    expect(binding!.mid).toBe(12345678901);
  });

  it("analysis_sub_task.cid（int8）→ number", async () => {
    const taskId = await db.insertTask({ status: "success" } as any);
    await db.insertAnalysisSubTask({
      taskId,
      bvid: "BV1",
      cid: 8888888888,
      status: "created",
      createdAt: "2026-06-01 12:00:00+08",
    });
    const rows = await db.getAnalysisSubTasks("BV1", 8888888888);
    expect(rows).toHaveLength(1);
    expect(rows[0].cid).toBe(8888888888);
    expect(rows[0].createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/);
  });

  it("历史格式时间戳（空格分隔 + 时区）归一化为 ISO", async () => {
    const pool = internals(db).pool;
    await pool.query(
      `INSERT INTO app_settings (key, value) VALUES ('k', 'v')`,
    );
    const id = await db.insertTask({ status: "created", createdAt: "2026-06-01 12:00:00+08" } as any);
    const row = await db.getTaskById(id);
    expect(row!.createdAt).toBe("2026-06-01T04:00:00.000Z");
  });
});
