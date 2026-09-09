import { describe, expect, it } from "vitest";
import { decideCreateDedupVerdict } from "../../src/download/create-dedup.js";

describe("decideCreateDedupVerdict", () => {
  it("active 任务存在即拦截", () => {
    const v = decideCreateDedupVerdict({
      activeTaskExists: true,
      completedOutputFile: undefined,
      fileExists: false,
    });
    expect(v.block).toBe(true);
    expect(v.message).toContain("排队中或下载中");
  });

  it("success 且文件存在拦截", () => {
    const v = decideCreateDedupVerdict({
      activeTaskExists: false,
      completedOutputFile: "sub/a.mp4",
      fileExists: true,
    });
    expect(v.block).toBe(true);
    expect(v.message).toContain("已下载且文件存在");
  });

  it("success 但文件缺失放行（可重新下载）", () => {
    const v = decideCreateDedupVerdict({
      activeTaskExists: false,
      completedOutputFile: "sub/a.mp4",
      fileExists: false,
    });
    expect(v).toEqual({ block: false });
  });

  it("success 记录无 outputFile 时不拦截", () => {
    const v = decideCreateDedupVerdict({
      activeTaskExists: false,
      completedOutputFile: null,
      fileExists: false,
    });
    expect(v).toEqual({ block: false });
  });

  it("无任何记录放行", () => {
    const v = decideCreateDedupVerdict({
      activeTaskExists: false,
      completedOutputFile: undefined,
      fileExists: false,
    });
    expect(v).toEqual({ block: false });
  });
});
