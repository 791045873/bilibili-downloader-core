import { describe, expect, it } from "vitest";
import { join, resolve } from "node:path";
import {
  resolveFromDownloadRoot,
  toRelativeDownloadRootPath,
} from "../../src/paths/path-anchor.js";

const root = resolve(join(process.cwd(), "downloads"));

describe("toRelativeDownloadRootPath", () => {
  it("根下绝对路径转 POSIX 相对值", () => {
    expect(
      toRelativeDownloadRootPath(join(root, "sub", "a b.mp4"), root),
    ).toBe("sub/a b.mp4");
    expect(
      toRelativeDownloadRootPath(join(root, ".analysis-llm", "x.mp4"), root),
    ).toBe(".analysis-llm/x.mp4");
  });

  it("空值/相对值/根外值/根本身返回 null 不改写", () => {
    expect(toRelativeDownloadRootPath("", root)).toBeNull();
    expect(toRelativeDownloadRootPath(undefined, root)).toBeNull();
    expect(toRelativeDownloadRootPath("rel/a.mp4", root)).toBeNull();
    expect(
      toRelativeDownloadRootPath(resolve(root, "..", "outside.mp4"), root),
    ).toBeNull();
    expect(toRelativeDownloadRootPath(root, root)).toBeNull();
  });
});

describe("resolveFromDownloadRoot", () => {
  it("空值返回 undefined", () => {
    expect(resolveFromDownloadRoot("", root)).toBeUndefined();
    expect(resolveFromDownloadRoot(undefined, root)).toBeUndefined();
  });

  it("相对值按 join(root, value) 解析", () => {
    expect(resolveFromDownloadRoot("sub/a.mp4", root)).toBe(
      join(root, "sub", "a.mp4"),
    );
  });

  it("绝对值原样透传", () => {
    expect(resolveFromDownloadRoot("/tmp/x.mp4", root)).toBe("/tmp/x.mp4");
    expect(resolveFromDownloadRoot(join(root, "a.mp4"), root)).toBe(
      join(root, "a.mp4"),
    );
  });
});

describe("write/read roundtrip", () => {
  it("toRelative → resolve 还原绝对路径", () => {
    const abs = join(root, "a/b", "T-BV1-1-q80.mp4");
    const rel = toRelativeDownloadRootPath(abs, root);
    expect(rel).not.toBeNull();
    expect(resolveFromDownloadRoot(rel, root)).toBe(abs);
  });
});
