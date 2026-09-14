import { describe, expect, it } from "vitest";
import { parseCitationNumbers } from "../../src/chat/citation.js";

describe("parseCitationNumbers", () => {
  it("解析正文中的 [n] 标记并去重升序", () => {
    expect(parseCitationNumbers("先 [2] 再 [1]，最后 [2]。", 3)).toEqual([1, 2]);
  });

  it("越界引用忽略", () => {
    expect(parseCitationNumbers("引用 [4] 和 [9]", 3)).toEqual([]);
  });

  it("非正整数与三位数编号忽略", () => {
    expect(parseCitationNumbers("[0] [-1] [abc] [001]", 3)).toEqual([]);
  });

  it("无引用返回空数组", () => {
    expect(parseCitationNumbers("没有引用的正文", 3)).toEqual([]);
  });

  it("三位数编号不匹配（上限两位）", () => {
    expect(parseCitationNumbers("[100]", 150)).toEqual([]);
  });
});
