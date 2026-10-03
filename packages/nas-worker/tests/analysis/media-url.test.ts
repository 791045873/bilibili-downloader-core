import { describe, expect, it } from "vitest";
import { toMediaUrl } from "../../src/analysis/analysis-engine.js";

describe("toMediaUrl", () => {
  it("converts a local absolute path to a valid file:// URI", () => {
    const url = toMediaUrl("/data/bilibili/视频 名？.mp4");
    expect(url.startsWith("file:///")).toBe(true);
    // 非 ASCII 字符需被百分号编码，避免下游按 netloc 解析失败
    expect(url).not.toContain("视频");
    expect(url).not.toContain("？");
  });

  it("produces a file:// URI with no backslashes for Windows-style paths", () => {
    const url = toMediaUrl("E:/sata1/bilibili-download/穿搭？-BV1n8B1YeEeK-0-q80.mp4");
    expect(url.startsWith("file:///")).toBe(true);
    expect(url).not.toContain("\\");
    expect(url).not.toContain("穿搭");
  });

  it("passes through existing http(s)/file URLs unchanged", () => {
    expect(toMediaUrl("https://example.com/a.mp4")).toBe(
      "https://example.com/a.mp4",
    );
    expect(toMediaUrl("file:///data/a.mp4")).toBe("file:///data/a.mp4");
  });
});
