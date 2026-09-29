import { describe, expect, it } from "vitest";
import {
  buildSummaryMeta,
  renderRawResponseMarkdown,
  renderSummaryFromDb,
  type SummaryView,
} from "../../src/analysis/summary-render.js";
import type { AiSummaryTaskRecord } from "../../src/database/database.service.js";

function task(overrides: Partial<AiSummaryTaskRecord> = {}): AiSummaryTaskRecord {
  return {
    id: 1,
    bvid: "BV1",
    cid: 100,
    title: "任务标题",
    status: "completed",
    modelName: "task-model",
    rawResponse: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    lastCompletedAt: "2026-02-02T00:00:00.000Z",
    ...overrides,
  } as unknown as AiSummaryTaskRecord;
}

function summaryView(overrides: Partial<SummaryView> = {}): SummaryView {
  return {
    videoTitle: "视频标题",
    videoUrl: "https://summary.example/v",
    modelName: "summary-model",
    createdAt: new Date("2026-03-03T00:00:00.000Z"),
    segments: [],
    ...overrides,
  };
}

describe("buildSummaryMeta", () => {
  it("summary 存在时优先取 summary，createdAt 取任务 lastCompletedAt", () => {
    const meta = buildSummaryMeta(summaryView(), task(), "BV1");
    expect(meta.title).toBe("视频标题");
    expect(meta.videoUrl).toBe("https://summary.example/v");
    expect(meta.model).toBe("summary-model");
    expect(meta.createdAt).toBe("2026-02-02T00:00:00.000Z");
  });

  it("summary 为空时回退任务字段，videoUrl 回退标准站内链接", () => {
    const meta = buildSummaryMeta(null, task(), "BV1");
    expect(meta.title).toBe("任务标题");
    expect(meta.videoUrl).toBe("https://www.bilibili.com/video/BV1");
    expect(meta.model).toBe("task-model");
    expect(meta.createdAt).toBe("2026-02-02T00:00:00.000Z");
  });

  it("createdAt 无 lastCompletedAt 时回退 createdAt；model 缺失回空串", () => {
    const meta = buildSummaryMeta(
      null,
      task({ lastCompletedAt: null, modelName: null }),
      "BV1",
    );
    expect(meta.createdAt).toBe("2026-01-01T00:00:00.000Z");
    expect(meta.model).toBe("");
  });
});

describe("renderSummaryFromDb", () => {
  it("含截图段：输出标题/正文/COS 图片，无 frontmatter、无 /summary-files", () => {
    const { content } = renderSummaryFromDb(
      summaryView({
        segments: [
          {
            seq: 1,
            title: "段一",
            content: "正文一",
            frameDescription: "画面一",
            screenshotUrl: "https://cos.example/a.jpg",
          },
        ],
      }),
    );
    expect(content).toContain("# 视频标题");
    expect(content).toContain("## 段一");
    expect(content).toContain("正文一");
    expect(content).toContain("![画面一](https://cos.example/a.jpg)");
    expect(content).toContain("> 画面一");
    expect(content).not.toContain("---");
    expect(content).not.toContain("/summary-files");
  });

  it("无 screenshotUrl 的段不输出图片", () => {
    const { content } = renderSummaryFromDb(
      summaryView({
        segments: [
          {
            seq: 1,
            title: "段一",
            content: "正文一",
            frameDescription: null,
            screenshotUrl: null,
          },
        ],
      }),
    );
    expect(content).toContain("## 段一");
    expect(content).not.toContain("![");
  });

  it("空 segments：仅标题、无二级标题", () => {
    const { content } = renderSummaryFromDb(summaryView({ segments: [] }));
    expect(content).toContain("# 视频标题");
    expect(content).not.toContain("##");
  });
});

describe("renderRawResponseMarkdown", () => {
  it("合法 JSON 渲染纯文本（无图），H1 用传入标题", () => {
    const raw = JSON.stringify({
      summary: [{ title: "段A", content: "文A", frameDescription: "d" }],
    });
    const { content } = renderRawResponseMarkdown(raw, "回退标题");
    expect(content).toContain("# 回退标题");
    expect(content).toContain("## 段A");
    expect(content).toContain("文A");
    expect(content).not.toContain("![");
    expect(content).not.toContain("---");
  });

  it("空 / 非法 JSON / summary 缺失 / 空数组 → 抛错", () => {
    expect(() => renderRawResponseMarkdown(null, "t")).toThrow();
    expect(() => renderRawResponseMarkdown("", "t")).toThrow();
    expect(() => renderRawResponseMarkdown("{", "t")).toThrow();
    expect(() => renderRawResponseMarkdown(JSON.stringify({ foo: 1 }), "t")).toThrow();
    expect(() =>
      renderRawResponseMarkdown(JSON.stringify({ summary: [] }), "t"),
    ).toThrow();
  });
});
