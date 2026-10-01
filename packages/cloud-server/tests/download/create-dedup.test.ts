import { describe, expect, it } from "vitest";
import { decideCreateDedupVerdict } from "../../src/download/create-dedup.js";

describe("decideCreateDedupVerdict（纯 DB 去重，2026-09-30 修订）", () => {
  it("active 任务存在即拦截", () => {
    const v = decideCreateDedupVerdict({
      activeTaskExists: true,
      completedTaskExists: false,
    });
    expect(v.block).toBe(true);
    expect(v.message).toContain("排队中或下载中");
  });

  it("已有 success 任务即拦截（不再校验磁盘）", () => {
    const v = decideCreateDedupVerdict({
      activeTaskExists: false,
      completedTaskExists: true,
    });
    expect(v.block).toBe(true);
    expect(v.message).toContain("已下载");
  });

  it("文件被手动删除后仍拦截（AC3 已改写：纯 DB，success 记录在即拦）", () => {
    // 磁盘文件已删但 DB 仍有 success 记录 → 拆分后创建入口（cloud）无法感知磁盘，
    // 一律按 DB 记录拦截。用户需先删任务记录再重建。
    const v = decideCreateDedupVerdict({
      activeTaskExists: false,
      completedTaskExists: true,
    });
    expect(v.block).toBe(true);
  });

  it("无任何记录放行", () => {
    const v = decideCreateDedupVerdict({
      activeTaskExists: false,
      completedTaskExists: false,
    });
    expect(v).toEqual({ block: false });
  });
});
