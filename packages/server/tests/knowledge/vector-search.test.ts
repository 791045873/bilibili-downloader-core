import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { KnowledgePublisherService } from "../../src/knowledge/knowledge-publisher.service.js";
import type { EmbeddingService } from "../../src/knowledge/embedding.service.js";
import {
  initTestDb,
  internals,
  truncateAll,
  type DatabaseService,
} from "../helpers/db.js";

const db: DatabaseService = await initTestDb();

const MODEL = "test-embedding-model";
const embedTexts = vi.fn();

const embeddingStub = {
  currentModel: () => MODEL,
  embedTexts,
} as unknown as EmbeddingService;

type Pool = { query: (sql: string, values?: unknown[]) => Promise<{ rows: any[] }> };
const pool = (): Pool => internals(db).pool;

function vec(a: number, b: number, c: number): number[] {
  const v = new Array(1024).fill(0);
  v[0] = a;
  v[1] = b;
  v[2] = c;
  return v;
}

function makePublisher(): KnowledgePublisherService {
  return new KnowledgePublisherService(
    db,
    { isConfigured: () => true, upload: vi.fn() } as never,
    embeddingStub,
  );
}

const summaryDir = mkdtempSync(join(tmpdir(), "p2-vec-"));
const mdPath = join(summaryDir, "report.md");
writeFileSync(mdPath, "# 总结\n内容正文");

const baseInput = {
  bvid: "BV1",
  cid: 1,
  videoTitle: "视频标题",
  videoUrl: "https://www.bilibili.com/video/BV1",
  modelName: "m1",
  rawResponse: JSON.stringify({
    summary: [
      { title: "技巧一", content: "内容一", timestamp: "00:01", frameDescription: "d1" },
      { title: "技巧二", content: "内容二", timestamp: "00:02", frameDescription: "d2" },
    ],
  }),
  summaryPath: mdPath,
};

beforeEach(async () => {
  await truncateAll(db);
  embedTexts.mockReset();
});

afterAll(async () => {
  await db.onApplicationShutdown();
  vi.restoreAllMocks();
});

describe("发布管道向量化集成（Phase 2）", () => {
  beforeEach(async () => {
    await db.upsertAiSummaryTask({
      bvid: "BV1",
      cid: 1,
      status: "completed",
      rawResponse: baseInput.rawResponse,
    });
  });

  it("发布后 embedding 非空、模型正确、knowledge_status=synced", async () => {
    embedTexts.mockImplementation(async (texts: string[]) =>
      texts.map((_, i) => vec(i === 0 ? 1 : 0, i === 1 ? 1 : 0, 0)),
    );
    await makePublisher().publish(baseInput);
    const { rows } = await pool().query(
      `SELECT seq, embedding_model, (embedding IS NOT NULL) AS has_vec FROM summary_segment ORDER BY seq`,
    );
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.has_vec && r.embedding_model === MODEL)).toBe(true);
    const record = await db.getAiSummaryTaskByResource("BV1", 1);
    expect(record!.knowledgeStatus).toBe("synced");
  });

  it("重复发布同内容复用向量（不重算）", async () => {
    embedTexts.mockImplementation(async (texts: string[]) =>
      texts.map((_, i) => vec(i === 0 ? 1 : 0, i === 1 ? 1 : 0, 0)),
    );
    await makePublisher().publish(baseInput);
    expect(embedTexts).toHaveBeenCalledTimes(1);
    await makePublisher().publish(baseInput);
    expect(embedTexts).toHaveBeenCalledTimes(1);
    const record = await db.getAiSummaryTaskByResource("BV1", 1);
    expect(record!.knowledgeStatus).toBe("synced");
  });

  it("内容变化时重算向量", async () => {
    embedTexts.mockImplementation(async (texts: string[]) =>
      texts.map((_, i) => vec(i === 0 ? 1 : 0, i === 1 ? 1 : 0, 0)),
    );
    await makePublisher().publish(baseInput);
    const changed = {
      ...baseInput,
      rawResponse: JSON.stringify({
        summary: [
          { title: "技巧一改", content: "内容一改", timestamp: "00:01", frameDescription: "d1" },
          { title: "技巧二", content: "内容二", timestamp: "00:02", frameDescription: "d2" },
        ],
      }),
    };
    embedTexts.mockImplementationOnce(async (texts: string[]) =>
      texts.map(() => vec(0, 0, 1)),
    );
    await makePublisher().publish(changed);
    expect(embedTexts).toHaveBeenCalledTimes(2);
    const { rows } = await pool().query(
      `SELECT seq, (embedding::text::jsonb ->> 1)::float8 AS y FROM summary_segment ORDER BY seq`,
    );
    expect(rows[0].y).toBe(0);
    expect(rows[1].y).toBe(1);
  });

  it("空 segments：无 embedding 调用且置 synced", async () => {
    const empty = { ...baseInput, rawResponse: JSON.stringify({ summary: [] }) };
    await makePublisher().publish(empty);
    expect(embedTexts).not.toHaveBeenCalled();
    const record = await db.getAiSummaryTaskByResource("BV1", 1);
    expect(record!.knowledgeStatus).toBe("synced");
  });

  it("缺 embedding 配置：publish 拒绝、置 failed 且错误含提示", async () => {
    embedTexts.mockRejectedValue(
      Object.assign(
        new Error("缺少 embedding 配置：请在设置页配置 LLM API Key（llm.apiKey）"),
        { name: "EmbeddingConfigError" },
      ),
    );
    await expect(makePublisher().publish(baseInput)).rejects.toThrow(
      "缺少 embedding 配置",
    );
    const record = await db.getAiSummaryTaskByResource("BV1", 1);
    expect(record!.knowledgeStatus).toBe("failed");
    expect(record!.knowledgeError).toContain("缺少 embedding 配置");
  });
});

describe("pgvector 检索", () => {
  beforeEach(async () => {
    await truncateAll(db);
    const { rows } = await pool().query(
      `INSERT INTO summary (bvid, cid, video_title, video_url, raw_response) VALUES ('BV9', 9, '检索视频', 'https://www.bilibili.com/video/BV9', '{}') RETURNING id`,
    );
    const summaryId = Number(rows[0].id);
    await pool().query(
      `INSERT INTO summary_segment (summary_id, seq, title, content) VALUES ($1, 0, 's1', 'c1'), ($1, 1, 's2', 'c2')`,
      [summaryId],
    );
    await db.updateSummarySegmentEmbeddings(
      summaryId,
      [
        { seq: 0, embedding: vec(1, 0, 0) },
        { seq: 1, embedding: vec(0, 1, 0) },
      ],
      MODEL,
    );
  });

  it("余弦 top-k 顺序与字段形状", async () => {
    const results = await db.searchKnowledgeSegments(vec(1, 0.1, 0), MODEL, 2);
    expect(results).toHaveLength(2);
    expect(results[0].title).toBe("s1");
    expect(results[0].segmentId).toBeGreaterThan(0);
    expect(results[0].score).toBeGreaterThan(results[1].score);
    expect(results[0].videoTitle).toBe("检索视频");
    expect(results[0].videoUrl).toBe("https://www.bilibili.com/video/BV9");
    expect(results[0].screenshotUrl).toBeNull();
  });

  it("模型不一致的 segment 不参与检索", async () => {
    const results = await db.searchKnowledgeSegments(vec(0, 1, 0), "other-model", 10);
    expect(results).toEqual([]);
  });

  it("无命中返回空数组", async () => {
    await truncateAll(db);
    const results = await db.searchKnowledgeSegments(vec(1, 0, 0), MODEL, 10);
    expect(results).toEqual([]);
  });
});
