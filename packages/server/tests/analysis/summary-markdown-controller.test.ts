import { beforeEach, describe, expect, it, vi } from "vitest";
import * as fsPromises from "node:fs/promises";
import {
  BadRequestException,
  ConflictException,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { AnalysisTaskController } from "../../src/analysis/analysis-task.controller.js";
import type { DatabaseService } from "../../src/database/database.service.js";
import type { AiSummaryTaskRecord } from "../../src/database/database.service.js";

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, readFile: vi.fn(actual.readFile) };
});

type DbMock = {
  getAiSummaryTaskById: ReturnType<typeof vi.fn>;
  getAiSummaryTaskByResource: ReturnType<typeof vi.fn>;
  getSummaryWithSegmentsByResource: ReturnType<typeof vi.fn>;
};

function makeController(db: DbMock): AnalysisTaskController {
  const stub = {} as never;
  return new AnalysisTaskController(
    stub,
    db as unknown as DatabaseService,
    stub,
    stub,
    stub,
    stub,
    stub,
  );
}

function completedTask(
  overrides: Partial<AiSummaryTaskRecord> = {},
): AiSummaryTaskRecord {
  return {
    id: 1,
    bvid: "BV1",
    cid: 100,
    title: "任务标题",
    status: "completed",
    modelName: "m",
    rawResponse: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    lastCompletedAt: "2026-02-02T00:00:00.000Z",
    ...overrides,
  } as unknown as AiSummaryTaskRecord;
}

const oneSegmentSummary = {
  videoTitle: "视频标题",
  videoUrl: "https://s/v",
  modelName: "sm",
  createdAt: new Date("2026-03-03T00:00:00.000Z"),
  segments: [
    {
      seq: 1,
      title: "段一",
      content: "正文一",
      frameDescription: "画面一",
      screenshotUrl: "https://cos.example/a.jpg",
    },
  ],
};

function newDb(partial: Partial<DbMock> = {}): DbMock {
  return {
    getAiSummaryTaskById: vi.fn(),
    getAiSummaryTaskByResource: vi.fn(),
    getSummaryWithSegmentsByResource: vi.fn(),
    ...partial,
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("GET /summary-tasks/:id/markdown 错误矩阵", () => {
  it("非法 id → 400", async () => {
    const c = makeController(newDb());
    await expect(c.getAiSummaryTaskMarkdown("abc")).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it("记录不存在 → 404", async () => {
    const db = newDb();
    db.getAiSummaryTaskById.mockResolvedValue(undefined);
    const c = makeController(db);
    await expect(c.getAiSummaryTaskMarkdown("1")).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it("非 completed → 409", async () => {
    const db = newDb();
    db.getAiSummaryTaskById.mockResolvedValue(
      completedTask({ status: "pending" }),
    );
    const c = makeController(db);
    await expect(c.getAiSummaryTaskMarkdown("1")).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it("completed 但无 summary 且 raw_response 空 → 409（内容不可用）", async () => {
    const db = newDb();
    db.getAiSummaryTaskById.mockResolvedValue(completedTask({ rawResponse: null }));
    db.getSummaryWithSegmentsByResource.mockResolvedValue(undefined);
    const c = makeController(db);
    await expect(c.getAiSummaryTaskMarkdown("1")).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});

describe("GET /summary-tasks/:id/markdown 成功路径", () => {
  it("200 主路径：内容来自 DB，图片为 COS URL，meta 取 summary", async () => {
    const db = newDb();
    db.getAiSummaryTaskById.mockResolvedValue(completedTask());
    db.getSummaryWithSegmentsByResource.mockResolvedValue(oneSegmentSummary);
    const c = makeController(db);

    const { content, meta } = await c.getAiSummaryTaskMarkdown("1");
    expect(content).toContain("## 段一");
    expect(content).toContain("https://cos.example/a.jpg");
    expect(content).not.toContain("/summary-files");
    expect(content).not.toContain("---");
    expect(meta.videoUrl).toBe("https://s/v");
    expect(meta.createdAt).toBe("2026-02-02T00:00:00.000Z");
  });

  it("200 回退：无 summary 行时用 raw_response 渲染纯文本，meta.title 来自任务", async () => {
    const db = newDb();
    db.getAiSummaryTaskById.mockResolvedValue(
      completedTask({
        rawResponse: JSON.stringify({
          summary: [{ title: "段A", content: "文A", frameDescription: "d" }],
        }),
      }),
    );
    db.getSummaryWithSegmentsByResource.mockResolvedValue(undefined);
    const c = makeController(db);

    const { content, meta } = await c.getAiSummaryTaskMarkdown("1");
    expect(content).toContain("# 任务标题");
    expect(content).toContain("## 段A");
    expect(content).not.toContain("![");
    expect(meta.title).toBe("任务标题");
  });

  it("渲染不读盘：readFile 未被调用（DB 主路径 + raw 回退）", async () => {
    const readFileMock = vi.mocked(fsPromises.readFile);
    readFileMock.mockClear();

    const dbHit = newDb();
    dbHit.getAiSummaryTaskById.mockResolvedValue(completedTask());
    dbHit.getSummaryWithSegmentsByResource.mockResolvedValue(oneSegmentSummary);
    await makeController(dbHit).getAiSummaryTaskMarkdown("1");

    const dbFallback = newDb();
    dbFallback.getAiSummaryTaskById.mockResolvedValue(
      completedTask({
        rawResponse: JSON.stringify({
          summary: [{ title: "段A", content: "文A", frameDescription: "d" }],
        }),
      }),
    );
    dbFallback.getSummaryWithSegmentsByResource.mockResolvedValue(undefined);
    await makeController(dbFallback).getAiSummaryTaskMarkdown("1");

    expect(readFileMock).not.toHaveBeenCalled();
  });

  it("漂移：summary 与 raw_response 段数不一致 → 以 summary 渲染并 warn", async () => {
    const warnSpy = vi.spyOn(Logger.prototype, "warn");
    const db = newDb();
    db.getAiSummaryTaskById.mockResolvedValue(
      completedTask({
        rawResponse: JSON.stringify({
          summary: [
            { title: "a", content: "a", frameDescription: "d" },
            { title: "b", content: "b", frameDescription: "d" },
          ],
        }),
      }),
    );
    db.getSummaryWithSegmentsByResource.mockResolvedValue(oneSegmentSummary);
    const c = makeController(db);

    const { content } = await c.getAiSummaryTaskMarkdown("1");
    expect(content).toContain("## 段一");
    expect(warnSpy).toHaveBeenCalled();
  });
});

describe("GET /summary-tasks/by-resource/:bvid/:cid/markdown", () => {
  it("非法参数 → 400", async () => {
    const c = makeController(newDb());
    await expect(
      c.getAiSummaryTaskMarkdownByResource("", "abc"),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("记录不存在 → 404", async () => {
    const db = newDb();
    db.getAiSummaryTaskByResource.mockResolvedValue(undefined);
    const c = makeController(db);
    await expect(
      c.getAiSummaryTaskMarkdownByResource("BV1", "100"),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("200：完成态经 DB 渲染", async () => {
    const db = newDb();
    db.getAiSummaryTaskByResource.mockResolvedValue(completedTask());
    db.getSummaryWithSegmentsByResource.mockResolvedValue(oneSegmentSummary);
    const c = makeController(db);
    const { content } = await c.getAiSummaryTaskMarkdownByResource("BV1", "100");
    expect(content).toContain("## 段一");
  });
});
