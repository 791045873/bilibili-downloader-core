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

describe("ai_prompt", () => {
  it("空表播种内置提示词，重复 initSchema 不重复播种", async () => {
    await (db as any).initSchema();
    const prompts = await db.listAiPrompts();
    expect(prompts).toHaveLength(1);
    expect(prompts[0].isSystem).toBe(1);
    expect(prompts[0].isDefault).toBe(1);
    expect(prompts[0].name).toBe("穿搭分析（系统内置）");

    await (db as any).initSchema();
    expect(await db.listAiPrompts()).toHaveLength(1);
  });

  it("listAiPrompts 内置优先、其余按 created_at 升序", async () => {
    await (db as any).initSchema();
    await db.insertAiPrompt({ name: "custom-1", content: "c1" });
    await new Promise((r) => setTimeout(r, 10));
    await db.insertAiPrompt({ name: "custom-2", content: "c2", isSystem: 1 });

    const prompts = await db.listAiPrompts();
    expect(prompts.map((p) => p.name)).toEqual(["穿搭分析（系统内置）", "custom-2", "custom-1"]);
  });

  it("update / delete / default 对不存在 id 静默 no-op", async () => {
    expect(await db.updateAiPrompt(99999, { name: "x" })).toBeUndefined();
    await expect(db.deleteAiPrompt(99999)).resolves.toBeUndefined();
    await expect(db.setAiPromptDefault(99999)).resolves.toBeUndefined();
  });

  it("update / delete", async () => {
    const created = await db.insertAiPrompt({ name: "a", content: "old" });
    const updated = await db.updateAiPrompt(created.id!, { name: "b", content: "new" });
    expect(updated!.name).toBe("b");
    expect(updated!.content).toBe("new");
    await db.deleteAiPrompt(created.id!);
    expect(await db.getAiPromptById(created.id!)).toBeUndefined();
  });

  it("default 置位不清除既有 default（现状怪癖），clearAiPromptDefault 全清", async () => {
    await (db as any).initSchema();
    const custom = await db.insertAiPrompt({ name: "custom", content: "c" });

    const seeded = (await db.listAiPrompts())[0];
    expect(await db.getDefaultAiPromptId()).toBe(seeded.id);

    await db.setAiPromptDefault(custom.id!);
    const prompts = await db.listAiPrompts();
    expect(prompts.find((p) => p.id === seeded.id)!.isDefault).toBe(1);
    expect(prompts.find((p) => p.id === custom.id)!.isDefault).toBe(1);
    expect([seeded.id, custom.id]).toContain(await db.getDefaultAiPromptId());

    await db.clearAiPromptDefault();
    expect(await db.getDefaultAiPromptId()).toBeUndefined();
  });
});

describe("ai_prompt_creator", () => {
  it("upsert 覆盖 / delete / get", async () => {
    expect(await db.getCreatorBindingByMid(123)).toBeUndefined();
    await db.upsertCreatorBinding(123, 1);
    expect(await db.getCreatorBindingByMid(123)).toEqual({ mid: 123, promptId: 1 });
    await db.upsertCreatorBinding(123, 2);
    expect((await db.getCreatorBindingByMid(123))!.promptId).toBe(2);
    await db.deleteCreatorBinding(123);
    expect(await db.getCreatorBindingByMid(123)).toBeUndefined();
  });
});
