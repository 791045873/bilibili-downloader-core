import { describe, expect, it } from "vitest";
import { listLocalImageRefs } from "../../src/analysis/summary-dir.js";

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
