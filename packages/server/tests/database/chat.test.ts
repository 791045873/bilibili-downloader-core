import { afterAll, beforeEach, describe, expect, it } from "vitest";
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

describe("chat conversations", () => {
  it("createConversation 写入并返回自增 id", async () => {
    const id = await db.createConversation();
    expect(Number.isInteger(id)).toBe(true);
    const conv = await db.getConversation(id);
    expect(conv?.id).toBe(id);
    expect(conv?.title).toBeUndefined();
  });

  it("listConversations 按 updated_at 倒序", async () => {
    const first = await db.createConversation("first");
    await db.createConversation("second");
    await db.updateConversationTitleAndTouch(first);

    const list = await db.listConversations();
    expect(list).toHaveLength(2);
    expect(list[0].id).toBe(first);
    expect(list[0].title).toBe("first");
  });

  it("updateConversationTitleAndTouch 更新标题；不提供时仅 touch", async () => {
    const id = await db.createConversation();
    await db.updateConversationTitleAndTouch(id, "hello");
    expect((await db.getConversation(id))?.title).toBe("hello");

    await db.updateConversationTitleAndTouch(id);
    expect((await db.getConversation(id))?.title).toBe("hello");
  });

  it("getConversation 不存在时返回 undefined", async () => {
    expect(await db.getConversation(99999)).toBeUndefined();
  });

  it("deleteConversation 软删除：隐藏会话但保留 messages", async () => {
    const id = await db.createConversation();
    await db.insertMessage({ conversationId: id, role: "user", content: "hi" });
    await db.insertMessage({
      conversationId: id,
      role: "assistant",
      content: "reply",
      replyImages: [{ url: "u" }],
      replySources: [{ videoUrl: "v" }],
    });

    await db.deleteConversation(id);

    expect(await db.getConversation(id)).toBeUndefined();
    const list = await db.listConversations();
    expect(list.some((c) => c.id === id)).toBe(false);
    const pool = internals(db).pool;
    const rows = await pool.query(`SELECT * FROM message WHERE conversation_id = $1`, [id]);
    expect(rows.rows).toHaveLength(2);
  });

  it("listConversations 排除已软删除会话", async () => {
    const kept = await db.createConversation("kept");
    const removed = await db.createConversation("removed");
    await db.deleteConversation(removed);

    const list = await db.listConversations();
    expect(list.map((c) => c.id)).toEqual([kept]);
  });

  it("insertMessage / listMessages 保持写入顺序与字段", async () => {
    const id = await db.createConversation();
    await db.insertMessage({
      conversationId: id,
      role: "user",
      content: "q",
      photoUrls: ["https://cos/a.jpg", "https://cos/b.jpg"],
    });
    await db.insertMessage({
      conversationId: id,
      role: "assistant",
      content: "a",
      replyImages: [{ url: "https://cos/a.jpg", tipTitle: "t", caption: "c" }],
      replySources: [
        { videoTitle: "v", videoUrl: "https://bvv", timestampSeconds: 30, tipTitle: "t", screenshotUrl: "s" },
      ],
    });

    const messages = await db.listMessages(id);
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe("user");
    expect(messages[0].photoUrls).toEqual(["https://cos/a.jpg", "https://cos/b.jpg"]);
    expect(messages[0].replyImages).toBeUndefined();
    expect(messages[1].role).toBe("assistant");
    expect(messages[1].replyImages).toEqual([{ url: "https://cos/a.jpg", tipTitle: "t", caption: "c" }]);
    expect(messages[1].replySources?.[0]).toMatchObject({ videoUrl: "https://bvv", timestampSeconds: 30 });
    expect(messages[1].createdAt).toBeTruthy();
  });

  it("photoUrls 缺省落空数组", async () => {
    const id = await db.createConversation();
    await db.insertMessage({ conversationId: id, role: "user", content: "q" });
    const pool = internals(db).pool;
    const rows = await pool.query(`SELECT photo_urls FROM message`);
    expect(rows.rows[0].photo_urls).toEqual([]);
  });
});
